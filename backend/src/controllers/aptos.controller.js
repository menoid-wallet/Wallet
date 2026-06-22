/**
 * aptos.controller.js
 *
 * Route controllers for Aptos.
 *
 * Aptos has NO native Poseidon, so the pool contract cannot recompute the Merkle
 * root. Instead deposit/transfer/withdraw only QUEUE the output commitments
 * (pending_commitments); the relayer must then call pool::update_root once per
 * queued commitment, attaching a `new_root` ZK proof bound to the contract's live
 * subtrees-hash + next_idx. This whole sequence MUST be atomic, so every Aptos
 * route runs under `aptosMutex` (the contract also rejects a new deposit/transfer/
 * withdraw while pending_commitments is non-empty).
 *
 * Flow per route (all inside the mutex):
 *   deposit : submit the user-signed deposit (fee-payer) → drain pending via update_root
 *   transfer: verify proof → submit transfer → drain pending via update_root
 *   withdraw: verify proof → submit withdraw (pays receiver) → drain pending
 * Pools are then updated locally (in-memory tree + subtree mirror) and globally (DB).
 */
"use strict";

const { SimpleTransaction, AccountAuthenticator, Deserializer } = require("@aptos-labs/ts-sdk");
const snarkjs = require("snarkjs");

const { aptos, relayerAccount, moduleAddr, poolAddr } = require("../config/aptosProvider");
const { aptosMutex } = require("../helpers/mutex");
const { aptosPoolStates, aptosSpentNullifiers, initializeAptosPool } = require("../indexer/aptosIndexer");
const { buildNewRootProofs, subtreesHash } = require("../helpers/aptosNewRoot");
const { appendCommitmentsAtomic, addSpentNullifiersAtomic } = require("../helpers/poolUpdate");

const transferVKey = require("../zk/aptos/transfer_verification_key.json");
const withdrawVKey = require("../zk/aptos/withdraw_verification_key.json");

const POOL_ID = "0";

function toUint8Array(val) {
    if (Array.isArray(val)) return Uint8Array.from(val);
    if (typeof val === "string") {
        const hex = val.startsWith("0x") ? val.slice(2) : val;
        return Uint8Array.from(Buffer.from(hex, "hex"));
    }
    return val;
}

// ─── On-chain helpers ─────────────────────────────────────────────────────────

async function viewPool(fn, args) {
    return aptos.view({
        payload: { function: `${moduleAddr}::pool::${fn}`, typeArguments: [], functionArguments: args }
    });
}

/** Build, sign (relayer) and submit a Move entry-function call; wait for success. */
async function submitRelayerTx(payload) {
    const tx = await aptos.transaction.build.simple({
        sender: relayerAccount.accountAddress,
        data: payload,
        options: { maxGasAmount: 2_000_000, gasUnitPrice: 100 }
    });
    const auth = await aptos.transaction.sign({ signer: relayerAccount, transaction: tx });
    const result = await aptos.transaction.submit.simple({ senderAuthenticator: auth, transaction: tx });
    const receipt = await aptos.waitForTransaction({ transactionHash: result.hash });
    if (!receipt.success) throw new Error(`Aptos tx failed: ${result.hash}`);
    return receipt;
}

/**
 * Defensive check that the off-chain subtree mirror matches the contract's live
 * state before generating new_root proofs (a mismatch means a doomed proof).
 */
async function assertMirrorInSync(state) {
    const [chainHash] = await viewPool("current_subtrees_hash", [poolAddr, POOL_ID]);
    const [chainNextIdx] = await viewPool("next_index", [poolAddr, POOL_ID]);
    const localHash = await subtreesHash(state.subtrees);
    if (String(chainNextIdx) !== String(state.nextIdx) || String(chainHash) !== String(localHash)) {
        throw new Error(
            `Aptos subtree mirror out of sync — chain(nextIdx=${chainNextIdx}, hash=${chainHash}) ` +
            `vs local(nextIdx=${state.nextIdx}, hash=${localHash}). A resync from chain is required.`
        );
    }
}

/**
 * Drain the queued commitments by calling pool::update_root once per commitment
 * (each with its own new_root proof, in insertion order). On success, commit the
 * advanced subtree mirror + in-memory tree, and persist to the DB atomically.
 *
 * @param state                in-memory pool state (mutated)
 * @param orderedCommitments   commitments in on-chain pending order
 * @param encByCommitment      map commitment → encrypted note
 * @param spentNullifiers      nullifiers to record as spent (transfer/withdraw)
 * @param version              tx version for lastProcessedBlock
 */
async function drainPendingAndPersist(state, orderedCommitments, encByCommitment, spentNullifiers, version) {
    // Generate the sequential new_root proofs from the current mirror.
    const { proofs, finalSubtrees, finalNextIdx } =
        await buildNewRootProofs(state.subtrees, state.nextIdx, orderedCommitments);

    // Apply each proof on-chain in order (contract checks first_pending == commitment).
    for (const pr of proofs) {
        await submitRelayerTx({
            function: `${moduleAddr}::pool::update_root`,
            typeArguments: [],
            functionArguments: [
                poolAddr,
                pr.commitment,
                pr.aBytes, pr.bBytes, pr.cBytes,
                pr.newRoot,
                pr.newSubtreesHash
            ]
        });
    }

    // All inserts landed — commit local mirror + in-memory tree, then persist.
    const entries = [];
    for (const pr of proofs) {
        const commitment = pr.commitment;
        state.tree.insert(BigInt(commitment));
        const leafIndex = state.tree.leaves.length - 1;
        const root = pr.newRoot; // authoritative root proven + stored on-chain

        state.roots.push(root);
        state.latestRoot = root;
        state.leafToIndex[commitment] = leafIndex;
        const encNote = encByCommitment[commitment];
        if (encNote !== undefined) state.encryptedNotes[commitment] = encNote;

        entries.push({ commitment, root, leafIndex, encNote });
    }
    state.subtrees = finalSubtrees;
    state.nextIdx = finalNextIdx;

    await appendCommitmentsAtomic("aptos", POOL_ID, entries, state.latestRoot, version);
    if (spentNullifiers && spentNullifiers.length) {
        for (const n of spentNullifiers) aptosSpentNullifiers.add(String(n));
        await addSpentNullifiersAtomic("aptos", spentNullifiers, version);
    }
    return state.latestRoot;
}

/** Collect enabled output commitments (in c_outs order) and their encrypted notes. */
function enabledOutputs(commitments, outputEnabled, encNotes) {
    const ordered = [];
    const encByCommitment = {};
    for (let j = 0; j < commitments.length; j++) {
        if (outputEnabled[j] === 1) {
            const c = String(commitments[j]);
            ordered.push(c);
            encByCommitment[c] = encNotes ? encNotes[j] : undefined;
        }
    }
    return { ordered, encByCommitment };
}

// ─── Aptos Deposit ────────────────────────────────────────────────────────────
// User signs the deposit (sender); relayer co-signs as fee payer and forwards it.
// deposit() queues c1,c2 → relayer drains them with update_root.

async function aptosDepositController(req, res) {
    return aptosMutex.run(async () => {
        try {
            const { rawTxBytes, senderAuth, commitments, encryptedNotes } = req.body;
            if (!rawTxBytes || !senderAuth) {
                return res.status(400).json({ success: false, message: "Missing rawTxBytes or senderAuth" });
            }
            if (!Array.isArray(commitments) || commitments.length === 0) {
                return res.status(400).json({ success: false, message: "Missing commitments" });
            }

            await initializeAptosPool(POOL_ID);
            const state = aptosPoolStates[POOL_ID];
            await assertMirrorInSync(state);

            // Deserialize + submit the user-signed deposit (fee-payer sponsored).
            const txn = SimpleTransaction.deserialize(new Deserializer(toUint8Array(rawTxBytes)));
            const senderAuthenticator = AccountAuthenticator.deserialize(new Deserializer(toUint8Array(senderAuth)));

            let feePayerAuthenticator;
            if (txn.feePayerAddress !== undefined) {
                feePayerAuthenticator = await aptos.transaction.signAsFeePayer({ signer: relayerAccount, transaction: txn });
            }

            console.log("[aptos][deposit] Submitting deposit transaction...");
            const result = await aptos.transaction.submit.simple({
                transaction: txn,
                senderAuthenticator,
                ...(feePayerAuthenticator ? { feePayerAuthenticator } : {})
            });
            const receipt = await aptos.waitForTransaction({ transactionHash: result.hash });
            if (!receipt.success) throw new Error(`Deposit tx failed: ${result.hash}`);
            console.log(`[aptos][deposit] Deposit landed: ${receipt.hash} — draining pending...`);

            // Drain the two queued commitments via update_root, then persist.
            const ordered = commitments.map(String);
            const encByCommitment = {};
            for (let i = 0; i < ordered.length; i++) {
                encByCommitment[ordered[i]] = encryptedNotes ? encryptedNotes[i] : undefined;
            }
            const latestRoot = await drainPendingAndPersist(
                state, ordered, encByCommitment, [], Number(receipt.version) || 0
            );

            return res.json({ success: true, txHash: receipt.hash, latestRoot });
        } catch (err) {
            console.error("[aptos][deposit] Error:", err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });
}

// ─── Aptos Transfer ─────────────────────────────────────────────────────────

async function aptosTransferController(req, res) {
    return aptosMutex.run(async () => {
        try {
            const { proof, publicSignals, aBytes, bBytes, cBytes, enabled, poolIds, roots, nullifiers, outputEnabled, commitments, encNotes } = req.body;

            const verified = await snarkjs.groth16.verify(transferVKey, publicSignals, proof);
            if (!verified) {
                return res.status(400).json({ success: false, message: "Invalid ZK proof" });
            }
            for (const n of nullifiers) {
                if (n === "0") continue;
                if (aptosSpentNullifiers.has(String(n))) {
                    return res.status(400).json({ success: false, message: `Nullifier ${n} already spent` });
                }
            }

            await initializeAptosPool(POOL_ID);
            const state = aptosPoolStates[POOL_ID];
            await assertMirrorInSync(state);

            // 1. Submit transfer — verifies the proof, spends nullifiers, queues outputs.
            console.log("[aptos][transfer] Submitting transfer transaction...");
            const receipt = await submitRelayerTx({
                function: `${moduleAddr}::pool::transfer`,
                typeArguments: [],
                functionArguments: [
                    poolAddr,
                    Array.from(toUint8Array(aBytes)),
                    Array.from(toUint8Array(bBytes)),
                    Array.from(toUint8Array(cBytes)),
                    enabled,
                    poolIds.map((x) => String(x)),
                    roots.map((x) => String(x)),
                    nullifiers.map((x) => String(x)),
                    outputEnabled,
                    commitments.map((x) => String(x)),
                    Array.from(Buffer.from(encNotes[0] || "")),
                    Array.from(Buffer.from(encNotes[1] || "")),
                    Array.from(Buffer.from(encNotes[2] || ""))
                ]
            });

            // 2. Drain queued outputs via update_root, persist, record nullifiers.
            const { ordered, encByCommitment } = enabledOutputs(commitments, outputEnabled, encNotes);
            const spent = nullifiers.filter((_, i) => enabled[i] === 1);
            const latestRoot = await drainPendingAndPersist(
                state, ordered, encByCommitment, spent, Number(receipt.version) || 0
            );

            return res.json({ success: true, txHash: receipt.hash, latestRoot });
        } catch (err) {
            console.error("[aptos][transfer] Error:", err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });
}

// ─── Aptos Withdraw ───────────────────────────────────────────────────────────

async function aptosWithdrawController(req, res) {
    return aptosMutex.run(async () => {
        try {
            const { proof, publicSignals, aBytes, bBytes, cBytes, enabled, poolIds, roots, nullifiers, receiverAddress, withdrawAmount, outputEnabled, commitments, encNotes } = req.body;

            const verified = await snarkjs.groth16.verify(withdrawVKey, publicSignals, proof);
            if (!verified) {
                return res.status(400).json({ success: false, message: "Invalid ZK proof" });
            }
            for (const n of nullifiers) {
                if (n === "0") continue;
                if (aptosSpentNullifiers.has(String(n))) {
                    return res.status(400).json({ success: false, message: `Nullifier ${n} already spent` });
                }
            }

            await initializeAptosPool(POOL_ID);
            const state = aptosPoolStates[POOL_ID];
            await assertMirrorInSync(state);

            // 1. Submit withdraw — verifies proof, spends nullifiers, pays receiver, queues change.
            console.log("[aptos][withdraw] Submitting withdraw transaction...");
            const receipt = await submitRelayerTx({
                function: `${moduleAddr}::pool::withdraw`,
                typeArguments: [],
                functionArguments: [
                    poolAddr,
                    Array.from(toUint8Array(aBytes)),
                    Array.from(toUint8Array(bBytes)),
                    Array.from(toUint8Array(cBytes)),
                    enabled,
                    poolIds.map((x) => String(x)),
                    roots.map((x) => String(x)),
                    nullifiers.map((x) => String(x)),
                    receiverAddress.toString(),
                    String(withdrawAmount),
                    outputEnabled,
                    commitments.map((x) => String(x)),
                    Array.from(Buffer.from(encNotes[0] || "")),
                    Array.from(Buffer.from(encNotes[1] || ""))
                ]
            });

            // 2. Drain queued change outputs via update_root, persist, record nullifiers.
            const { ordered, encByCommitment } = enabledOutputs(commitments, outputEnabled, encNotes);
            const spent = nullifiers.filter((_, i) => enabled[i] === 1);
            const latestRoot = await drainPendingAndPersist(
                state, ordered, encByCommitment, spent, Number(receipt.version) || 0
            );

            return res.json({ success: true, txHash: receipt.hash, latestRoot });
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
