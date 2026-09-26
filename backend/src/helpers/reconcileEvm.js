/**
 * reconcileEvm.js — make the DB's Merkle tree for an EVM pool match the chain.
 *
 * The backend keeps its own copy of every pool's leaves (the wallet builds its
 * Merkle proofs from that copy). If a single leaf is missing or out of order,
 * every proof built afterwards is against a root the contract has never seen,
 * and every transfer and withdraw fails with "Invalid root" — for every user,
 * not just the one whose note went missing.
 *
 * GROUND TRUTH IS THE CONTRACT'S OWN ROOT
 * ---------------------------------------
 * `pools(poolId)` returns the current root and leaf count. A reconstruction is
 * accepted only if it hashes to exactly that root — which is a cryptographic
 * proof that every leaf is present and in the right position. Nothing is
 * written on a guess.
 *
 * FAST PATH
 * ---------
 * Scanning a pool's whole history 100 blocks at a time (Monad's eth_getLogs cap)
 * is hundreds of thousands of blocks. Instead we scan BACKWARD from head and,
 * after each window, try "the DB's first k leaves + everything scanned so far".
 * As soon as that hashes to the on-chain root we stop. When the damage is
 * recent — the usual case — that is a few windows, not the whole chain.
 */
"use strict";

const { ethers } = require("ethers");
const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");

const providerModule = require("../config/provider");
const PoolState = require("../models/PoolState");

const TREE_DEPTH = 20;
const WINDOW = 100; // Monad caps eth_getLogs at a 100-block range

const POOL_ABI = [
    "function pools(uint256) view returns (bytes32 root, uint32 rootPtr, uint32 nextIdx)",
    "event NoteCreated(uint256 poolId, bytes32 commitment, bytes encryptedNote)"
];

const DEPLOY_BLOCK_ENV = {
    monad:        "MONAD_PRIVATE_POOL_DEPLOY_BLOCK",
    sepolia:      "SEPOLIA_PRIVATE_POOL_DEPLOY_BLOCK",
    base_sepolia: "BASE_SEPOLIA_PRIVATE_POOL_DEPLOY_BLOCK"
};

let _hash = null;
async function hashFn() {
    if (!_hash) {
        const p = await circomlibjs.buildPoseidon();
        _hash = (inputs) => BigInt(p.F.toString(p(inputs)));
    }
    return _hash;
}

async function buildTree(commitments) {
    const hash = await hashFn();
    const tree = new IncrementalMerkleTree(hash, TREE_DEPTH, BigInt(0), 2);
    const roots = [];
    const leafToIndex = {};
    for (const c of commitments) {
        tree.insert(BigInt(c));
        roots.push(tree.root.toString());
        leafToIndex[c] = tree.leaves.length - 1;
    }
    return { tree, roots, leafToIndex };
}

async function withRetry(fn, label) {
    for (let attempt = 0; ; attempt++) {
        try { return await fn(); }
        catch (e) {
            if (attempt >= 4) throw new Error(`${label}: ${e.shortMessage || e.message}`);
            await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        }
    }
}

/** On-chain root + leaf count for a pool. */
async function onchainPool(network, poolId = "0", blockTag) {
    const provider = providerModule.getReadProviderForNetwork(network, 0);
    const address = providerModule.getPoolAddressForNetwork(network);
    const pool = new ethers.Contract(address, POOL_ABI, provider);
    const p = await withRetry(
        () => pool.pools(poolId, blockTag !== undefined ? { blockTag } : {}),
        `pools(${poolId})`
    );
    return { root: BigInt(p.root).toString(), leaves: Number(p.nextIdx), address, provider, pool };
}

/**
 * Reconcile one pool. Returns a summary; writes only when the result hashes to
 * the on-chain root (and `dryRun` is false).
 */
async function reconcilePool(network, poolId = "0", { dryRun = false, log = console.log } = {}) {
    const chain = await onchainPool(network, poolId);
    const db = await PoolState.findOne({ network, poolId });
    const dbLeaves = db?.commitments ? [...db.commitments] : [];

    log(`[reconcile][${network}] pool ${poolId}: chain ${chain.leaves} leaves, DB ${dbLeaves.length}`);

    // Already exact? Rebuild the DB's tree and compare roots, not just counts —
    // the same count in the wrong order is still broken.
    if (dbLeaves.length === chain.leaves) {
        const { tree, roots, leafToIndex } = await buildTree(dbLeaves);
        if (tree.root.toString() === chain.root) {
            /* Leaves are right — but the DERIVED fields (latestRoot, the
               leafToIndex map, the roots list) are written by whichever process
               indexed each receipt, and a process holding a stale tree writes
               them wrong while appending leaves in the right order. Wallets
               read leafToIndex; a wrong entry is a proof for the wrong leaf. */
            const dbIdx = db?.leafToIndex instanceof Map ? Object.fromEntries(db.leafToIndex) : (db?.leafToIndex || {});
            const badIdx = Object.entries(leafToIndex).filter(([c, i]) => dbIdx[c] !== i).length;
            const badRoot = db?.latestRoot !== chain.root;
            if (!badIdx && !badRoot) {
                log(`[reconcile][${network}] in sync (root ${chain.root.slice(0, 16)}…)`);
                return { network, poolId, changed: false, leaves: chain.leaves };
            }
            log(`[reconcile][${network}] leaves correct, but ${badIdx} leaf index(es) and ${badRoot ? "the latest root are" : "no root is"} stale — rewriting derived fields`);
            if (!dryRun) {
                await PoolState.updateOne(
                    { network, poolId },
                    { $set: { roots, latestRoot: roots[roots.length - 1], leafToIndex } }
                );
                log(`[reconcile][${network}] derived fields rewritten`);
            }
            return { network, poolId, changed: true, dryRun, added: [], moved: [], leaves: chain.leaves };
        }
        log(`[reconcile][${network}] same count, DIFFERENT root — leaves are out of order`);
    }

    const head = await withRetry(() => chain.provider.getBlockNumber(), "getBlockNumber");
    const floor = Number(process.env[DEPLOY_BLOCK_ENV[network]] || 0);
    if (!floor) throw new Error(`${DEPLOY_BLOCK_ENV[network]} is not set — refusing to scan from genesis`);

    // Scan backward. `scanned` holds notes in CHAIN order (earliest first).
    let scanned = [];
    const notesByCmx = {};
    let accepted = null;

    for (let to = head; to >= floor; to -= WINDOW) {
        const from = Math.max(floor, to - WINDOW + 1);
        const logs = await withRetry(
            () => chain.pool.queryFilter(chain.pool.filters.NoteCreated(), from, to),
            `getLogs ${from}-${to}`
        );
        const found = logs
            .filter((l) => l.args.poolId.toString() === String(poolId))
            .sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index)
            .map((l) => {
                notesByCmx[l.args.commitment] = l.args.encryptedNote;
                return l.args.commitment;
            });
        if (found.length) scanned = [...found, ...scanned];

        // Can the DB's leading leaves + what we've scanned explain the chain?
        const k = chain.leaves - scanned.length;
        if (k < 0) throw new Error(`scanned more notes (${scanned.length}) than the pool holds (${chain.leaves})`);
        if (k <= dbLeaves.length) {
            const candidate = [...dbLeaves.slice(0, k), ...scanned];
            const { tree } = await buildTree(candidate);
            if (tree.root.toString() === chain.root) {
                accepted = { candidate, k };
                log(`[reconcile][${network}] matched on-chain root: first ${k} DB leaves + ${scanned.length} from chain (scanned back to block ${from})`);
                break;
            }
        }
        if (from === floor) break;
    }

    if (!accepted) {
        throw new Error(
            `[${network}] could not reproduce the on-chain root ${chain.root} ` +
            `from the DB and chain history — refusing to write`
        );
    }

    const { candidate, k } = accepted;
    const { roots, leafToIndex } = await buildTree(candidate);

    // encrypted notes: keep what the DB had for the leading leaves, take the rest from chain
    const encryptedNotes = {};
    const dbNotes = db?.encryptedNotes
        ? (db.encryptedNotes instanceof Map ? Object.fromEntries(db.encryptedNotes) : db.encryptedNotes)
        : {};
    for (let i = 0; i < candidate.length; i++) {
        const c = candidate[i];
        encryptedNotes[c] = i < k ? dbNotes[c] : notesByCmx[c];
        if (!encryptedNotes[c]) throw new Error(`no encrypted note for leaf ${i} (${c})`);
    }

    const added = candidate.filter((c) => !dbLeaves.includes(c));
    const moved = candidate.filter((c, i) => dbLeaves.includes(c) && dbLeaves[i] !== c);
    log(`[reconcile][${network}] ${added.length} leaf(s) were missing, ${moved.length} were out of position`);
    for (const c of added) log(`   + ${c}`);

    if (dryRun) {
        log(`[reconcile][${network}] DRY RUN — nothing written`);
        return { network, poolId, changed: true, dryRun: true, added, moved, leaves: candidate.length };
    }

    await PoolState.findOneAndUpdate(
        { network, poolId },
        {
            network, poolId,
            commitments: candidate,
            roots,
            latestRoot: roots[roots.length - 1],
            leafToIndex,
            encryptedNotes,
            lastProcessedBlock: head
        },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
    log(`[reconcile][${network}] DB rewritten: ${candidate.length} leaves, root matches chain`);
    return { network, poolId, changed: true, added, moved, leaves: candidate.length };
}

module.exports = { reconcilePool, onchainPool, buildTree };
