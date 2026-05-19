/**
 * relayerWithdraw.js
 *
 * Self-withdrawal for the relayer: sweeps all unspent relayer UTXOs into the
 * relayer's ETH address.  Fee is 0 (no relayer-of-the-relayer needed).
 *
 * Called automatically from transferController when the relayer's on-chain
 * ETH balance is insufficient to cover gas.
 *
 * Dependencies already present in the project:
 *   snarkjs, circomlibjs, ethers, @zk-kit/incremental-merkle-tree
 *   helpers/commitments  → createCommitment
 *   helpers/crypto       → encryptMessage
 *   contracts/privatePool (ethers Contract instance)
 *   config/provider      → { wallet, relayerWallet, buildWallet, provider }
 */

"use strict";

const snarkjs      = require("snarkjs");
const { ethers }   = require("ethers");
const circomlibjs  = require("circomlibjs");
const path         = require("path");

const { createCommitment } = require("../helpers/commitments");
const { encryptMessage }   = require("../helpers/crypto");
const privatePool          = require("../contracts/privatePool");
const providerModule       = require("../config/provider");
const { spentNullifiers }  = require("../indexer/poolIndexer");

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_INPUTS = 4;
const ZERO_BIG   = BigInt(0);
const ZERO_HASH  = ethers.ZeroHash;

// Paths to ZK artifacts (same ones the frontend uses)
const WASM_PATH = path.resolve(__dirname, "../zk/withdraw_proof.wasm");
const ZKEY_PATH = path.resolve(__dirname, "../zk/withdraw_final.zkey");

// ─── Poseidon singleton ───────────────────────────────────────────────────────

let _poseidon = null;
async function getPoseidon() {
    if (!_poseidon) _poseidon = await circomlibjs.buildPoseidon();
    return _poseidon;
}

// ─── Tiny helpers (mirrors WithdrawModal.jsx) ─────────────────────────────────

function toBytes32(value) {
    return ethers.zeroPadValue(ethers.toBeHex(BigInt(value)), 32);
}

function randomR() {
    return ethers.toBigInt(ethers.randomBytes(31)).toString();
}

/**
 * Select UTXOs greedily (largest-first) until targetBigInt is covered.
 * Returns the selected subset, or null if balance is insufficient.
 */
function selectUTXOs(unspent, targetBigInt) {
    const sorted = [...unspent].sort((a, b) => {
        const diff = BigInt(b.amount) - BigInt(a.amount);
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });
    const selected = [];
    let acc = ZERO_BIG;
    for (const utxo of sorted) {
        if (acc >= targetBigInt) break;
        selected.push(utxo);
        acc += BigInt(utxo.amount);
    }
    return acc >= targetBigInt ? selected : null;
}

/**
 * Split selected UTXOs into batches of MAX_INPUTS and build a plan.
 * Fee is always 0 for the relayer self-withdrawal.
 *
 * Each plan entry: { inputs, withdrawAmt, changeAmt, feeAmt }
 *   sum(inputs) === withdrawAmt + changeAmt   (feeAmt always 0)
 */
function planSelfWithdraw(unspent, withdrawAmt) {
    if (!unspent?.length || withdrawAmt <= ZERO_BIG) return null;

    // No fee — we only need exactly withdrawAmt covered
    const selected = selectUTXOs(unspent, withdrawAmt);
    if (!selected) return null;

    // Chunk into batches of MAX_INPUTS
    const batches = [];
    const flat = [...selected];
    while (flat.length > 0) batches.push(flat.splice(0, MAX_INPUTS));

    const plans = [];
    let withdrawRemaining = withdrawAmt;

    for (const batch of batches) {
        const batchTotal = batch.reduce((s, u) => s + BigInt(u.amount), ZERO_BIG);

        // How much of the remaining withdraw does this batch cover?
        const toWithdraw = withdrawRemaining <= batchTotal
            ? withdrawRemaining
            : batchTotal;

        const changeAmt = batchTotal - toWithdraw;
        withdrawRemaining -= toWithdraw;

        plans.push({
            inputs:      batch,
            withdrawAmt: toWithdraw,
            changeAmt,
            feeAmt:      ZERO_BIG,   // always 0 — relayer has no relayer
        });
    }

    if (withdrawRemaining > ZERO_BIG) return null;
    return plans;
}

// ─── Merkle proof helper (mirrors PoolContext.getMerkleProof) ─────────────────

/**
 * Build an incremental Merkle tree for a pool from its commitment list
 * and return a proof for the given leafIndex.
 *
 * walletState.pools[poolId].tree is already built by buildWallet() in
 * provider.js — reuse it if available, otherwise rebuild.
 */
function getMerkleProofFromState(walletState, poolId, leafIndex) {
    const poolData = walletState.pools[poolId];
    if (!poolData?.tree) return null;
    try {
        return poolData.tree.createProof(leafIndex);
    } catch {
        return null;
    }
}

// ─── Build one withdraw call + ZK proof ──────────────────────────────────────

/**
 * Mirrors buildWithdrawCall() from WithdrawModal.jsx but:
 *   - runs in Node.js (uses file paths for wasm/zkey instead of public URLs)
 *   - feeAmt is always 0
 *   - relayer commitment / encryptedNote2 are skipped (C2 = ZERO_HASH)
 *   - sender === relayer (same keys)
 */
async function buildRelayerWithdrawCall(
    inputs,
    withdrawAmt,
    changeAmt,
    walletState,      // from buildWallet()
    relayerKeys,      // providerModule.relayerWallet
    relayerEthAddr    // providerModule.wallet.address  (ETH destination)
) {
    const poseidon = await getPoseidon();

    // Pad inputs to MAX_INPUTS
    const padded = [...inputs];
    while (padded.length < MAX_INPUTS) padded.push(null);

    const enabled           = [];
    const c_ins             = [];
    const a_ins             = [];
    const r_ins             = [];
    const roots             = [];
    const pathElements      = [];
    const pathIndices       = [];
    const nullifiers        = [];
    const poolIds           = [];
    const rootsBytes32      = [];
    const nullifiersBytes32 = [];

    for (const utxo of padded) {
        if (!utxo) {
            enabled.push(0);
            c_ins.push("0");
            a_ins.push("0");
            r_ins.push("0");
            roots.push("0");
            pathElements.push(Array(20).fill("0"));
            pathIndices.push(Array(20).fill(0));
            nullifiers.push("0");
            poolIds.push(0);
            rootsBytes32.push(ZERO_HASH);
            nullifiersBytes32.push(ZERO_HASH);
            continue;
        }

        const merkleProof = getMerkleProofFromState(walletState, utxo.poolId, utxo.leafIndex);
        if (!merkleProof) {
            throw new Error(
                `No Merkle proof for leafIndex ${utxo.leafIndex} in pool ${utxo.poolId}`
            );
        }

        const rootBig   = merkleProof.root.toString();
        const nullifier = poseidon.F.toString(
            poseidon([
                2,
                BigInt(utxo.commitment),
                BigInt(utxo.randomness),
                BigInt(relayerKeys.zk.secretKey),
            ])
        );

        enabled.push(1);
        c_ins.push(BigInt(utxo.commitment).toString());
        a_ins.push(utxo.amount);
        r_ins.push(utxo.randomness);
        roots.push(rootBig);
        pathElements.push(merkleProof.siblings.map((s) => s[0].toString()));
        pathIndices.push(merkleProof.pathIndices);
        nullifiers.push(nullifier);
        poolIds.push(typeof utxo.poolId === "number" ? utxo.poolId : parseInt(utxo.poolId) || 0);
        rootsBytes32.push(toBytes32(rootBig));
        nullifiersBytes32.push(toBytes32(nullifier));
    }

    // Change output (back to the relayer's ZK key) — skip if zero
    const changeEnabled = changeAmt > ZERO_BIG ? 1 : 0;
    const rChange       = randomR();
    const changeCommitment = changeEnabled
        ? await createCommitment(changeAmt.toString(), rChange, relayerKeys.zk.publicKey)
        : null;

    // Encrypt change note for the relayer itself
    const encryptedNote1 = encryptMessage(
        JSON.stringify({ amount: changeAmt.toString(), randomness: rChange }),
        relayerKeys.privateWallet.publicKey
    );

    // No fee output — C2 is zero, encryptedNote2 is a dummy
    const encryptedNote2 = encryptMessage(
        JSON.stringify({ amount: "0", randomness: randomR() }),
        relayerKeys.privateWallet.publicKey   // encrypt to self (ignored on-chain)
    );

    // receiver = relayer's ETH address as uint (withdraw destination)
    const receiverUint = BigInt(relayerEthAddr).toString();

    const circuitInput = {
        pk:             relayerKeys.zk.publicKey,
        sk:             relayerKeys.zk.secretKey,
        receiver:       receiverUint,
        changeReceiver: relayerKeys.zk.publicKey,
        relayer:        relayerKeys.zk.publicKey,   // relayer = self

        enabled,
        c_ins,
        a_ins,
        r_ins,
        roots,
        pathElements,
        pathIndices,
        nullifiers,

        withdrawAmount: withdrawAmt.toString(),

        out_enabled: [changeEnabled, 0],            // no fee output

        a_outs: [changeAmt.toString(), "0"],
        r_outs: [rChange, randomR()],

        c_outs: [
            changeEnabled ? changeCommitment.decimal : "0",
            "0",
        ],

        receivers: [relayerKeys.zk.publicKey, relayerKeys.zk.publicKey],
    };

    console.log("[relayerWithdraw] Generating ZK proof…");
    const { proof: zkProof, publicSignals } =
        await snarkjs.groth16.fullProve(circuitInput, WASM_PATH, ZKEY_PATH);

    console.log("[relayerWithdraw] Public signals:", publicSignals);

    const calldata = await snarkjs.groth16.exportSolidityCallData(zkProof, publicSignals);
    const argv     = calldata.replace(/["[\]\s]/g, "").split(",");
    const a = [argv[0], argv[1]];
    const b = [[argv[2], argv[3]], [argv[4], argv[5]]];
    const c = [argv[6], argv[7]];

    const withdrawCall = {
        a, b, c,
        enabled,
        roots:      rootsBytes32,
        poolIds,
        nullifiers: nullifiersBytes32,
        C1: changeEnabled ? changeCommitment.bytes32 : ZERO_HASH,
        C2: ZERO_HASH,                              // no fee output
        encryptedNote1,
        encryptedNote2,
        withdrawAmount: withdrawAmt,
    };

    return withdrawCall;
}

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * selfWithdrawRelayerBalance()
 *
 * Sweeps all unspent relayer UTXOs to the relayer's ETH address.
 * Should be called when the relayer's ETH balance is too low for gas.
 *
 * Returns the transaction receipt, or throws on failure.
 */
async function selfWithdrawRelayerBalance() {
    console.log("[relayerWithdraw] Starting relayer self-withdrawal…");

    // 1. Rebuild relayer wallet state (fresh — picks up any new UTXOs)
    const walletState  = await providerModule.buildWallet();
    const relayerKeys  = providerModule.relayerWallet;
    const relayerEthAddr = providerModule.wallet.address;

    if (!walletState.notes?.length) {
        throw new Error("[relayerWithdraw] No unspent relayer UTXOs found.");
    }

    // 2. Filter out any notes whose nullifier is already spent
    //    (buildWallet already does this, but be defensive)
    const unspent = walletState.notes.filter((note) => {
        const poseidonSync = _poseidon; // may be null before first proof — that's fine
        // buildWallet already skips spent notes; trust it here
        return true;
    });

    const totalAvailable = unspent.reduce((s, u) => s + BigInt(u.amount), ZERO_BIG);
    console.log("[relayerWithdraw] Total available:", ethers.formatEther(totalAvailable), "MON");

    if (totalAvailable === ZERO_BIG) {
        throw new Error("[relayerWithdraw] Relayer balance is zero.");
    }

    // 3. Plan: withdraw the full available balance (fee = 0)
    const plans = planSelfWithdraw(unspent, totalAvailable);
    if (!plans) {
        throw new Error("[relayerWithdraw] Could not plan withdrawal (UTXO selection failed).");
    }

    console.log(`[relayerWithdraw] ${plans.length} batch(es) planned.`);

    // 4. Build all withdraw calls + ZK proofs
    const withdrawCalls = [];
    for (let i = 0; i < plans.length; i++) {
        const p = plans[i];
        console.log(
            `[relayerWithdraw] Building proof ${i + 1}/${plans.length} — ` +
            `withdrawing ${ethers.formatEther(p.withdrawAmt)} MON, ` +
            `change ${ethers.formatEther(p.changeAmt)} MON`
        );

        const call = await buildRelayerWithdrawCall(
            p.inputs,
            p.withdrawAmt,
            p.changeAmt,
            walletState,
            relayerKeys,
            relayerEthAddr
        );
        withdrawCalls.push(call);
    }

    // 5. Send the withdraw transaction (relayer pays its own gas here,
    //    which is fine — we only call this when ETH is low, not zero)
    console.log("[relayerWithdraw] Sending withdraw transaction…");
    const tx      = await privatePool.connect(providerModule.wallet).withdraw(withdrawCalls, relayerEthAddr);
    const receipt = await tx.wait();

    console.log("[relayerWithdraw] ✅ Success! tx:", receipt.hash);
    console.log("[relayerWithdraw] Withdrawn:", ethers.formatEther(totalAvailable), "MON → ETH");

    return receipt;
}

module.exports = { selfWithdrawRelayerBalance };