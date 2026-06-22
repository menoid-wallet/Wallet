/**
 * sui.controller.js
 *
 * Route controllers for Sui.
 *
 * New architecture (matches the latest, permissionless Move package):
 *   - The package recomputes the Merkle root ON-CHAIN, so the relayer never
 *     supplies output roots (the old `tRoots`/`wRoots` arguments are gone).
 *   - Permissionless ⇒ NO mutex. DB writes use atomic operators; the in-memory
 *     tree is updated synchronously so concurrent requests can't interleave.
 *   - deposit: the user signs the transaction (sender); the relayer co-signs as
 *     gas sponsor and forwards it.
 *   - transfer/withdraw: the user posts proof + calldata; the relayer verifies,
 *     builds, signs and submits.
 */
"use strict";

const { Transaction } = require("@mysten/sui/transactions");
const { fromBase64 } = require("@mysten/sui/utils");
const snarkjs = require("snarkjs");

const { suiClient, relayerKeypair, packageId, poolStateId, verifierConfigId } = require("../config/suiProvider");
const { suiPoolStates, suiSpentNullifiers, initializeSuiPool } = require("../indexer/suiIndexer");
const { appendCommitmentsAtomic, addSpentNullifiersAtomic } = require("../helpers/poolUpdate");

const transferVKey = require("../zk/sui/transfer_verification_key.json");
const withdrawVKey = require("../zk/sui/withdraw_verification_key.json");

function toU256(val) {
    return BigInt(val);
}

/**
 * Insert newly-created commitments into the in-memory tree (synchronously) and
 * mirror onto the in-memory caches; returns the entries to persist atomically.
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

// ─── Sui Deposit ─────────────────────────────────────────────────────────────
// User-signed (permissionless). The relayer co-signs as gas sponsor and submits.

async function suiDepositController(req, res) {
    try {
        const { txBytes, senderSignature, commitments, encryptedNotes } = req.body;
        if (!txBytes || !senderSignature) {
            return res.status(400).json({ success: false, message: "Missing txBytes or senderSignature" });
        }
        if (!Array.isArray(commitments) || commitments.length === 0) {
            return res.status(400).json({ success: false, message: "Missing commitments" });
        }

        const txBytesBuffer = fromBase64(txBytes);
        const { signature: sponsorSignature } = await relayerKeypair.signTransaction(txBytesBuffer);

        console.log("[sui][deposit] Submitting deposit transaction...");
        const result = await suiClient.executeTransactionBlock({
            transactionBlock: txBytesBuffer,
            signature: [senderSignature, sponsorSignature],
            options: { showEffects: true, showEvents: true }
        });

        if (result.effects?.status.status !== "success") {
            return res.status(500).json({
                success: false,
                message: `Transaction failed: ${JSON.stringify(result.effects?.status)}`
            });
        }
        await suiClient.waitForTransaction({ digest: result.digest });
        console.log(`[sui][deposit] Confirmed: ${result.digest}`);

        const poolId = "0";
        await initializeSuiPool(poolId);
        const state = suiPoolStates[poolId];

        const outputEnabled = commitments.map(() => 1);
        const entries = applyOutputsToMemory(state, commitments, outputEnabled, encryptedNotes);
        await appendCommitmentsAtomic("sui", poolId, entries, state.latestRoot);

        return res.json({ success: true, txHash: result.digest, latestRoot: state.latestRoot });
    } catch (err) {
        console.error("[sui][deposit] Error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

// ─── Sui Transfer ────────────────────────────────────────────────────────────

async function suiTransferController(req, res) {
    try {
        const { proof, publicSignals, proofBytes, enabled, poolIds, roots, nullifiers, outputEnabled, commitments, encNotes } = req.body;

        const verified = await snarkjs.groth16.verify(transferVKey, publicSignals, proof);
        if (!verified) {
            return res.status(400).json({ success: false, message: "Invalid ZK proof" });
        }

        for (const n of nullifiers) {
            if (n === "0") continue;
            if (suiSpentNullifiers.has(String(n))) {
                return res.status(400).json({ success: false, message: `Nullifier ${n} already spent` });
            }
        }

        const poolId = "0";
        await initializeSuiPool(poolId);
        const state = suiPoolStates[poolId];

        // No output roots — the Move package recomputes the root on-chain.
        const tx = new Transaction();
        tx.moveCall({
            target: `${packageId}::pool::transfer`,
            arguments: [
                tx.object(poolStateId),
                tx.object(verifierConfigId),
                tx.pure.vector("u8", Array.from(proofBytes)),
                tx.pure.vector("u8", enabled),
                tx.pure.vector("u64", poolIds.map((id) => Number(id))),
                tx.pure.vector("u256", roots.map((r) => toU256(r))),
                tx.pure.vector("u256", nullifiers.map((n) => toU256(n))),
                tx.pure.vector("u8", outputEnabled),
                tx.pure.vector("u256", commitments.map((c) => toU256(c))),
                tx.pure.vector("u8", Array.from(Buffer.from(encNotes[0] || ""))),
                tx.pure.vector("u8", Array.from(Buffer.from(encNotes[1] || ""))),
                tx.pure.vector("u8", Array.from(Buffer.from(encNotes[2] || "")))
            ]
        });

        const relayerAddress = relayerKeypair.getPublicKey().toSuiAddress();
        tx.setSender(relayerAddress);
        tx.setGasOwner(relayerAddress);
        tx.setGasBudget(50_000_000);

        const txBytesBuffer = await tx.build({ client: suiClient });
        const { signature } = await relayerKeypair.signTransaction(txBytesBuffer);

        console.log("[sui][transfer] Submitting transaction...");
        const result = await suiClient.executeTransactionBlock({
            transactionBlock: txBytesBuffer,
            signature: [signature],
            options: { showEffects: true, showEvents: true }
        });
        if (result.effects?.status.status !== "success") {
            return res.status(500).json({
                success: false,
                message: `Transaction failed: ${JSON.stringify(result.effects?.status)}`
            });
        }
        await suiClient.waitForTransaction({ digest: result.digest });

        const entries = applyOutputsToMemory(state, commitments, outputEnabled, encNotes);
        for (let i = 0; i < nullifiers.length; i++) {
            if (enabled[i] === 1) suiSpentNullifiers.add(String(nullifiers[i]));
        }
        await appendCommitmentsAtomic("sui", poolId, entries, state.latestRoot);
        await addSpentNullifiersAtomic("sui", nullifiers.filter((_, i) => enabled[i] === 1));

        return res.json({ success: true, txHash: result.digest, latestRoot: state.latestRoot });
    } catch (err) {
        console.error("[sui][transfer] Error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

// ─── Sui Withdraw ────────────────────────────────────────────────────────────

async function suiWithdrawController(req, res) {
    try {
        const { proof, publicSignals, proofBytes, enabled, poolIds, roots, nullifiers, receiverAddress, withdrawAmount, outputEnabled, commitments, encNotes } = req.body;

        const verified = await snarkjs.groth16.verify(withdrawVKey, publicSignals, proof);
        if (!verified) {
            return res.status(400).json({ success: false, message: "Invalid ZK proof" });
        }

        for (const n of nullifiers) {
            if (n === "0") continue;
            if (suiSpentNullifiers.has(String(n))) {
                return res.status(400).json({ success: false, message: `Nullifier ${n} already spent` });
            }
        }

        const poolId = "0";
        await initializeSuiPool(poolId);
        const state = suiPoolStates[poolId];

        const tx = new Transaction();
        tx.moveCall({
            target: `${packageId}::pool::withdraw`,
            arguments: [
                tx.object(poolStateId),
                tx.object(verifierConfigId),
                tx.pure.vector("u8", Array.from(proofBytes)),
                tx.pure.vector("u8", enabled),
                tx.pure.vector("u64", poolIds.map((id) => Number(id))),
                tx.pure.vector("u256", roots.map((r) => toU256(r))),
                tx.pure.vector("u256", nullifiers.map((n) => toU256(n))),
                tx.pure.address(receiverAddress),
                tx.pure.u64(Number(withdrawAmount)),
                tx.pure.vector("u8", outputEnabled),
                tx.pure.vector("u256", commitments.map((c) => toU256(c))),
                tx.pure.vector("u8", Array.from(Buffer.from(encNotes[0] || ""))),
                tx.pure.vector("u8", Array.from(Buffer.from(encNotes[1] || "")))
            ]
        });

        const relayerAddress = relayerKeypair.getPublicKey().toSuiAddress();
        tx.setSender(relayerAddress);
        tx.setGasOwner(relayerAddress);
        tx.setGasBudget(50_000_000);

        const txBytesBuffer = await tx.build({ client: suiClient });
        const { signature } = await relayerKeypair.signTransaction(txBytesBuffer);

        console.log("[sui][withdraw] Submitting transaction...");
        const result = await suiClient.executeTransactionBlock({
            transactionBlock: txBytesBuffer,
            signature: [signature],
            options: { showEffects: true, showEvents: true }
        });
        if (result.effects?.status.status !== "success") {
            return res.status(500).json({
                success: false,
                message: `Transaction failed: ${JSON.stringify(result.effects?.status)}`
            });
        }
        await suiClient.waitForTransaction({ digest: result.digest });

        const entries = applyOutputsToMemory(state, commitments, outputEnabled, encNotes);
        for (let i = 0; i < nullifiers.length; i++) {
            if (enabled[i] === 1) suiSpentNullifiers.add(String(nullifiers[i]));
        }
        await appendCommitmentsAtomic("sui", poolId, entries, state.latestRoot);
        await addSpentNullifiersAtomic("sui", nullifiers.filter((_, i) => enabled[i] === 1));

        return res.json({ success: true, txHash: result.digest, latestRoot: state.latestRoot });
    } catch (err) {
        console.error("[sui][withdraw] Error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = {
    suiDepositController,
    suiTransferController,
    suiWithdrawController
};
