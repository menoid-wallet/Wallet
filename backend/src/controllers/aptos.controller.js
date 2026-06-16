/**
 * aptos.controller.js
 *
 * Route controllers for Aptos.
 */
"use strict";

const { SimpleTransaction, MultiAgentTransaction } = require("@aptos-labs/ts-sdk");
const snarkjs = require("snarkjs");
const path = require("path");

const { aptos, relayerAccount, moduleAddr, poolResourceAddr } = require("../config/aptosProvider");
const { aptosMutex } = require("../helpers/mutex");
const { computeOutputRoots } = require("../helpers/merkle");
const { aptosPoolStates, aptosSpentNullifiers, initializeAptosPool } = require("../indexer/aptosIndexer");
const PoolState        = require("../models/PoolState");
const NoteState        = require("../models/NoteState");
const NullifierState   = require("../models/NullifierState");

const transferVKey = require("../zk/aptos/transfer_verification_key.json");
const withdrawVKey = require("../zk/aptos/withdraw_verification_key.json");

// Helper to convert array or hex to Uint8Array
function toUint8Array(val) {
    if (Array.isArray(val)) return Uint8Array.from(val);
    if (typeof val === "string") {
        if (val.startsWith("0x")) return Uint8Array.from(Buffer.from(val.slice(2), "hex"));
        return Uint8Array.from(Buffer.from(val, "hex"));
    }
    return val;
}

// ─── Aptos Deposit Controller ────────────────────────────────────────────────

async function aptosDepositController(req, res) {
    return aptosMutex.run(async () => {
        try {
            const { rawTxBytes, senderAuth, commitments, encryptedNotes, depositAmount } = req.body;

            if (!rawTxBytes || !senderAuth) {
                return res.status(400).json({ success: false, message: "Missing rawTxBytes or senderAuth" });
            }

            console.log("[aptos][deposit] Deserializing multi-agent transaction...");
            // Deserialize using Aptos SDK
            const txBytes = toUint8Array(rawTxBytes);
            const tx = MultiAgentTransaction.deserialize(txBytes);

            console.log("[aptos][deposit] Signing as secondary signer and fee payer...");
            const relayerSecondaryAuth = await aptos.transaction.sign({ signer: relayerAccount, transaction: tx });
            const relayerFeePayerAuth = await aptos.transaction.signAsFeePayer({ signer: relayerAccount, transaction: tx });

            // Deserialize sender auth
            const aliceAuth = senderAuth; // assumed already deserialized or structured JSON matching AccountAuthenticator

            console.log("[aptos][deposit] Submitting deposit transaction...");
            const result = await aptos.transaction.submit.multiAgent({
                transaction: tx,
                senderAuthenticator: aliceAuth,
                additionalSignersAuthenticators: [relayerSecondaryAuth],
                feePayerAuthenticator: relayerFeePayerAuth
            });

            const receipt = await aptos.waitForTransaction({ transactionHash: result.hash });
            console.log(`[aptos][deposit] Transaction executed: ${receipt.hash}`);

            // Update DB and memory pool states
            const poolId = "0";
            await initializeAptosPool(poolId);
            const state = aptosPoolStates[poolId];

            let dbPool = await PoolState.findOne({ network: "aptos", poolId });
            if (!dbPool) {
                dbPool = new PoolState({
                    network: "aptos",
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

            dbPool.lastProcessedBlock = Number(receipt.version) || 0;
            await dbPool.save();

            // Update NoteState so catchup doesn't re-process this deposit on restart
            let noteState = await NoteState.findOne({ key: "global", network: "aptos" });
            if (noteState) {
                noteState.lastProcessedBlock = Math.max(
                    noteState.lastProcessedBlock,
                    dbPool.lastProcessedBlock
                );
                await noteState.save();
            }

            return res.json({
                success: true,
                txHash: receipt.hash,
                latestRoot: state.latestRoot
            });

        } catch (err) {
            console.error("[aptos][deposit] Error:", err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });
}

// ─── Aptos Transfer Controller ───────────────────────────────────────────────

async function aptosTransferController(req, res) {
    return aptosMutex.run(async () => {
        try {
            const { proof, publicSignals, aBytes, bBytes, cBytes, enabled, poolIds, roots, nullifiers, outputEnabled, commitments, encNotes } = req.body;

            // ZK Verification
            const verified = await snarkjs.groth16.verify(transferVKey, publicSignals, proof);
            if (!verified) {
                return res.status(400).json({ success: false, message: "Invalid ZK proof" });
            }

            // Check nullifiers
            for (const n of nullifiers) {
                if (n === "0") continue;
                if (aptosSpentNullifiers.has(n)) {
                    return res.status(400).json({ success: false, message: `Nullifier ${n} already spent` });
                }
            }

            const poolId = "0";
            await initializeAptosPool(poolId);
            const state = aptosPoolStates[poolId];

            // Compute output roots on a THROWAWAY tree — do NOT mutate the
            // persistent in-memory tree until the tx actually succeeds, otherwise
            // a failed tx leaves phantom leaves that poison every future root.
            const tRoots = await computeOutputRoots(
                state.tree.leaves,
                commitments.map((c, j) => ({ enabled: outputEnabled[j] === 1, commitment: c }))
            );

            console.log("[aptos][transfer] Building transaction...");
            const tx = await aptos.transaction.build.simple({
                sender: relayerAccount.accountAddress,
                data: {
                    function: `${moduleAddr}::pool::transfer`,
                    typeArguments: [],
                    functionArguments: [
                        moduleAddr,
                        Array.from(toUint8Array(aBytes)),
                        Array.from(toUint8Array(bBytes)),
                        Array.from(toUint8Array(cBytes)),
                        enabled.map(x => x.toString()),
                        poolIds.map(x => x.toString()),
                        roots.map(x => x.toString()),
                        nullifiers.map(x => x.toString()),
                        outputEnabled.map(x => x.toString()),
                        commitments.map(x => x.toString()),
                        tRoots.map(x => x.toString()),
                        Array.from(Buffer.from(encNotes[0] || "")),
                        Array.from(Buffer.from(encNotes[1] || "")),
                        Array.from(Buffer.from(encNotes[2] || ""))
                    ]
                },
                options: { maxGasAmount: 2_000_000, gasUnitPrice: 100 }
            });

            const auth = await aptos.transaction.sign({ signer: relayerAccount, transaction: tx });
            console.log("[aptos][transfer] Submitting transfer transaction...");
            const result = await aptos.transaction.submit.simple({
                senderAuthenticator: auth,
                transaction: tx
            });

            const receipt = await aptos.waitForTransaction({ transactionHash: result.hash });

            // Update DB and memory states
            let dbPool = await PoolState.findOne({ network: "aptos", poolId });
            if (!dbPool) {
                dbPool = new PoolState({
                    network: "aptos",
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
            dbPool.lastProcessedBlock = Number(receipt.version) || 0;
            await dbPool.save();

            // Update NoteState so catchup doesn't re-process on restart
            let noteStateT = await NoteState.findOne({ key: "global", network: "aptos" });
            if (noteStateT) {
                noteStateT.lastProcessedBlock = Math.max(
                    noteStateT.lastProcessedBlock,
                    dbPool.lastProcessedBlock
                );
                await noteStateT.save();
            }

            // Update Spent Nullifiers
            let nullifierState = await NullifierState.findOne({ key: "global", network: "aptos" });
            if (nullifierState) {
                for (let i = 0; i < nullifiers.length; i++) {
                    if (enabled[i] === 1) {
                        const n = nullifiers[i];
                        aptosSpentNullifiers.add(n);
                        nullifierState.nullifiers.push(n);
                    }
                }
                await nullifierState.save();
            }

            return res.json({
                success: true,
                txHash: receipt.hash,
                latestRoot: lastRoot
            });

        } catch (err) {
            console.error("[aptos][transfer] Error:", err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });
}

// ─── Aptos Withdraw Controller ───────────────────────────────────────────────

async function aptosWithdrawController(req, res) {
    return aptosMutex.run(async () => {
        try {
            const { proof, publicSignals, aBytes, bBytes, cBytes, enabled, poolIds, roots, nullifiers, receiverAddress, withdrawAmount, outputEnabled, commitments, encNotes } = req.body;

            // ZK Verification
            const verified = await snarkjs.groth16.verify(withdrawVKey, publicSignals, proof);
            if (!verified) {
                return res.status(400).json({ success: false, message: "Invalid ZK proof" });
            }

            // Check nullifiers
            for (const n of nullifiers) {
                if (n === "0") continue;
                if (aptosSpentNullifiers.has(n)) {
                    return res.status(400).json({ success: false, message: `Nullifier ${n} already spent` });
                }
            }

            const poolId = "0";
            await initializeAptosPool(poolId);
            const state = aptosPoolStates[poolId];

            // Compute output roots on a THROWAWAY tree — do NOT mutate the
            // persistent in-memory tree until the tx actually succeeds, otherwise
            // a failed withdraw leaves phantom leaves that poison every future root.
            const wRoots = await computeOutputRoots(
                state.tree.leaves,
                commitments.map((c, j) => ({ enabled: outputEnabled[j] === 1, commitment: c }))
            );

            console.log("[aptos][withdraw] Building transaction...");
            const tx = await aptos.transaction.build.simple({
                sender: relayerAccount.accountAddress,
                data: {
                    function: `${moduleAddr}::pool::withdraw`,
                    typeArguments: [],
                    functionArguments: [
                        moduleAddr,
                        Array.from(toUint8Array(aBytes)),
                        Array.from(toUint8Array(bBytes)),
                        Array.from(toUint8Array(cBytes)),
                        enabled.map(x => x.toString()),
                        poolIds.map(x => x.toString()),
                        roots.map(x => x.toString()),
                        nullifiers.map(x => x.toString()),
                        receiverAddress.toString(),
                        withdrawAmount.toString(),
                        outputEnabled.map(x => x.toString()),
                        commitments.map(x => x.toString()),
                        wRoots,
                        Array.from(Buffer.from(encNotes[0] || "")),
                        Array.from(Buffer.from(encNotes[1] || ""))
                    ]
                },
                options: { maxGasAmount: 2_000_000, gasUnitPrice: 100 }
            });

            const auth = await aptos.transaction.sign({ signer: relayerAccount, transaction: tx });
            console.log("[aptos][withdraw] Submitting withdraw transaction...");
            const result = await aptos.transaction.submit.simple({
                senderAuthenticator: auth,
                transaction: tx
            });

            const receipt = await aptos.waitForTransaction({ transactionHash: result.hash });

            // Update DB and memory states
            let dbPool = await PoolState.findOne({ network: "aptos", poolId });
            if (!dbPool) {
                dbPool = new PoolState({
                    network: "aptos",
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
            dbPool.lastProcessedBlock = Number(receipt.version) || 0;
            await dbPool.save();

            // Update NoteState so catchup doesn't re-process on restart
            let noteStateW = await NoteState.findOne({ key: "global", network: "aptos" });
            if (noteStateW) {
                noteStateW.lastProcessedBlock = Math.max(
                    noteStateW.lastProcessedBlock,
                    dbPool.lastProcessedBlock
                );
                await noteStateW.save();
            }

            // Update Spent Nullifiers
            let nullifierState = await NullifierState.findOne({ key: "global", network: "aptos" });
            if (nullifierState) {
                for (let i = 0; i < nullifiers.length; i++) {
                    if (enabled[i] === 1) {
                        const n = nullifiers[i];
                        aptosSpentNullifiers.add(n);
                        nullifierState.nullifiers.push(n);
                    }
                }
                await nullifierState.save();
            }

            return res.json({
                success: true,
                txHash: receipt.hash,
                latestRoot: lastRoot
            });

        } catch (err) {
            console.error("[aptos][withdraw] Error:", err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });
}

module.exports = {
    aptosDepositController,
    aptosTransferController,
    aptosWithdrawController
};
