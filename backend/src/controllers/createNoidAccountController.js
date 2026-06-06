"use strict";

const snarkjs    = require("snarkjs");
const { ethers } = require("ethers");

const { decryptMessage } = require("../helpers/crypto");
const providerModule     = require("../config/provider");
const { spentNullifiers } = require("../indexer/poolIndexer");

const createNoidAccountVKey = require("../zk/create_noid_account_verification_key.json");
const NOID_ACCOUNT_MANAGER_ABI = require("../abis/NoidAccountManager.json");

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

// ─── Build public signals ─────────────────────────────────────────────────────

function buildPublicSignals(call, cmx) {
    const publicSignals = [];

    publicSignals.push(providerModule.relayerWallet.zk.publicKey.toString());

    for (const e of call.inputs.enabled) publicSignals.push(e.toString());
    for (const root of call.inputs.roots) publicSignals.push(BigInt(root).toString());
    for (const n of call.inputs.nullifiers) publicSignals.push(BigInt(n).toString());

    publicSignals.push(call.C1 !== ZERO_COMMITMENT ? "1" : "0");
    publicSignals.push(call.C2 !== ZERO_COMMITMENT ? "1" : "0");

    publicSignals.push(BigInt(call.C1).toString());
    publicSignals.push(BigInt(call.C2).toString());

    publicSignals.push(BigInt(cmx).toString());

    return publicSignals;
}

// ─── Controller ───────────────────────────────────────────────────────────────

async function createNoidAccountController(req, res) {
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

        const { calls, cmx, eNote, zkProofs } = req.body;

        // ── Basic validation ──
        if (!Array.isArray(calls) || calls.length === 0) {
            return res.status(400).json({ success: false, message: "calls must be a non-empty array" });
        }
        if (!Array.isArray(zkProofs) || zkProofs.length !== calls.length) {
            return res.status(400).json({ success: false, message: "zkProofs must be an array with one entry per call" });
        }
        if (!cmx || cmx === ZERO_COMMITMENT) {
            return res.status(400).json({ success: false, message: "cmx (account commitment) is required" });
        }
        if (!eNote) {
            return res.status(400).json({ success: false, message: "eNote (encrypted account note) is required" });
        }

        // ── Verify ZK proofs ──
        for (let i = 0; i < calls.length; i++) {
            const proof   = zkProofs[i];
            const signals = buildPublicSignals(calls[i], cmx);

            const verified = await snarkjs.groth16.verify(createNoidAccountVKey, signals, proof);
            if (!verified) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid ZK proof for call index ${i}`
                });
            }
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

        // ── Estimate gas ──
        const noidAccountManager = getNoidAccountManager(network);
        const gasEstimate = await noidAccountManager
            .connect(signingWallet)
            .createNoidAccount
            .estimateGas(calls, cmx, eNote);

        const feeData  = await providerModule.getProviderForNetwork(network).getFeeData();
        const gasPrice = feeData.gasPrice;
        if (!gasPrice) {
            return res.status(500).json({ success: false, message: "Unable to fetch gas price" });
        }

        const estimatedCost = gasEstimate * gasPrice;

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
            .createNoidAccount(calls, cmx, eNote);

        console.log(`[createNoidAccount][${network}] tx submitted:`, tx.hash);

        const receipt = await tx.wait();

        return res.json({
            success:         true,
            network,
            txHash:          receipt.hash,
            gasUsed:         receipt.gasUsed.toString(),
            totalRelayerFee: totalRelayerFee.toString(),
            estimatedCost:   estimatedCost.toString()
        });

    } catch (err) {
        console.error("[createNoidAccount] error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = { createNoidAccountController };