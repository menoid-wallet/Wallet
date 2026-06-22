/**
 * aptosNewRoot.js
 *
 * Aptos has no native Poseidon, so the pool contract cannot recompute the Merkle
 * root itself. Instead, for every inserted commitment the relayer attaches a
 * `new_root` Groth16 proof; the contract rebuilds that proof's public signals
 *   [ newRoot, newSubtreesHash, oldSubtreesHash, commitment, leafIndex ]
 * from its OWN live state (current subtrees-hash + next_idx), so the proof is
 * bound to the exact insertion and cannot be forged or replayed.
 *
 * The relayer therefore keeps an OFF-CHAIN mirror of the 20 filled-subtree values
 * (the contract only stores their Poseidon-fold hash). This module owns the
 * subtree math + proof generation, ported from aptos/scripts/noid_local.test.ts.
 */
"use strict";

const path = require("path");
const circomlibjs = require("circomlibjs");
const snarkjs = require("snarkjs");

const DEPTH = 20;
const WASM_PATH = path.resolve(__dirname, "../zk/aptos/new_root/new_root.wasm");
const ZKEY_PATH = path.resolve(__dirname, "../zk/aptos/new_root/new_root_final.zkey");

let _poseidon = null;
let _zeros = null;

async function getPoseidon() {
    if (!_poseidon) _poseidon = await circomlibjs.buildPoseidon();
    return _poseidon;
}

function H(p, a, b) {
    return BigInt(p.F.toString(p([a, b])));
}

/** Zero-subtree hashes Z0..Z19 (Z0 = 0, Zi = Poseidon(Z(i-1), Z(i-1))). */
async function getZeros() {
    if (_zeros) return _zeros;
    const p = await getPoseidon();
    let z = 0n;
    const zeros = [];
    for (let i = 0; i < DEPTH; i++) {
        zeros.push(z);
        z = H(p, z, z);
    }
    _zeros = zeros;
    return zeros;
}

/** Poseidon-fold of the subtrees — must match SubtreesHash in new_root.circom. */
function foldSubtrees(arr, p) {
    let acc = arr[0];
    for (let i = 1; i < DEPTH; i++) acc = H(p, acc, arr[i]);
    return acc;
}

/** Off-chain filled-subtree insert — advances the subtree mirror by one leaf. */
function insertSubtrees(sub, leaf, idx, p, zeros) {
    const ns = sub.slice();
    let cur = leaf;
    for (let i = 0; i < DEPTH; i++) {
        if (((idx >> i) & 1) === 0) {
            ns[i] = cur;
            cur = H(p, cur, zeros[i]);
        } else {
            cur = H(p, sub[i], cur);
        }
    }
    return ns;
}

function writeLE(buf, value, offset, len) {
    let v = value;
    for (let i = offset; i < offset + len; i++) {
        buf[i] = Number(v & 0xffn);
        v >>= 8n;
    }
}

/** snarkjs proof → Aptos bn254_algebra LITTLE-ENDIAN byte arrays. */
function proofToBytes(proof) {
    const g1 = (pt) => {
        const b = new Uint8Array(64);
        writeLE(b, BigInt(pt[0]), 0, 32);
        writeLE(b, BigInt(pt[1]), 32, 32);
        return Array.from(b);
    };
    const g2 = (pt) => {
        const b = new Uint8Array(128);
        writeLE(b, BigInt(pt[0][0]), 0, 32);
        writeLE(b, BigInt(pt[0][1]), 32, 32);
        writeLE(b, BigInt(pt[1][0]), 64, 32);
        writeLE(b, BigInt(pt[1][1]), 96, 32);
        return Array.from(b);
    };
    return { aBytes: g1(proof.pi_a), bBytes: g2(proof.pi_b), cBytes: g1(proof.pi_c) };
}

/** The initial (empty-tree) subtree mirror — a copy of the zero hashes. */
async function initialSubtrees() {
    return (await getZeros()).slice();
}

/** Rebuild the subtree mirror + next index by replaying commitments in order. */
async function rebuildSubtreesFromCommitments(commitments) {
    const p = await getPoseidon();
    const zeros = await getZeros();
    let sub = zeros.slice();
    let idx = 0;
    for (const c of commitments) {
        sub = insertSubtrees(sub, BigInt(c), idx, p, zeros);
        idx += 1;
    }
    return { subtrees: sub, nextIdx: idx };
}

/** Hash of a subtree mirror — the contract's `oldSubtreesHash` / `current_subtrees_hash`. */
async function subtreesHash(subtrees) {
    const p = await getPoseidon();
    return foldSubtrees(subtrees, p).toString();
}

/**
 * Generate a new_root proof for inserting `commitment` at the given mirror state.
 * Returns the proof bytes, proven outputs, and the advanced mirror.
 */
async function proveNewRoot(subtrees, nextIdx, commitmentDecimal) {
    const p = await getPoseidon();
    const zeros = await getZeros();
    const oldHash = foldSubtrees(subtrees, p);

    const input = {
        oldSubtreesHash: oldHash.toString(),
        commitment: String(commitmentDecimal),
        leafIndex: String(nextIdx),
        oldSubtrees: subtrees.map(String)
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
    const newRoot = publicSignals[0];
    const newSubtreesHash = publicSignals[1];
    const newSubtrees = insertSubtrees(subtrees, BigInt(commitmentDecimal), nextIdx, p, zeros);
    const { aBytes, bBytes, cBytes } = proofToBytes(proof);

    return {
        aBytes, bBytes, cBytes,
        newRoot, newSubtreesHash,
        newSubtrees, newNextIdx: nextIdx + 1
    };
}

/**
 * Build the sequential new_root proofs for a list of commitments (insertion order).
 * Each proof is bound to the running mirror state, so they must be applied on-chain
 * in this exact order. Returns the per-commitment proofs + the final mirror state.
 */
async function buildNewRootProofs(subtrees, nextIdx, commitments) {
    let sub = subtrees.slice();
    let idx = nextIdx;
    const proofs = [];
    for (const c of commitments) {
        const r = await proveNewRoot(sub, idx, c);
        proofs.push({
            commitment: String(c),
            aBytes: r.aBytes, bBytes: r.bBytes, cBytes: r.cBytes,
            newRoot: r.newRoot, newSubtreesHash: r.newSubtreesHash
        });
        sub = r.newSubtrees;
        idx = r.newNextIdx;
    }
    return { proofs, finalSubtrees: sub, finalNextIdx: idx };
}

module.exports = {
    DEPTH,
    getPoseidon,
    getZeros,
    initialSubtrees,
    rebuildSubtreesFromCommitments,
    subtreesHash,
    buildNewRootProofs,
    proveNewRoot
};
