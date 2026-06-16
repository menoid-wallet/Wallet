/**
 * solanaIndexer.js
 *
 * Catch-up for Solana. The route controllers (deposit/transfer/withdraw) write
 * every change straight to MongoDB, so the DB is the source of truth. On startup
 * we simply rebuild the in-memory caches (pool trees + spent nullifiers) from the
 * DB — there is no on-chain scan.
 */
"use strict";

const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");

const PoolState      = require("../models/PoolState");
const NullifierState = require("../models/NullifierState");

// Memory pool states for Solana
const solanaPoolStates = {};
const solanaSpentNullifiers = new Set();
let isSolanaSyncing = false;

async function initializeSolanaPool(poolId) {
    if (solanaPoolStates[poolId]) return;

    const poseidon = await circomlibjs.buildPoseidon();
    const hash = (inputs) => BigInt(poseidon.F.toString(poseidon(inputs)));
    const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);

    const dbPool = await PoolState.findOne({ network: "solana", poolId });
    if (dbPool) {
        // Deduplicate commitments if the DB was corrupted by the !0 re-insertion bug
        const seen = new Set();
        const unique = [];
        for (const c of dbPool.commitments) {
            if (!seen.has(c)) { seen.add(c); unique.push(c); }
        }
        if (unique.length < dbPool.commitments.length) {
            console.warn(`[solana] Deduplicating pool ${poolId}: ${dbPool.commitments.length} → ${unique.length} commitments`);
            const newRoots = [];
            dbPool.commitments = unique;
            dbPool.leafToIndex = new Map();
            for (let i = 0; i < unique.length; i++) {
                tree.insert(BigInt(unique[i]));
                dbPool.leafToIndex.set(unique[i], i);
                newRoots.push(tree.root.toString());
            }
            dbPool.roots = newRoots;
            dbPool.latestRoot = newRoots[newRoots.length - 1] || null;
            dbPool.markModified("leafToIndex");
            await dbPool.save();
        } else {
            for (const commitment of dbPool.commitments) {
                tree.insert(BigInt(commitment));
            }
        }
    }

    solanaPoolStates[poolId] = {
        tree,
        roots:       dbPool?.roots || [],
        latestRoot:  dbPool?.latestRoot || null,
        leafToIndex: dbPool?.leafToIndex ? Object.fromEntries(dbPool.leafToIndex) : {},
        encryptedNotes: dbPool?.encryptedNotes ? Object.fromEntries(dbPool.encryptedNotes) : {}
    };
}

async function catchUpSolana() {
    if (isSolanaSyncing) return;
    isSolanaSyncing = true;

    try {
        console.log("\n========== CATCHUP STARTED [solana] ==========");

        // Load spent nullifiers from the DB into memory (create the record if absent).
        let nullifierState = await NullifierState.findOne({ key: "global", network: "solana" });
        if (!nullifierState) {
            nullifierState = await NullifierState.create({ key: "global", network: "solana" });
        }
        for (const n of nullifierState.nullifiers) {
            solanaSpentNullifiers.add(n);
        }

        // Rebuild the in-memory pool trees from whatever the DB already has.
        // initializeSolanaPool loads commitments from the matching PoolState doc.
        const dbPools = await PoolState.find({ network: "solana" });
        if (dbPools.length > 0) {
            for (const dbPool of dbPools) {
                await initializeSolanaPool(dbPool.poolId);
            }
        } else {
            // Nothing stored yet — initialize the default empty pool.
            await initializeSolanaPool("0");
        }

        console.log(`[solana] Loaded ${dbPools.length} pool(s), ${solanaSpentNullifiers.size} nullifier(s) from DB`);
        console.log("========== CATCHUP COMPLETE [solana] ==========");
    } catch (err) {
        console.error("[solana] Catchup failed:", err);
    } finally {
        isSolanaSyncing = false;
    }
}

module.exports = {
    catchUpSolana,
    solanaPoolStates,
    solanaSpentNullifiers,
    initializeSolanaPool
};
