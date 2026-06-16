/**
 * suiIndexer.js
 *
 * Catch-up for Sui. The route controllers (deposit/transfer/withdraw) write every
 * change straight to MongoDB, so the DB is the source of truth. On startup we
 * simply rebuild the in-memory caches (pool trees + spent nullifiers) from the
 * DB — there is no on-chain scan.
 */
"use strict";

const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");

const PoolState      = require("../models/PoolState");
const NullifierState = require("../models/NullifierState");

// Memory pool states for Sui
const suiPoolStates = {};
const suiSpentNullifiers = new Set();
let isSuiSyncing = false;

async function initializeSuiPool(poolId) {
    if (suiPoolStates[poolId]) return;

    const poseidon = await circomlibjs.buildPoseidon();
    const hash = (inputs) => BigInt(poseidon.F.toString(poseidon(inputs)));
    const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);

    const dbPool = await PoolState.findOne({ network: "sui", poolId });
    if (dbPool) {
        for (const commitment of dbPool.commitments) {
            tree.insert(BigInt(commitment));
        }
    }

    suiPoolStates[poolId] = {
        tree,
        roots:       dbPool?.roots || [],
        latestRoot:  dbPool?.latestRoot || null,
        leafToIndex: dbPool?.leafToIndex ? Object.fromEntries(dbPool.leafToIndex) : {},
        encryptedNotes: dbPool?.encryptedNotes ? Object.fromEntries(dbPool.encryptedNotes) : {}
    };
}

async function catchUpSui() {
    if (isSuiSyncing) return;
    isSuiSyncing = true;

    try {
        console.log("\n========== CATCHUP STARTED [sui] ==========");

        // Load spent nullifiers from the DB into memory (create the record if absent).
        let nullifierState = await NullifierState.findOne({ key: "global", network: "sui" });
        if (!nullifierState) {
            nullifierState = await NullifierState.create({ key: "global", network: "sui" });
        }
        for (const n of nullifierState.nullifiers) {
            suiSpentNullifiers.add(n);
        }

        // Rebuild the in-memory pool trees from whatever the DB already has.
        // initializeSuiPool loads commitments from the matching PoolState doc.
        const dbPools = await PoolState.find({ network: "sui" });
        if (dbPools.length > 0) {
            for (const dbPool of dbPools) {
                await initializeSuiPool(dbPool.poolId);
            }
        } else {
            // Nothing stored yet — initialize the default empty pool.
            await initializeSuiPool("0");
        }

        console.log(`[sui] Loaded ${dbPools.length} pool(s), ${suiSpentNullifiers.size} nullifier(s) from DB`);
        console.log("========== CATCHUP COMPLETE [sui] ==========");
    } catch (err) {
        console.error("[sui] Catchup failed:", err);
    } finally {
        isSuiSyncing = false;
    }
}

module.exports = {
    catchUpSui,
    suiPoolStates,
    suiSpentNullifiers,
    initializeSuiPool
};
