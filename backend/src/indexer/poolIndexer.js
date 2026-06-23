/**
 * poolIndexer.js
 *
 * EVM pool state — DB is the source of truth (like Solana/Sui/Aptos).
 *
 * There is NO block-to-block scanning / 10s sync loop anymore. Instead:
 *   - On startup, `catchUpPools()` simply loads existing pool/nullifier records
 *     from the DB into the in-memory caches (an existence check + rebuild).
 *   - Every deposit/transfer/withdraw/createNoidAccount that the backend
 *     broadcasts calls `applyReceiptEvents()` with the confirmed receipt, which
 *     parses the on-chain events (NoteCreated / NullifierSpent / NoidAccountCreated)
 *     and updates the pools locally (in-memory tree) and globally (DB, atomic ops).
 *
 * EVM commitments/nullifiers are kept in their on-chain hex (bytes32) form — the
 * same format the previous indexer used and the wallet already understands.
 */
"use strict";

const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");

const { getPrivatePoolForNetwork } = require("../contracts/privatePool");

const PoolState        = require("../models/PoolState");
const NullifierState   = require("../models/NullifierState");


const { appendCommitmentsAtomic, addSpentNullifiersAtomic } = require("../helpers/poolUpdate");

require("dotenv").config();

const EVM_NETWORKS = ["monad", "sepolia", "base_sepolia"];

// poolStates[network][poolId] = { tree, roots, latestRoot, leafToIndex, encryptedNotes }
const poolStates = {
    monad:        {},
    sepolia:      {},
    base_sepolia: {}
};

// spentNullifiers[network] = Set<string> (hex bytes32, as emitted on-chain)
const spentNullifiers = {
    monad:        new Set(),
    sepolia:      new Set(),
    base_sepolia: new Set()
};

let _poseidon = null;
async function getHashFn() {
    if (!_poseidon) _poseidon = await circomlibjs.buildPoseidon();
    const p = _poseidon;
    return (inputs) => BigInt(p.F.toString(p(inputs)));
}

// ─── Initialize a single pool (in-memory tree + caches from DB) ──────────────

async function initializePool(network, poolId) {
    if (poolStates[network][poolId]) return;

    const hash = await getHashFn();
    const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);

    const dbPool = await PoolState.findOne({ network, poolId });
    if (dbPool) {
        for (const commitment of dbPool.commitments) {
            tree.insert(BigInt(commitment));
        }
    }

    poolStates[network][poolId] = {
        tree,
        roots:          dbPool?.roots || [],
        latestRoot:     dbPool?.latestRoot || null,
        leafToIndex:    dbPool?.leafToIndex ? Object.fromEntries(dbPool.leafToIndex) : {},
        encryptedNotes: dbPool?.encryptedNotes ? Object.fromEntries(dbPool.encryptedNotes) : {}
    };

    console.log(`Pool ${poolId} [${network}] loaded from DB (${dbPool?.commitments?.length || 0} commitments)`);
}

// ─── Catch-up = load existing DB state into memory (no on-chain scan) ────────

async function catchUpPools() {
    for (const network of EVM_NETWORKS) {
        console.log(`\n========== CATCHUP STARTED [${network}] ==========`);

        let nullifierState = await NullifierState.findOne({ key: "global", network });
        if (!nullifierState) {
            nullifierState = await NullifierState.create({ key: "global", network });
        }
        for (const n of nullifierState.nullifiers) spentNullifiers[network].add(n);

        const dbPools = await PoolState.find({ network });
        if (dbPools.length > 0) {
            for (const dbPool of dbPools) await initializePool(network, dbPool.poolId);
        } else {
            await initializePool(network, "0");
        }

        console.log(`[${network}] Loaded ${dbPools.length} pool(s), ${spentNullifiers[network].size} nullifier(s) from DB`);
        console.log(`========== CATCHUP COMPLETE [${network}] ==========`);
    }
    console.log("\n========== ALL EVM CHAINS LOADED ==========");
}

// ─── Apply a confirmed tx receipt to the pools (local + global) ──────────────
//
// Parses the pool contract's events from the receipt and updates state inline —
// this replaces the old block-scanning sync. Safe to call after any successful
// deposit/transfer/withdraw/createNoidAccount on `network`.

async function applyReceiptEvents(network, receipt) {
    const privatePool = getPrivatePoolForNetwork(network);
    const iface       = privatePool.interface;
    const poolAddr    = (await privatePool.getAddress()).toLowerCase();

    const notesByPool  = {};   // poolId -> [{ commitment, encryptedNote }] (log order)
    const nulls        = [];   // hex bytes32 nullifiers


    for (const log of receipt.logs || []) {
        if (!log.address || log.address.toLowerCase() !== poolAddr) continue;
        let parsed;
        try { parsed = iface.parseLog({ topics: log.topics, data: log.data }); }
        catch { continue; }
        if (!parsed) continue;

        if (parsed.name === "NoteCreated") {
            const poolId = parsed.args.poolId.toString();
            (notesByPool[poolId] ||= []).push({
                commitment:    parsed.args.commitment,      // hex bytes32
                encryptedNote: parsed.args.encryptedNote    // hex bytes
            });
        } else if (parsed.name === "NullifierSpent") {
            nulls.push(parsed.args.nullifier);              // hex bytes32

        }
    }

    // ── Notes → per-pool commitments (recompute root via the in-memory tree) ──
    const latestRoots = {};
    for (const [poolId, notes] of Object.entries(notesByPool)) {
        await initializePool(network, poolId);
        const state = poolStates[network][poolId];

        const entries = [];
        for (const { commitment, encryptedNote } of notes) {
            state.tree.insert(BigInt(commitment));
            const leafIndex = state.tree.leaves.length - 1;
            const root      = state.tree.root.toString();

            state.roots.push(root);
            state.latestRoot                 = root;
            state.leafToIndex[commitment]    = leafIndex;
            state.encryptedNotes[commitment] = encryptedNote;

            entries.push({ commitment, root, leafIndex, encNote: encryptedNote });
        }
        await appendCommitmentsAtomic(network, poolId, entries, state.latestRoot, receipt.blockNumber);
        latestRoots[poolId] = state.latestRoot;
    }

    // ── Nullifiers ──
    if (nulls.length) {
        for (const n of nulls) spentNullifiers[network].add(n);
        await addSpentNullifiersAtomic(network, nulls, receipt.blockNumber);
    }



    return { latestRoots };
}

module.exports = {
    EVM_NETWORKS,
    poolStates,
    spentNullifiers,
    initializePool,
    catchUpPools,
    applyReceiptEvents
};
