/**
 * poolIndexer.js
 *
 * EVM pool state — DB is the source of truth (like Solana/Sui/Aptos).
 *
 * There is NO block-to-block scanning / 10s sync loop anymore. Instead:
 *   - On startup, `catchUpPools()` simply loads existing pool/nullifier records
 *     from the DB into the in-memory caches (an existence check + rebuild).
 *   - Every deposit/transfer/withdraw that the backend
 *     broadcasts calls `applyReceiptEvents()` with the confirmed receipt, which
 *     parses the on-chain events (NoteCreated / NullifierSpent)
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
const { Mutex } = require("../helpers/mutex");
const { reconcilePool, onchainPool } = require("../helpers/reconcileEvm");

/* One lock per network. Receipts must be applied to the in-memory tree in CHAIN
   order; two deposits whose HTTP handlers finish out of order would otherwise
   insert their leaves swapped — a tree the chain never had. Serializing, plus
   the root check below, makes that impossible to persist. */
const evmLocks = {
    monad:        new Mutex(),
    sepolia:      new Mutex(),
    base_sepolia: new Mutex()
};

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
// deposit/transfer/withdraw on `network`.

/**
 * Thrown when a confirmed receipt carries pool events this backend will not
 * index, because they came from a DIFFERENT pool than the one it is configured
 * with. It is a deployment mistake, not a user error.
 */
class PoolAddressMismatchError extends Error {
    constructor(network, configured, seen, txHash) {
        super(
            `[${network}] this backend is configured for pool ${configured}, but the ` +
            `confirmed transaction emitted NoidPool events from ${seen}. The funds are ` +
            `on-chain and safe, but they were NOT indexed — fix the pool address for ` +
            `${network} and re-run reconcile_evm_state.js to pick them up.`
        );
        this.name = "PoolAddressMismatchError";
        this.network = network;
        this.configured = configured;
        this.seen = seen;
        this.txHash = txHash;
    }
}

/**
 * Drop the in-memory copy of a pool and reload it from the DB.
 * Used after a repair rewrote the DB from the chain.
 */
async function reloadPool(network, poolId) {
    delete poolStates[network][poolId];
    await initializePool(network, poolId);
}

/**
 * Rewrite a pool from the chain (root-verified) and reload it into memory.
 * Safe to call any time; a pool already in sync is a single RPC call.
 */
async function repairPool(network, poolId, reason) {
    console.error(`[${network}] pool ${poolId}: ${reason} — repairing from chain`);
    const result = await reconcilePool(network, poolId);
    await reloadPool(network, poolId);
    return result;
}

async function applyReceiptEvents(network, receipt) {
    const lock = evmLocks[network];
    if (!lock) throw new Error(`no EVM lock for network ${network}`);
    return lock.run(() => applyReceiptEventsLocked(network, receipt));
}

async function applyReceiptEventsLocked(network, receipt) {
    const privatePool = getPrivatePoolForNetwork(network);
    const iface       = privatePool.interface;
    const poolAddr    = (await privatePool.getAddress()).toLowerCase();

    const notesByPool  = {};   // poolId -> [{ commitment, encryptedNote }] (log order)
    const nulls        = [];   // hex bytes32 nullifiers

    /* A receipt whose NoidPool events come from an address we are not watching
       is the one failure that used to pass silently: every log was skipped, the
       route answered `success: true`, and the user's deposit existed on-chain
       with nothing in the database to spend it from. Detect it and refuse. */
    for (const log of receipt.logs || []) {
        if (!log.address || log.address.toLowerCase() === poolAddr) continue;
        let foreign;
        try { foreign = iface.parseLog({ topics: log.topics, data: log.data }); }
        catch { continue; }   // genuinely someone else's event — not our business
        if (foreign && (foreign.name === "NoteCreated" || foreign.name === "NullifierSpent")) {
            throw new PoolAddressMismatchError(
                network, poolAddr, log.address.toLowerCase(), receipt.hash
            );
        }
    }

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
        let state = poolStates[network][poolId];

        // Idempotent: a repair may already have restored these leaves.
        const fresh = notes.filter((n) => state.leafToIndex[n.commitment] === undefined);
        if (!fresh.length) { latestRoots[poolId] = state.latestRoot; continue; }

        // What would the chain say after this receipt? Ask BEFORE persisting.
        let chain = null;
        try {
            chain = await onchainPool(network, poolId, receipt.blockNumber);
        } catch (e) {
            console.warn(`[${network}] could not read pool ${poolId} at block ${receipt.blockNumber} to verify: ${e.message}`);
        }

        // Build the prospective tree without touching the live one yet.
        const expectedLeaves = state.tree.leaves.length + fresh.length;
        if (chain && chain.leaves !== expectedLeaves) {
            // Leaves exist on-chain that this backend never saw (or the reverse).
            // Appending would bake the gap into every future proof.
            await repairPool(
                network, poolId,
                `leaf count mismatch after ${receipt.hash} (backend would have ${expectedLeaves}, chain has ${chain.leaves})`
            );
            latestRoots[poolId] = poolStates[network][poolId].latestRoot;
            continue;
        }

        const entries = [];
        for (const { commitment, encryptedNote } of fresh) {
            state.tree.insert(BigInt(commitment));
            const leafIndex = state.tree.leaves.length - 1;
            const root      = state.tree.root.toString();

            state.roots.push(root);
            state.latestRoot                 = root;
            state.leafToIndex[commitment]    = leafIndex;
            state.encryptedNotes[commitment] = encryptedNote;

            entries.push({ commitment, root, leafIndex, encNote: encryptedNote });
        }

        if (chain && chain.root !== state.latestRoot) {
            // Same count, different root: a leaf is in the wrong place.
            await repairPool(
                network, poolId,
                `root mismatch after ${receipt.hash} (backend ${state.latestRoot.slice(0, 16)}…, chain ${chain.root.slice(0, 16)}…)`
            );
            latestRoots[poolId] = poolStates[network][poolId].latestRoot;
            continue;
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

/**
 * Boot-time guarantee: every EVM pool in memory matches the chain before the
 * backend indexes anything. A pool already in sync costs one RPC call.
 * Runs under each network's lock, so a receipt arriving meanwhile waits.
 */
async function verifyPoolsAgainstChain() {
    for (const network of EVM_NETWORKS) {
        await evmLocks[network].run(async () => {
            for (const poolId of Object.keys(poolStates[network]).length ? Object.keys(poolStates[network]) : ["0"]) {
                try {
                    const r = await reconcilePool(network, poolId, { log: () => {} });
                    if (r.changed) {
                        console.error(`[${network}] pool ${poolId} was out of sync at boot — repaired from chain (${(r.added || []).length} restored)`);
                        await reloadPool(network, poolId);
                    } else {
                        console.log(`  [tree-check] ${network.padEnd(13)} pool ${poolId}: ${r.leaves} leaves, matches chain`);
                    }
                } catch (e) {
                    console.error(`  [tree-check] ${network.padEnd(13)} pool ${poolId}: could not verify — ${e.message}`);
                }
            }
        });
    }
}

module.exports = {
    EVM_NETWORKS,
    poolStates,
    spentNullifiers,
    initializePool,
    catchUpPools,
    applyReceiptEvents,
    verifyPoolsAgainstChain,
    PoolAddressMismatchError
};
