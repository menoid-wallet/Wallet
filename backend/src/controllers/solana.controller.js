/**
 * solana.controller.js
 *
 * Route controllers for Solana.
 *
 * New architecture (matches the latest, permissionless on-chain program):
 *   - The program recomputes the Merkle root ON-CHAIN (filled-subtree algorithm),
 *     so the relayer never supplies output roots.
 *   - Anyone may call deposit/transfer/withdraw, so there is NO mutex. The DB is
 *     updated with atomic operators ($push/$set/$addToSet); the in-memory tree is
 *     updated synchronously (no await between insert and root read) so concurrent
 *     requests cannot interleave a tree mutation.
 *   - deposit: the user signs the whole transaction; the relayer just forwards it
 *     (and co-signs as fee payer if it is the configured fee payer).
 *   - transfer/withdraw: the user posts the proof + calldata; the relayer verifies,
 *     builds, signs and submits the transaction.
 */
"use strict";

const { Transaction, PublicKey, ComputeBudgetProgram } = require("@solana/web3.js");
const { BN } = require("@coral-xyz/anchor");
const snarkjs = require("snarkjs");

const { connection, program, programId, poolStatePda, relayerKeypair } = require("../config/solanaProvider");
const { solanaPoolStates, solanaSpentNullifiers, initializeSolanaPool } = require("../indexer/solanaIndexer");
const { appendCommitmentsAtomic, addSpentNullifiersAtomic } = require("../helpers/poolUpdate");

const transferVKey = require("../zk/solana/transfer_verification_key.json");
const withdrawVKey = require("../zk/solana/withdraw_verification_key.json");

// Decimal string → 32-byte big-endian Buffer
function toBE32(valStr) {
    let temp = BigInt(valStr);
    const buf = Buffer.alloc(32);
    for (let i = 31; i >= 0; i--) {
        buf[i] = Number(temp & 0xffn);
        temp >>= 8n;
    }
    return buf;
}

/**
 * Insert the newly-created commitments into the in-memory tree (synchronously, so
 * concurrent requests cannot interleave), mirror them onto the in-memory pool
 * caches, and return the entries to persist atomically.
 */
function applyOutputsToMemory(state, commitments, outputEnabled, encNotes) {
    const entries = [];
    for (let j = 0; j < commitments.length; j++) {
        if (outputEnabled[j] !== 1) continue;
        const commitment = String(commitments[j]);
        const encNote = encNotes ? encNotes[j] : undefined;

        state.tree.insert(BigInt(commitment));
        const leafIndex = state.tree.leaves.length - 1;
        const root = state.tree.root.toString();

        state.roots.push(root);
        state.latestRoot = root;
        state.leafToIndex[commitment] = leafIndex;
        if (encNote !== undefined) state.encryptedNotes[commitment] = encNote;

        entries.push({ commitment, root, leafIndex, encNote });
    }
    return entries;
}

function buildRemainingAccounts(enabled, nullifiers, outputEnabled, commitments) {
    const remaining = [];
    for (let i = 0; i < nullifiers.length; i++) {
        if (enabled[i] === 1) {
            const [pda] = PublicKey.findProgramAddressSync(
                [Buffer.from("nullifier"), toBE32(nullifiers[i])],
                programId
            );
            remaining.push({ pubkey: pda, isWritable: true, isSigner: false });
        }
    }
    for (let j = 0; j < commitments.length; j++) {
        if (outputEnabled[j] === 1) {
            const [pda] = PublicKey.findProgramAddressSync(
                [Buffer.from("commitment"), toBE32(commitments[j])],
                programId
            );
            remaining.push({ pubkey: pda, isWritable: true, isSigner: false });
        }
    }
    return remaining;
}

// ─── Solana Deposit ──────────────────────────────────────────────────────────
// User signs the full deposit transaction; the relayer just forwards it (and
// co-signs as fee payer when it is the configured fee payer). Root is computed
// on-chain; we mirror the two new commitments locally + globally afterwards.

async function solanaDepositController(req, res) {
    try {
        const { serializedTx, commitments, encryptedNotes } = req.body;
        if (!serializedTx) {
            return res.status(400).json({ success: false, message: "Missing serializedTx" });
        }
        if (!Array.isArray(commitments) || commitments.length === 0) {
            return res.status(400).json({ success: false, message: "Missing commitments" });
        }

        const tx = Transaction.from(Buffer.from(serializedTx, "hex"));

        // Co-sign as fee payer only if the relayer is the designated fee payer and
        // hasn't already signed (supports both user-pays-gas and sponsored flows).
        const relayerIsFeePayer = tx.feePayer && tx.feePayer.equals(relayerKeypair.publicKey);
        if (relayerIsFeePayer) {
            try { tx.partialSign(relayerKeypair); } catch (_) { /* already signed */ }
        }

        console.log("[solana][deposit] Submitting deposit transaction...");
        const signature = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: false,
            preflightCommitment: "confirmed"
        });
        await connection.confirmTransaction(signature, "confirmed");
        console.log(`[solana][deposit] Confirmed: ${signature}`);

        const poolId = "0";
        await initializeSolanaPool(poolId);
        const state = solanaPoolStates[poolId];

        // Both deposit commitments are always inserted on-chain → outputEnabled all 1.
        const outputEnabled = commitments.map(() => 1);
        const entries = applyOutputsToMemory(state, commitments, outputEnabled, encryptedNotes);

        const slot = await connection.getSlot("confirmed");
        await appendCommitmentsAtomic("solana", poolId, entries, state.latestRoot, slot);

        return res.json({ success: true, txHash: signature, latestRoot: state.latestRoot });
    } catch (err) {
        console.error("[solana][deposit] Error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

// ─── Solana Transfer ─────────────────────────────────────────────────────────

async function solanaTransferController(req, res) {
    try {
        const { proof, publicSignals, enabled, roots, nullifiers, outputEnabled, commitments, encNotes } = req.body;

        const verified = await snarkjs.groth16.verify(transferVKey, publicSignals, proof);
        if (!verified) {
            return res.status(400).json({ success: false, message: "Invalid ZK proof" });
        }

        for (const n of nullifiers) {
            if (n === "0") continue;
            if (solanaSpentNullifiers.has(String(n))) {
                return res.status(400).json({ success: false, message: `Nullifier ${n} already spent` });
            }
        }

        const poolId = "0";
        await initializeSolanaPool(poolId);
        const state = solanaPoolStates[poolId];

        const remainingAccounts = buildRemainingAccounts(enabled, nullifiers, outputEnabled, commitments);

        // Roots are recomputed on-chain — no output roots are passed.
        const ix = await program.methods
            .transfer(
                proof.proofA, proof.proofB, proof.proofC,
                enabled,
                roots.map((r) => Array.from(toBE32(r))),
                nullifiers.map((n) => Array.from(toBE32(n))),
                outputEnabled,
                commitments.map((c) => Array.from(toBE32(c)))
            )
            .accounts({
                payer: relayerKeypair.publicKey,
                poolState: poolStatePda,
                systemProgram: PublicKey.default
            })
            .remainingAccounts(remainingAccounts)
            .instruction();

        const tx = new Transaction()
            .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }))
            .add(ix);
        tx.feePayer = relayerKeypair.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.sign(relayerKeypair);

        console.log("[solana][transfer] Submitting transaction...");
        const signature = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction(signature, "confirmed");

        // Tx succeeded — mirror the new outputs locally, then persist atomically.
        const entries = applyOutputsToMemory(state, commitments, outputEnabled, encNotes);
        for (let i = 0; i < nullifiers.length; i++) {
            if (enabled[i] === 1) solanaSpentNullifiers.add(String(nullifiers[i]));
        }

        const slot = await connection.getSlot("confirmed");
        await appendCommitmentsAtomic("solana", poolId, entries, state.latestRoot, slot);
        await addSpentNullifiersAtomic(
            "solana",
            nullifiers.filter((_, i) => enabled[i] === 1),
            slot
        );

        return res.json({ success: true, txHash: signature, latestRoot: state.latestRoot });
    } catch (err) {
        console.error("[solana][transfer] Error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

// ─── Solana Withdraw ─────────────────────────────────────────────────────────

async function solanaWithdrawController(req, res) {
    try {
        const { proof, publicSignals, enabled, roots, nullifiers, receiverPublicKey, withdrawAmount, outputEnabled, commitments, encNotes } = req.body;

        const verified = await snarkjs.groth16.verify(withdrawVKey, publicSignals, proof);
        if (!verified) {
            return res.status(400).json({ success: false, message: "Invalid ZK proof" });
        }

        for (const n of nullifiers) {
            if (n === "0") continue;
            if (solanaSpentNullifiers.has(String(n))) {
                return res.status(400).json({ success: false, message: `Nullifier ${n} already spent` });
            }
        }

        const poolId = "0";
        await initializeSolanaPool(poolId);
        const state = solanaPoolStates[poolId];

        const [vaultPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), poolStatePda.toBuffer()],
            programId
        );
        const remainingAccounts = buildRemainingAccounts(enabled, nullifiers, outputEnabled, commitments);

        const ix = await program.methods
            .withdraw(
                proof.proofA, proof.proofB, proof.proofC,
                enabled,
                roots.map((r) => Array.from(toBE32(r))),
                nullifiers.map((n) => Array.from(toBE32(n))),
                new PublicKey(receiverPublicKey),
                new BN(withdrawAmount),
                outputEnabled,
                commitments.map((c) => Array.from(toBE32(c)))
            )
            .accounts({
                payer: relayerKeypair.publicKey,
                poolState: poolStatePda,
                vault: vaultPda,
                receiver: new PublicKey(receiverPublicKey),
                systemProgram: PublicKey.default
            })
            .remainingAccounts(remainingAccounts)
            .instruction();

        const tx = new Transaction()
            .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }))
            .add(ix);
        tx.feePayer = relayerKeypair.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.sign(relayerKeypair);

        console.log("[solana][withdraw] Submitting transaction...");
        const signature = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction(signature, "confirmed");

        const entries = applyOutputsToMemory(state, commitments, outputEnabled, encNotes);
        for (let i = 0; i < nullifiers.length; i++) {
            if (enabled[i] === 1) solanaSpentNullifiers.add(String(nullifiers[i]));
        }

        const slot = await connection.getSlot("confirmed");
        await appendCommitmentsAtomic("solana", poolId, entries, state.latestRoot, slot);
        await addSpentNullifiersAtomic(
            "solana",
            nullifiers.filter((_, i) => enabled[i] === 1),
            slot
        );

        return res.json({ success: true, txHash: signature, latestRoot: state.latestRoot });
    } catch (err) {
        console.error("[solana][withdraw] Error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = {
    solanaDepositController,
    solanaTransferController,
    solanaWithdrawController
};
