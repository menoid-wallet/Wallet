/**
 * solana.controller.js
 *
 * Route controllers for Solana.
 */
"use strict";

const { Transaction, Connection, PublicKey, ComputeBudgetProgram } = require("@solana/web3.js");
const snarkjs = require("snarkjs");
const path = require("path");

const { connection, program, programId, poolStatePda, relayerKeypair } = require("../config/solanaProvider");
const { solanaMutex } = require("../helpers/mutex");
const { computeOutputRoots } = require("../helpers/merkle");
const { solanaPoolStates, solanaSpentNullifiers, initializeSolanaPool } = require("../indexer/solanaIndexer");
const PoolState        = require("../models/PoolState");
const NoteState        = require("../models/NoteState");
const NullifierState   = require("../models/NullifierState");

const transferVKey = require("../zk/solana/transfer_verification_key.json");
const withdrawVKey = require("../zk/solana/withdraw_verification_key.json");

// Helper to convert 32-byte array to decimal string
function bytesToDecimal(bytes) {
    let result = 0n;
    for (const b of bytes) {
        result = (result << 8n) + BigInt(b);
    }
    return result.toString();
}

// Helper to convert decimal string to 32-byte Buffer
function toBE32(valStr) {
    const val = BigInt(valStr);
    const buf = Buffer.alloc(32);
    let temp = val;
    for (let i = 31; i >= 0; i--) {
        buf[i] = Number(temp & 0xffn);
        temp >>= 8n;
    }
    return buf;
}

// ─── Solana Deposit Controller ───────────────────────────────────────────────

async function solanaDepositController(req, res) {
    // Solana Deposit requires the mutex lock
    return solanaMutex.run(async () => {
        try {
            const { serializedTx, commitments, encryptedNotes, depositAmount } = req.body;

            if (!serializedTx) {
                return res.status(400).json({ success: false, message: "Missing serializedTx" });
            }

            console.log("[solana][deposit] Deserializing transaction...");
            const tx = Transaction.from(Buffer.from(serializedTx, "hex"));

            // Sign transaction as relayer (fee payer)
            tx.partialSign(relayerKeypair);

            console.log("[solana][deposit] Submitting deposit transaction...");
            const signature = await connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: false,
                preflightCommitment: "confirmed"
            });
            await connection.confirmTransaction(signature, "confirmed");

            console.log(`[solana][deposit] Transaction confirmed: ${signature}`);

            // Update database and memory pool states
            const poolId = "0"; // default pool
            await initializeSolanaPool(poolId);
            const state = solanaPoolStates[poolId];

            let dbPool = await PoolState.findOne({ network: "solana", poolId });
            if (!dbPool) {
                dbPool = new PoolState({
                    network: "solana",
                    poolId,
                    commitments: [],
                    roots: [],
                    latestRoot: null,
                    leafToIndex: {},
                    encryptedNotes: {}
                });
            }

            for (let i = 0; i < commitments.length; i++) {
                const commitment = commitments[i];
                const encNote = encryptedNotes[i];

                state.tree.insert(BigInt(commitment));
                const leafIndex = state.tree.leaves.length - 1;
                const root = state.tree.root.toString();

                state.roots.push(root);
                state.latestRoot = root;
                state.leafToIndex[commitment] = leafIndex;
                state.encryptedNotes[commitment] = encNote;

                dbPool.commitments.push(commitment);
                dbPool.roots.push(root);
                dbPool.latestRoot = root;
                dbPool.leafToIndex.set(commitment, leafIndex);
                dbPool.encryptedNotes.set(commitment, encNote);
            }

            dbPool.lastProcessedBlock = await connection.getSlot("confirmed");
            await dbPool.save();

            // Also update NoteState
            let noteState = await NoteState.findOne({ key: "global", network: "solana" });
            if (noteState) {
                noteState.lastProcessedBlock = dbPool.lastProcessedBlock;
                await noteState.save();
            }

            return res.json({
                success: true,
                txHash: signature,
                latestRoot: state.latestRoot
            });

        } catch (err) {
            console.error("[solana][deposit] Error:", err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });
}

// ─── Solana Transfer Controller ──────────────────────────────────────────────

async function solanaTransferController(req, res) {
    return solanaMutex.run(async () => {
        try {
            const { proof, publicSignals, enabled, roots, nullifiers, outputEnabled, commitments, encNotes } = req.body;

            // ZK Verification
            const verified = await snarkjs.groth16.verify(transferVKey, publicSignals, proof);
            if (!verified) {
                return res.status(400).json({ success: false, message: "Invalid ZK proof" });
            }

            // Check nullifiers
            for (const n of nullifiers) {
                if (n === "0") continue;
                if (solanaSpentNullifiers.has(n)) {
                    return res.status(400).json({ success: false, message: `Nullifier ${n} already spent` });
                }
            }

            const poolId = "0";
            await initializeSolanaPool(poolId);
            const state = solanaPoolStates[poolId];

            // Compute output roots on a THROWAWAY tree — do NOT mutate the
            // persistent in-memory tree until the tx actually succeeds, otherwise
            // a failed tx leaves phantom leaves that poison every future root.
            const tRoots = await computeOutputRoots(
                state.tree.leaves,
                commitments.map((c, j) => ({ enabled: outputEnabled[j] === 1, commitment: c }))
            );

            // Build Solana Transaction
            console.log("[solana][transfer] Building transfer instruction...");

            const nullifierPdas = [];
            const commitmentPdas = [];
            const remainingAccounts = [];

            for (let i = 0; i < nullifiers.length; i++) {
                if (enabled[i] === 1) {
                    const [nullifierPda] = PublicKey.findProgramAddressSync(
                        [Buffer.from("nullifier"), toBE32(nullifiers[i])],
                        programId
                    );
                    remainingAccounts.push({ pubkey: nullifierPda, isWritable: true, isSigner: false });
                }
            }

            for (let j = 0; j < commitments.length; j++) {
                if (outputEnabled[j] === 1) {
                    const [commitmentPda] = PublicKey.findProgramAddressSync(
                        [Buffer.from("commitment"), toBE32(commitments[j])],
                        programId
                    );
                    remainingAccounts.push({ pubkey: commitmentPda, isWritable: true, isSigner: false });
                }
            }

            // Call transfer instruction
            const ix = await program.methods
                .transfer(
                    proof.proofA, proof.proofB, proof.proofC,
                    enabled,
                    roots.map(r => Array.from(toBE32(r))),
                    nullifiers.map(n => Array.from(toBE32(n))),
                    outputEnabled,
                    commitments.map(c => Array.from(toBE32(c))),
                    tRoots.map(tr => Array.from(toBE32(tr)))
                )
                .accounts({
                    relayer: relayerKeypair.publicKey,
                    poolState: poolStatePda,
                    systemProgram: PublicKey.default
                })
                .remainingAccounts(remainingAccounts)
                .instruction();

            const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1000000 })).add(ix);
            tx.feePayer = relayerKeypair.publicKey;
            tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            tx.sign(relayerKeypair);

            console.log("[solana][transfer] Submitting transaction...");
            const signature = await connection.sendRawTransaction(tx.serialize());
            await connection.confirmTransaction(signature, "confirmed");

            // Update state
            let dbPool = await PoolState.findOne({ network: "solana", poolId });
            if (!dbPool) {
                dbPool = new PoolState({
                    network: "solana",
                    poolId,
                    commitments: [],
                    roots: [],
                    latestRoot: null,
                    leafToIndex: {},
                    encryptedNotes: {}
                });
            }

            // Tx succeeded — NOW commit the new commitments to the persistent
            // in-memory tree (so the leaf index is exact) and persist to the DB.
            let lastRoot = state.latestRoot;
            for (let j = 0; j < commitments.length; j++) {
                if (outputEnabled[j] === 1) {
                    const commitment = commitments[j];
                    const encNote = encNotes[j];

                    state.tree.insert(BigInt(commitment));
                    const leafIndex = state.tree.leaves.length - 1;
                    const root = state.tree.root.toString();

                    state.roots.push(root);
                    state.latestRoot = root;
                    state.leafToIndex[commitment] = leafIndex;
                    state.encryptedNotes[commitment] = encNote;

                    dbPool.commitments.push(commitment);
                    dbPool.roots.push(root);
                    dbPool.latestRoot = root;
                    dbPool.leafToIndex.set(commitment, leafIndex);
                    dbPool.encryptedNotes.set(commitment, encNote);
                    lastRoot = root;
                }
            }

            dbPool.lastProcessedBlock = await connection.getSlot("confirmed");
            await dbPool.save();

            // Update NoteState so catchup doesn't re-process transfer events on restart
            let noteStateT = await NoteState.findOne({ key: "global", network: "solana" });
            if (noteStateT) {
                noteStateT.lastProcessedBlock = Math.max(
                    noteStateT.lastProcessedBlock,
                    dbPool.lastProcessedBlock
                );
                await noteStateT.save();
            }

            // Update Spent Nullifiers
            let nullifierState = await NullifierState.findOne({ key: "global", network: "solana" });
            if (nullifierState) {
                for (let i = 0; i < nullifiers.length; i++) {
                    if (enabled[i] === 1) {
                        const n = nullifiers[i];
                        solanaSpentNullifiers.add(n);
                        nullifierState.nullifiers.push(n);
                    }
                }
                nullifierState.lastProcessedBlock = dbPool.lastProcessedBlock;
                await nullifierState.save();
            }

            return res.json({
                success: true,
                txHash: signature,
                latestRoot: lastRoot
            });

        } catch (err) {
            console.error("[solana][transfer] Error:", err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });
}

// ─── Solana Withdraw Controller ──────────────────────────────────────────────

async function solanaWithdrawController(req, res) {
    return solanaMutex.run(async () => {
        try {
            const { proof, publicSignals, enabled, roots, nullifiers, receiverPublicKey, withdrawAmount, outputEnabled, commitments, encNotes } = req.body;

            // ZK Verification
            const verified = await snarkjs.groth16.verify(withdrawVKey, publicSignals, proof);
            if (!verified) {
                return res.status(400).json({ success: false, message: "Invalid ZK proof" });
            }

            // Check nullifiers
            for (const n of nullifiers) {
                if (n === "0") continue;
                if (solanaSpentNullifiers.has(n)) {
                    return res.status(400).json({ success: false, message: `Nullifier ${n} already spent` });
                }
            }

            const poolId = "0";
            await initializeSolanaPool(poolId);
            const state = solanaPoolStates[poolId];

            // Compute output roots on a THROWAWAY tree — do NOT mutate the
            // persistent in-memory tree until the tx actually succeeds, otherwise
            // a failed withdraw leaves phantom leaves that poison every future root.
            const wRoots = await computeOutputRoots(
                state.tree.leaves,
                commitments.map((c, j) => ({ enabled: outputEnabled[j] === 1, commitment: c }))
            );

            // Remaining accounts (Nullifier PDA, Change PDA, Relayer Fee PDA)
            const remainingAccounts = [];

            for (let i = 0; i < nullifiers.length; i++) {
                if (enabled[i] === 1) {
                    const [nullifierPda] = PublicKey.findProgramAddressSync(
                        [Buffer.from("nullifier"), toBE32(nullifiers[i])],
                        programId
                    );
                    remainingAccounts.push({ pubkey: nullifierPda, isWritable: true, isSigner: false });
                }
            }

            for (let j = 0; j < commitments.length; j++) {
                if (outputEnabled[j] === 1) {
                    const [commitmentPda] = PublicKey.findProgramAddressSync(
                        [Buffer.from("commitment"), toBE32(commitments[j])],
                        programId
                    );
                    remainingAccounts.push({ pubkey: commitmentPda, isWritable: true, isSigner: false });
                }
            }

            console.log("[solana][withdraw] Building withdraw instruction...");

            const ix = await program.methods
                .withdraw(
                    proof.proofA, proof.proofB, proof.proofC,
                    enabled,
                    roots.map(r => Array.from(toBE32(r))),
                    nullifiers.map(n => Array.from(toBE32(n))),
                    new PublicKey(receiverPublicKey),
                    new (require("@coral-xyz/anchor").BN)(withdrawAmount),
                    outputEnabled,
                    commitments.map(c => Array.from(toBE32(c))),
                    wRoots.map(wr => Array.from(toBE32(wr)))
                )
                .accounts({
                    relayer: relayerKeypair.publicKey,
                    poolState: poolStatePda,
                    vault: PublicKey.findProgramAddressSync([Buffer.from("vault"), poolStatePda.toBuffer()], programId)[0],
                    receiver: new PublicKey(receiverPublicKey),
                    systemProgram: PublicKey.default
                })
                .remainingAccounts(remainingAccounts)
                .instruction();

            const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 })).add(ix);
            tx.feePayer = relayerKeypair.publicKey;
            tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            tx.sign(relayerKeypair);

            console.log("[solana][withdraw] Submitting transaction...");
            const signature = await connection.sendRawTransaction(tx.serialize());
            await connection.confirmTransaction(signature, "confirmed");

            // Update state
            let dbPool = await PoolState.findOne({ network: "solana", poolId });
            if (!dbPool) {
                dbPool = new PoolState({
                    network: "solana",
                    poolId,
                    commitments: [],
                    roots: [],
                    latestRoot: null,
                    leafToIndex: {},
                    encryptedNotes: {}
                });
            }

            // Tx succeeded — NOW commit the change/fee commitments to the
            // persistent in-memory tree (exact leaf index) and persist to the DB.
            let lastRoot = state.latestRoot;
            for (let j = 0; j < commitments.length; j++) {
                if (outputEnabled[j] === 1) {
                    const commitment = commitments[j];
                    const encNote = encNotes[j];

                    state.tree.insert(BigInt(commitment));
                    const leafIndex = state.tree.leaves.length - 1;
                    const root = state.tree.root.toString();

                    state.roots.push(root);
                    state.latestRoot = root;
                    state.leafToIndex[commitment] = leafIndex;
                    state.encryptedNotes[commitment] = encNote;

                    dbPool.commitments.push(commitment);
                    dbPool.roots.push(root);
                    dbPool.latestRoot = root;
                    dbPool.leafToIndex.set(commitment, leafIndex);
                    dbPool.encryptedNotes.set(commitment, encNote);
                    lastRoot = root;
                }
            }

            dbPool.lastProcessedBlock = await connection.getSlot("confirmed");
            await dbPool.save();

            // Update NoteState so catchup doesn't re-process withdraw events on restart
            let noteStateW = await NoteState.findOne({ key: "global", network: "solana" });
            if (noteStateW) {
                noteStateW.lastProcessedBlock = Math.max(
                    noteStateW.lastProcessedBlock,
                    dbPool.lastProcessedBlock
                );
                await noteStateW.save();
            }

            // Update Spent Nullifiers
            let nullifierState = await NullifierState.findOne({ key: "global", network: "solana" });
            if (nullifierState) {
                for (let i = 0; i < nullifiers.length; i++) {
                    if (enabled[i] === 1) {
                        const n = nullifiers[i];
                        solanaSpentNullifiers.add(n);
                        nullifierState.nullifiers.push(n);
                    }
                }
                nullifierState.lastProcessedBlock = dbPool.lastProcessedBlock;
                await nullifierState.save();
            }

            return res.json({
                success: true,
                txHash: signature,
                latestRoot: lastRoot
            });

        } catch (err) {
            console.error("[solana][withdraw] Error:", err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });
}

module.exports = {
    solanaDepositController,
    solanaTransferController,
    solanaWithdrawController
};
