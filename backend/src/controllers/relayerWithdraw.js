/**
 * relayerWithdraw.js
 *
 * Self-withdrawal for the relayer: sweeps all unspent relayer UTXOs on Monad
 * into the relayer's ETH address.  Fee is 0 (no relayer-of-the-relayer needed).
 *
 * Called automatically from transferController when the relayer's on-chain
 * ETH balance is insufficient to cover gas.
 */

"use strict";

const snarkjs     = require("snarkjs");
const { ethers }  = require("ethers");
const circomlibjs = require("circomlibjs");
const path        = require("path");

const { createCommitment }  = require("../helpers/commitments");
const { encryptMessage }    = require("../helpers/crypto");
const privatePool           = require("../contracts/privatePool");   // monad instance (default export)
const providerModule        = require("../config/provider");
const { spentNullifiers, applyReceiptEvents } = require("../indexer/poolIndexer");

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_INPUTS = 4;
const ZERO_BIG   = BigInt(0);
const ZERO_HASH  = ethers.ZeroHash;

const WASM_PATH = path.resolve(__dirname, "../zk/withdraw_proof.wasm");
const ZKEY_PATH = path.resolve(__dirname, "../zk/withdraw_final.zkey");

// ─── Poseidon singleton ───────────────────────────────────────────────────────

let _poseidon = null;
async function getPoseidon() {
    if (!_poseidon) _poseidon = await circomlibjs.buildPoseidon();
    return _poseidon;
}

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function toBytes32(value) {
    return ethers.zeroPadValue(ethers.toBeHex(BigInt(value)), 32);
}

function randomR() {
    return ethers.toBigInt(ethers.randomBytes(31)).toString();
}

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

function planSelfWithdraw(unspent, withdrawAmt) {
    if (!unspent?.length || withdrawAmt <= ZERO_BIG) return null;

    const selected = selectUTXOs(unspent, withdrawAmt);
    if (!selected) return null;

    const batches = [];
    const flat = [...selected];
    while (flat.length > 0) batches.push(flat.splice(0, MAX_INPUTS));

    const plans = [];
    let withdrawRemaining = withdrawAmt;

    for (const batch of batches) {
        const batchTotal  = batch.reduce((s, u) => s + BigInt(u.amount), ZERO_BIG);
        const toWithdraw  = withdrawRemaining <= batchTotal ? withdrawRemaining : batchTotal;
        const changeAmt   = batchTotal - toWithdraw;
        withdrawRemaining -= toWithdraw;
        plans.push({ inputs: batch, withdrawAmt: toWithdraw, changeAmt, feeAmt: ZERO_BIG });
    }

    if (withdrawRemaining > ZERO_BIG) return null;
    return plans;
}

function getMerkleProofFromState(walletState, poolId, leafIndex) {
    const poolData = walletState.pools[poolId];
    if (!poolData?.tree) return null;
    try { return poolData.tree.createProof(leafIndex); }
    catch { return null; }
}

// ─── Build one withdraw call + ZK proof ──────────────────────────────────────

async function buildRelayerWithdrawCall(inputs, withdrawAmt, changeAmt, walletState, relayerKeys, relayerEthAddr) {
    const poseidon = await getPoseidon();

    const padded = [...inputs];
    while (padded.length < MAX_INPUTS) padded.push(null);

    const enabled = [], c_ins = [], a_ins = [], r_ins = [], roots = [],
        pathElements = [], pathIndices = [], nullifiers = [],
        poolIds = [], rootsBytes32 = [], nullifiersBytes32 = [];

    for (const utxo of padded) {
        if (!utxo) {
            enabled.push(0); c_ins.push("0"); a_ins.push("0"); r_ins.push("0");
            roots.push("0"); pathElements.push(Array(20).fill("0"));
            pathIndices.push(Array(20).fill(0)); nullifiers.push("0");
            poolIds.push(0); rootsBytes32.push(ZERO_HASH); nullifiersBytes32.push(ZERO_HASH);
            continue;
        }

        const merkleProof = getMerkleProofFromState(walletState, utxo.poolId, utxo.leafIndex);
        if (!merkleProof) throw new Error(`No Merkle proof for leafIndex ${utxo.leafIndex} in pool ${utxo.poolId}`);

        const rootBig   = merkleProof.root.toString();
        const nullifier = poseidon.F.toString(poseidon([
            2, BigInt(utxo.commitment), BigInt(utxo.randomness), BigInt(relayerKeys.zk.secretKey)
        ]));

        enabled.push(1); c_ins.push(BigInt(utxo.commitment).toString()); a_ins.push(utxo.amount);
        r_ins.push(utxo.randomness); roots.push(rootBig);
        pathElements.push(merkleProof.siblings.map((s) => s[0].toString()));
        pathIndices.push(merkleProof.pathIndices); nullifiers.push(nullifier);
        poolIds.push(typeof utxo.poolId === "number" ? utxo.poolId : parseInt(utxo.poolId) || 0);
        rootsBytes32.push(toBytes32(rootBig)); nullifiersBytes32.push(toBytes32(nullifier));
    }

    const changeEnabled    = changeAmt > ZERO_BIG ? 1 : 0;
    const rChange          = randomR();
    const changeCommitment = changeEnabled
        ? await createCommitment(changeAmt.toString(), rChange, relayerKeys.zk.publicKey)
        : null;

    const encryptedNote1 = encryptMessage(
        JSON.stringify({ amount: changeAmt.toString(), randomness: rChange }),
        relayerKeys.privateWallet.publicKey
    );
    const encryptedNote2 = encryptMessage(
        JSON.stringify({ amount: "0", randomness: randomR() }),
        relayerKeys.privateWallet.publicKey
    );

    const receiverUint = BigInt(relayerEthAddr).toString();

    const circuitInput = {
        pk: relayerKeys.zk.publicKey, sk: relayerKeys.zk.secretKey,
        receiver: receiverUint, changeReceiver: relayerKeys.zk.publicKey,
        relayer: relayerKeys.zk.publicKey,
        enabled, c_ins, a_ins, r_ins, roots, pathElements, pathIndices, nullifiers,
        withdrawAmount: withdrawAmt.toString(),
        out_enabled: [changeEnabled, 0],
        a_outs: [changeAmt.toString(), "0"],
        r_outs: [rChange, randomR()],
        c_outs: [changeEnabled ? changeCommitment.decimal : "0", "0"],
        receivers: [relayerKeys.zk.publicKey, relayerKeys.zk.publicKey]
    };

    console.log("[relayerWithdraw] Generating ZK proof…");
    const { proof: zkProof, publicSignals } =
        await snarkjs.groth16.fullProve(circuitInput, WASM_PATH, ZKEY_PATH);

    console.log("[relayerWithdraw] Public signals:", publicSignals);

    const calldata = await snarkjs.groth16.exportSolidityCallData(zkProof, publicSignals);
    const argv = calldata.replace(/["[\]\s]/g, "").split(",");
    const a = [argv[0], argv[1]];
    const b = [[argv[2], argv[3]], [argv[4], argv[5]]];
    const c = [argv[6], argv[7]];

    return {
        a, b, c, enabled,
        roots:      rootsBytes32,
        poolIds,
        nullifiers: nullifiersBytes32,
        C1: changeEnabled ? changeCommitment.bytes32 : ZERO_HASH,
        C2: ZERO_HASH,
        encryptedNote1,
        encryptedNote2,
        withdrawAmount: withdrawAmt
    };
}

// ─── Main exported function ───────────────────────────────────────────────────

async function selfWithdrawRelayerBalance() {
    console.log("[relayerWithdraw] Starting relayer self-withdrawal…");

    // Monad-only: uses buildWallet with "monad" network
    const walletState    = await providerModule.buildWallet("monad");
    const relayerKeys    = providerModule.relayerWallet;
    const relayerEthAddr = providerModule.wallet.address;

    if (!walletState.notes?.length) {
        throw new Error("[relayerWithdraw] No unspent relayer UTXOs found.");
    }

    const unspent = walletState.notes;
    const totalAvailable = unspent.reduce((s, u) => s + BigInt(u.amount), ZERO_BIG);
    console.log("[relayerWithdraw] Total available:", ethers.formatEther(totalAvailable), "MON");

    if (totalAvailable === ZERO_BIG) throw new Error("[relayerWithdraw] Relayer balance is zero.");

    const plans = planSelfWithdraw(unspent, totalAvailable);
    if (!plans) throw new Error("[relayerWithdraw] Could not plan withdrawal.");

    console.log(`[relayerWithdraw] ${plans.length} batch(es) planned.`);

    const withdrawCalls = [];
    for (let i = 0; i < plans.length; i++) {
        const p = plans[i];
        console.log(
            `[relayerWithdraw] Building proof ${i + 1}/${plans.length} — ` +
            `withdrawing ${ethers.formatEther(p.withdrawAmt)} MON`
        );
        const call = await buildRelayerWithdrawCall(
            p.inputs, p.withdrawAmt, p.changeAmt, walletState, relayerKeys, relayerEthAddr
        );
        withdrawCalls.push(call);
    }

    console.log("[relayerWithdraw] Sending withdraw transaction…");
    const tx      = await privatePool.connect(providerModule.wallet).withdraw(withdrawCalls, relayerEthAddr);
    const receipt = await tx.wait();

    // Index the swept notes inline (relayer self-sweep runs on monad).
    await applyReceiptEvents("monad", receipt);

    console.log("[relayerWithdraw] ✅ Success! tx:", receipt.hash);
    return receipt;
}

module.exports = { selfWithdrawRelayerBalance };