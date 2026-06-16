/**
 * sui.controller.js
 *
 * Route controllers for Sui.
 */
"use strict";

const { Transaction } = require("@mysten/sui/transactions");
const { fromBase64 } = require("@mysten/sui/utils");
const snarkjs = require("snarkjs");
const path = require("path");

const { suiClient, relayerKeypair, packageId, poolStateId, verifierConfigId } = require("../config/suiProvider");
const { suiMutex } = require("../helpers/mutex");
const { computeOutputRoots } = require("../helpers/merkle");
const { suiPoolStates, suiSpentNullifiers, initializeSuiPool } = require("../indexer/suiIndexer");
const PoolState        = require("../models/PoolState");
const NoteState        = require("../models/NoteState");
const NullifierState   = require("../models/NullifierState");

const transferVKey = require("../zk/sui/transfer_verification_key.json");
const withdrawVKey = require("../zk/sui/withdraw_verification_key.json");

// Helper to convert decimal string/number to u256 representation (string or bigint)
function toU256(val) {
    return BigInt(val);
}

// ─── Sui Deposit Controller ──────────────────────────────────────────────────

async function suiDepositController(req, res) {
    return suiMutex.run(async () => {
        try {
            const { txBytes, senderSignature, commitments, encryptedNotes, depositAmount } = req.body;

            if (!txBytes || !senderSignature) {
                return res.status(400).json({ success: false, message: "Missing txBytes or senderSignature" });
            }

            console.log("[sui][deposit] Signing sponsored transaction block...");
            const txBytesBuffer = fromBase64(txBytes);
            const { signature: sponsorSignature } = await relayerKeypair.signTransaction(txBytesBuffer);

            console.log("[sui][deposit] Submitting sponsored deposit transaction...");
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
            console.log(`[sui][deposit] Transaction executed successfully: ${result.digest}`);

            // Update DB and memory pool states
            const poolId = "0";
            await initializeSuiPool(poolId);
            const state = suiPoolStates[poolId];

            let dbPool = await PoolState.findOne({ network: "sui", poolId });
            if (!dbPool) {
                dbPool = new PoolState({
                    network: "sui",
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

            dbPool.lastProcessedBlock = 0; // fallback or store tx sequence
            await dbPool.save();

            return res.json({
                success: true,
                txHash: result.digest,
                latestRoot: state.latestRoot
            });

        } catch (err) {
            console.error("[sui][deposit] Error:", err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });
}

// ─── Sui Transfer Controller ─────────────────────────────────────────────────

async function suiTransferController(req, res) {
    return suiMutex.run(async () => {
        try {
            const { proof, publicSignals, proofBytes, enabled, poolIds, roots, nullifiers, outputEnabled, commitments, encNotes } = req.body;

            // ZK Verification
            const verified = await snarkjs.groth16.verify(transferVKey, publicSignals, proof);
            if (!verified) {
                return res.status(400).json({ success: false, message: "Invalid ZK proof" });
            }

            // Check nullifiers
            for (const n of nullifiers) {
                if (n === "0") continue;
                if (suiSpentNullifiers.has(n)) {
                    return res.status(400).json({ success: false, message: `Nullifier ${n} already spent` });
                }
            }

            const poolId = "0";
            await initializeSuiPool(poolId);
            const state = suiPoolStates[poolId];

            // Compute output roots on a THROWAWAY tree — do NOT mutate the
            // persistent in-memory tree until the tx actually succeeds, otherwise
            // a failed tx leaves phantom leaves that poison every future root.
            const tRoots = await computeOutputRoots(
                state.tree.leaves,
                commitments.map((c, j) => ({ enabled: outputEnabled[j] === 1, commitment: c }))
            );

            console.log("[sui][transfer] Building move transaction block...");
            const tx = new Transaction();
            tx.moveCall({
                target: `${packageId}::pool::transfer`,
                arguments: [
                    tx.object(poolStateId),
                    tx.object(verifierConfigId),
                    tx.pure.vector("u8", Array.from(proofBytes)),
                    tx.pure.vector("u8", enabled),
                    tx.pure.vector("u64", poolIds.map(id => Number(id))),
                    tx.pure.vector("u256", roots.map(r => toU256(r))),
                    tx.pure.vector("u256", nullifiers.map(n => toU256(n))),
                    tx.pure.vector("u8", outputEnabled),
                    tx.pure.vector("u256", commitments.map(c => toU256(c))),
                    tx.pure.vector("u256", tRoots.map(tr => toU256(tr))),
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

            console.log("[sui][transfer] Submitting transfer transaction...");
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

            // Update DB and memory states
            let dbPool = await PoolState.findOne({ network: "sui", poolId });
            if (!dbPool) {
                dbPool = new PoolState({
                    network: "sui",
                    poolId,
                    commitments: [],
                    roots: [],
                    latestRoot: null,
                    leafToIndex: {},
                    encryptedNotes: {}
                });
            }

            // Tx succeeded — NOW commit the new commitments to the persistent
            // in-memory tree (exact leaf index) and persist to the DB.
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
            await dbPool.save();

            // Update Spent Nullifiers
            let nullifierState = await NullifierState.findOne({ key: "global", network: "sui" });
            if (nullifierState) {
                for (let i = 0; i < nullifiers.length; i++) {
                    if (enabled[i] === 1) {
                        const n = nullifiers[i];
                        suiSpentNullifiers.add(n);
                        nullifierState.nullifiers.push(n);
                    }
                }
                await nullifierState.save();
            }

            return res.json({
                success: true,
                txHash: result.digest,
                latestRoot: lastRoot
            });

        } catch (err) {
            console.error("[sui][transfer] Error:", err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });
}

// ─── Sui Withdraw Controller ─────────────────────────────────────────────────

async function suiWithdrawController(req, res) {
    return suiMutex.run(async () => {
        try {
            const { proof, publicSignals, proofBytes, enabled, poolIds, roots, nullifiers, receiverAddress, withdrawAmount, outputEnabled, commitments, encNotes } = req.body;

            // ZK Verification
            const verified = await snarkjs.groth16.verify(withdrawVKey, publicSignals, proof);
            if (!verified) {
                return res.status(400).json({ success: false, message: "Invalid ZK proof" });
            }

            // Check nullifiers
            for (const n of nullifiers) {
                if (n === "0") continue;
                if (suiSpentNullifiers.has(n)) {
                    return res.status(400).json({ success: false, message: `Nullifier ${n} already spent` });
                }
            }

            const poolId = "0";
            await initializeSuiPool(poolId);
            const state = suiPoolStates[poolId];

            // Compute output roots on a THROWAWAY tree — do NOT mutate the
            // persistent in-memory tree until the tx actually succeeds, otherwise
            // a failed withdraw leaves phantom leaves that poison every future root.
            const wRoots = await computeOutputRoots(
                state.tree.leaves,
                commitments.map((c, j) => ({ enabled: outputEnabled[j] === 1, commitment: c }))
            );

            console.log("[sui][withdraw] Building move transaction block...");
            const tx = new Transaction();
            tx.moveCall({
                target: `${packageId}::pool::withdraw`,
                arguments: [
                    tx.object(poolStateId),
                    tx.object(verifierConfigId),
                    tx.pure.vector("u8", Array.from(proofBytes)),
                    tx.pure.vector("u8", enabled),
                    tx.pure.vector("u64", poolIds.map(id => Number(id))),
                    tx.pure.vector("u256", roots.map(r => toU256(r))),
                    tx.pure.vector("u256", nullifiers.map(n => toU256(n))),
                    tx.pure.address(receiverAddress),
                    tx.pure.u64(Number(withdrawAmount)),
                    tx.pure.vector("u8", outputEnabled),
                    tx.pure.vector("u256", commitments.map(c => toU256(c))),
                    tx.pure.vector("u256", wRoots.map(wr => toU256(wr))),
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

            console.log("[sui][withdraw] Submitting withdraw transaction...");
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

            // Update DB and memory states
            let dbPool = await PoolState.findOne({ network: "sui", poolId });
            if (!dbPool) {
                dbPool = new PoolState({
                    network: "sui",
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
            await dbPool.save();

            // Update Spent Nullifiers
            let nullifierState = await NullifierState.findOne({ key: "global", network: "sui" });
            if (nullifierState) {
                for (let i = 0; i < nullifiers.length; i++) {
                    if (enabled[i] === 1) {
                        const n = nullifiers[i];
                        suiSpentNullifiers.add(n);
                        nullifierState.nullifiers.push(n);
                    }
                }
                await nullifierState.save();
            }

            return res.json({
                success: true,
                txHash: result.digest,
                latestRoot: lastRoot
            });

        } catch (err) {
            console.error("[sui][withdraw] Error:", err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });
}

module.exports = {
    suiDepositController,
    suiTransferController,
    suiWithdrawController
};
