/**
 * poolUpdate.js
 *
 * Atomic MongoDB pool-state mutators.
 *
 * The Solana/Sui controllers no longer hold a mutex. Instead of the old
 * read-modify-write (`findOne` → mutate doc → `save()`) — which loses updates
 * under concurrency unless serialized — every write here uses atomic operators
 * ($push / $set / $addToSet) so concurrent requests cannot clobber each other.
 *
 * "Local" state (the in-memory Merkle tree / nullifier set) is still updated by
 * the caller; these helpers persist the "global" copy to the database.
 */
"use strict";

const PoolState      = require("../models/PoolState");
const NullifierState = require("../models/NullifierState");

/**
 * Atomically append a batch of freshly-inserted commitments to a pool document.
 *
 * @param {string} network            "solana" | "sui" | "aptos"
 * @param {string} poolId
 * @param {Array<{commitment:string, root:string, leafIndex:number, encNote?:string}>} entries
 *        commitments in on-chain insertion order
 * @param {string} latestRoot         the pool's newest root after this batch
 * @param {number} [lastProcessedBlock]
 */
async function appendCommitmentsAtomic(network, poolId, entries, latestRoot, lastProcessedBlock) {
    if (!entries || entries.length === 0) return;

    const push = {
        commitments: { $each: entries.map((e) => e.commitment) },
        roots:       { $each: entries.map((e) => e.root) }
    };

    const set = {};
    if (latestRoot !== undefined && latestRoot !== null) set.latestRoot = latestRoot;
    if (lastProcessedBlock !== undefined && lastProcessedBlock !== null) {
        set.lastProcessedBlock = lastProcessedBlock;
    }
    for (const e of entries) {
        set[`leafToIndex.${e.commitment}`] = e.leafIndex;
        if (e.encNote !== undefined && e.encNote !== null) {
            set[`encryptedNotes.${e.commitment}`] = e.encNote;
        }
    }

    await PoolState.updateOne(
        { network, poolId },
        { $push: push, $set: set },
        { upsert: true }
    );
}

/**
 * Atomically record spent nullifiers (idempotent via $addToSet). Skips "0"/falsy.
 *
 * @param {string} network
 * @param {string[]} nullifiers
 * @param {number} [lastProcessedBlock]
 */
async function addSpentNullifiersAtomic(network, nullifiers, lastProcessedBlock) {
    const list = (nullifiers || []).filter((n) => n && n !== "0");
    if (list.length === 0) return;

    const update = { $addToSet: { nullifiers: { $each: list } } };
    if (lastProcessedBlock !== undefined && lastProcessedBlock !== null) {
        update.$set = { lastProcessedBlock };
    }

    await NullifierState.updateOne(
        { key: "global", network },
        update,
        { upsert: true }
    );
}

module.exports = {
    appendCommitmentsAtomic,
    addSpentNullifiersAtomic
};
