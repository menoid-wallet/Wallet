/**
 * merkle.js
 *
 * Shared Merkle-tree helpers for the relayer controllers.
 *
 * The on-chain programs DO NOT compute Merkle roots themselves — they store
 * whatever roots the relayer passes in (deposit root1/root2, transfer/withdraw
 * output_roots). Therefore the relayer MUST compute output roots from a tree
 * that exactly mirrors the on-chain insertion order, and it must NOT mutate the
 * persistent in-memory tree until the transaction has actually succeeded.
 *
 * `computeOutputRoots` builds a throwaway tree from the current base leaves and
 * the new outputs, so the persistent tree is left untouched if the tx fails.
 */
"use strict";

const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");

const TREE_DEPTH = 20;
const TREE_ARITY = 2;

let _poseidon = null;
async function getHashFn() {
    if (!_poseidon) _poseidon = await circomlibjs.buildPoseidon();
    const p = _poseidon;
    return (inputs) => BigInt(p.F.toString(p(inputs)));
}

/**
 * Build a fresh tree from a list of leaves (BigInt or string).
 */
async function buildTreeFromLeaves(leaves) {
    const hash = await getHashFn();
    const tree = new IncrementalMerkleTree(hash, TREE_DEPTH, BigInt(0), TREE_ARITY);
    for (const leaf of leaves) tree.insert(BigInt(leaf));
    return tree;
}

/**
 * Compute the sequence of output roots WITHOUT mutating the caller's tree.
 *
 * @param {Array<bigint|string>} baseLeaves  current leaves of the persistent tree
 * @param {Array<{enabled:boolean, commitment:string}>} outputs
 * @returns {Promise<string[]>} roots; "0" for disabled outputs
 */
async function computeOutputRoots(baseLeaves, outputs) {
    const tree = await buildTreeFromLeaves(baseLeaves);
    const roots = [];
    for (const o of outputs) {
        if (o.enabled) {
            tree.insert(BigInt(o.commitment));
            roots.push(tree.root.toString());
        } else {
            roots.push("0");
        }
    }
    return roots;
}

module.exports = { getHashFn, buildTreeFromLeaves, computeOutputRoots, TREE_DEPTH, TREE_ARITY };
