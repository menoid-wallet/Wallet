"use strict";

const snarkjs    = require("snarkjs");
const { ethers } = require("ethers");

const { decryptMessage } = require("../helpers/crypto");
const providerModule     = require("../config/provider");
const { spentNullifiers, applyReceiptEvents } = require("../indexer/poolIndexer");

const executeFunCallVKey          = require("../zk/execute_call_verification_key.json");
const noidAccountOwnershipVKey    = require("../zk/noid_account_ownership_verification_key.json");
const NOID_ACCOUNT_MANAGER_ABI    = require("../abis/NoidAccountManager.json");

const ZERO_COMMITMENT = ethers.ZeroHash;
const VALID_NETWORKS  = new Set(["monad", "sepolia", "base_sepolia"]);

// ─── NoidAccountManager factory ───────────────────────────────────────────────

function getNoidAccountManager(network) {
    const address = providerModule.getNoidAccountManagerAddressForNetwork(network);
    if (!address) {
        throw new Error(`NOID_ACCOUNT_MANAGER address not set for network "${network}"`);
    }
    return new ethers.Contract(
        address,
        NOID_ACCOUNT_MANAGER_ABI,
        providerModule.getProviderForNetwork(network)
    );
}

// ─── Build public signals for ExecuteFunctionCall proof ───────────────────────

function buildExecuteCallPublicSignals(call) {
    const publicSignals = [];

    publicSignals.push(providerModule.relayerWallet.zk.publicKey.toString());

    for (const e of call.inputs.enabled)   publicSignals.push(e.toString());
    for (const root of call.inputs.roots)  publicSignals.push(BigInt(root).toString());
    for (const n of call.inputs.nullifiers) publicSignals.push(BigInt(n).toString());

    publicSignals.push(call.C1 !== ZERO_COMMITMENT ? "1" : "0");
    publicSignals.push(call.C2 !== ZERO_COMMITMENT ? "1" : "0");

    publicSignals.push(BigInt(call.C1).toString());
    publicSignals.push(BigInt(call.C2).toString());

    publicSignals.push(BigInt(call.callValue).toString());

    return publicSignals;
}

// ─── Build public signals for NoidAccountOwnership proof ─────────────────────

function buildOwnershipPublicSignals({ commitment, callCommitment, nonce, target, value, dataHash }) {
    return [
        BigInt(commitment).toString(),
        BigInt(callCommitment).toString(),
        BigInt(nonce).toString(),
        BigInt(target).toString(),
        BigInt(value).toString(),
        BigInt(dataHash).toString()
    ];
}

// ─── Convert raw snarkjs proof → Solidity calldata tuples ────────────────────

async function proofToSolidityCalldata(rawProof, publicSignals) {
    const calldata = await snarkjs.groth16.exportSolidityCallData(rawProof, publicSignals);
    const argv = calldata.replace(/["[\]\s]/g, "").split(",");
    const a = [argv[0], argv[1]];
    const b = [[argv[2], argv[3]], [argv[4], argv[5]]];
    const c = [argv[6], argv[7]];
    return { a, b, c };
}

// ─── Controller ───────────────────────────────────────────────────────────────

async function executeFunctionController(req, res) {
    try {
        // ── Network ──
        const network = req.params.network;
        if (!VALID_NETWORKS.has(network)) {
            return res.status(400).json({
                success: false,
                message: `Unknown network "${network}". Valid values: monad, sepolia, base_sepolia`
            });
        }

        const signingWallet     = providerModule.getWalletForNetwork(network);
        const networkNullifiers = spentNullifiers[network];

        const {
            calls,
            target,
            value,
            data,
            commitment,
            callCommitment,
            ownershipProof,
            nonce,
            noidAccount,
            zkProofs,
            dataHash
        } = req.body;

        // ── Basic validation ──
        if (!Array.isArray(calls) || calls.length === 0)
            return res.status(400).json({ success: false, message: "calls must be a non-empty array" });
        if (!Array.isArray(zkProofs) || zkProofs.length !== calls.length)
            return res.status(400).json({ success: false, message: "zkProofs must be an array with one entry per call" });
        if (!commitment || commitment === ZERO_COMMITMENT)
            return res.status(400).json({ success: false, message: "commitment is required" });
        if (!callCommitment || callCommitment === ZERO_COMMITMENT)
            return res.status(400).json({ success: false, message: "callCommitment is required" });
        if (!ownershipProof || !ownershipProof.pi_a || !ownershipProof.pi_b || !ownershipProof.pi_c)
            return res.status(400).json({ success: false, message: "ownershipProof (pi_a, pi_b, pi_c) is required" });
        if (!noidAccount)
            return res.status(400).json({ success: false, message: "noidAccount address is required" });
        if (!target)
            return res.status(400).json({ success: false, message: "target address is required" });
        if (value === undefined || value === null)
            return res.status(400).json({ success: false, message: "value is required" });
        if (!data)
            return res.status(400).json({ success: false, message: "data is required" });
        if (!dataHash)
            return res.status(400).json({ success: false, message: "dataHash is required" });

        // ── Verify execute-call ZK proofs ──
        for (let i = 0; i < calls.length; i++) {
            const proof   = zkProofs[i];
            const signals = buildExecuteCallPublicSignals(calls[i]);

            console.log(`[executeFunction][${network}] call ${i} public signals:`, signals);

            const verified = await snarkjs.groth16.verify(executeFunCallVKey, signals, proof);
            console.log(`[executeFunction][${network}] call ${i} verified:`, verified);

            if (!verified) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid execute-call ZK proof for call index ${i}`
                });
            }
        }

        // ── Verify NoidAccount ownership proof ──
        const ownershipSignals = buildOwnershipPublicSignals({
            commitment,
            callCommitment,
            nonce,
            target:   BigInt(target).toString(),
            value:    BigInt(value).toString(),
            dataHash: BigInt(dataHash).toString()
        });

        console.log(`[executeFunction][${network}] ownership public signals:`, ownershipSignals);

        const ownershipVerified = await snarkjs.groth16.verify(
            noidAccountOwnershipVKey,
            ownershipSignals,
            ownershipProof
        );
        console.log(`[executeFunction][${network}] ownership verified:`, ownershipVerified);

        if (!ownershipVerified) {
            return res.status(400).json({ success: false, message: "Invalid NoidAccount ownership proof" });
        }

        // ── Nullifier check ──
        for (const call of calls) {
            for (const nullifier of call.inputs.nullifiers) {
                if (nullifier === ZERO_COMMITMENT) continue;
                const parsed = BigInt(nullifier).toString();
                if (networkNullifiers.has(parsed)) {
                    return res.status(400).json({ success: false, message: "Nullifier already spent" });
                }
            }
        }

        // ── Decrypt relayer notes ──
        let totalRelayerFee = 0n;
        for (const call of calls) {
            if (call.C2 === ZERO_COMMITMENT) continue;
            try {
                const decrypted = decryptMessage(
                    call.encryptedNote2,
                    providerModule.relayerWallet.privateWallet.privateKey
                );
                const parsed = JSON.parse(decrypted);
                totalRelayerFee += BigInt(parsed.amount);
            } catch (_) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid or undecryptable relayer encrypted note (encryptedNote2)"
                });
            }
        }
        console.log(`[executeFunction][${network}] total relayer fee:`, totalRelayerFee.toString());

        // ── Convert ownership proof → Solidity calldata ──
        const { a: ownA, b: ownB, c: ownC } = await proofToSolidityCalldata(
            ownershipProof,
            ownershipSignals
        );

        // ── Estimate gas ──
        const noidAccountManager = getNoidAccountManager(network);
        const gasEstimate = await noidAccountManager
            .connect(signingWallet)
            .executeFunction
            .estimateGas(
                calls, target, BigInt(value), data,
                commitment, callCommitment, ownA, ownB, ownC, noidAccount
            );

        const feeData  = await providerModule.getProviderForNetwork(network).getFeeData();
        const gasPrice = feeData.gasPrice;
        if (!gasPrice) {
            return res.status(500).json({ success: false, message: "Unable to fetch gas price" });
        }

        const estimatedCost = gasEstimate * gasPrice;
        console.log(
            `[executeFunction][${network}] gas estimate: ${gasEstimate} | cost: ${estimatedCost}`
        );

        // ── Profitability check ──
        if (totalRelayerFee < estimatedCost) {
            return res.status(400).json({
                success:         false,
                message:         "Relayer fee insufficient to cover gas",
                estimatedCost:   estimatedCost.toString(),
                totalRelayerFee: totalRelayerFee.toString()
            });
        }

        // ── Submit tx ──
        const tx = await noidAccountManager
            .connect(signingWallet)
            .executeFunction(
                calls, target, BigInt(value), data,
                commitment, callCommitment, ownA, ownB, ownC, noidAccount
            );

        console.log(`[executeFunction][${network}] tx submitted:`, tx.hash);
        const receipt = await tx.wait();
        console.log(`[executeFunction][${network}] confirmed in block:`, receipt.blockNumber);

        // Update pools + nullifiers inline from the receipt (no sync loop).
        await applyReceiptEvents(network, receipt);

        return res.json({
            success:         true,
            network,
            txHash:          receipt.hash,
            gasUsed:         receipt.gasUsed.toString(),
            totalRelayerFee: totalRelayerFee.toString(),
            estimatedCost:   estimatedCost.toString()
        });

    } catch (err) {
        console.error("[executeFunction] error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = { executeFunctionController };