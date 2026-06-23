"use strict";

const snarkjs    = require("snarkjs");
const { ethers } = require("ethers");

const { getPrivatePoolForNetwork } = require("../contracts/privatePool");
const { decryptMessage }           = require("../helpers/crypto");
const providerModule               = require("../config/provider");
const { spentNullifiers, applyReceiptEvents } = require("../indexer/poolIndexer");

const transferVKey = require("../zk/transfer_verification_key.json");

const ZERO_COMMITMENT  = ethers.ZeroHash;
const VALID_NETWORKS   = new Set(["monad", "sepolia", "base_sepolia"]);

// ─── Build public signals ─────────────────────────────────────────────────────

function buildPublicSignals(call) {
    const publicSignals = [];

    publicSignals.push(providerModule.relayerWallet.zk.publicKey.toString());

    for (const e of call.inputs.enabled) {
        publicSignals.push(e.toString());
    }

    for (const root of call.inputs.roots) {
        publicSignals.push(BigInt(root).toString());
    }

    for (const n of call.inputs.nullifiers) {
        publicSignals.push(BigInt(n).toString());
    }

    publicSignals.push(call.C1 !== ZERO_COMMITMENT ? "1" : "0");
    publicSignals.push(call.C2 !== ZERO_COMMITMENT ? "1" : "0");
    publicSignals.push(call.C3 !== ZERO_COMMITMENT ? "1" : "0");

    publicSignals.push(BigInt(call.C1).toString());
    publicSignals.push(BigInt(call.C2).toString());
    publicSignals.push(BigInt(call.C3).toString());

    return publicSignals;
}

// ─── Controller ───────────────────────────────────────────────────────────────

async function transferController(req, res) {
    try {
        // ── Network ──
        const network = req.params.network;
        if (!VALID_NETWORKS.has(network)) {
            return res.status(400).json({
                success: false,
                message: `Unknown network "${network}". Valid values: monad, sepolia, base_sepolia`
            });
        }

        const privatePool = getPrivatePoolForNetwork(network);
        const signingWallet = providerModule.getWalletForNetwork(network);
        const networkNullifiers = spentNullifiers[network];

        const { transferCalls, zkProofs } = req.body;

        // ── Validation ──
        if (!Array.isArray(transferCalls)) {
            return res.status(400).json({ success: false, message: "transferCalls must be array" });
        }
        if (transferCalls.length === 0) {
            return res.status(400).json({ success: false, message: "No transfer calls" });
        }

        // ── Verify proofs ──
        for (let i = 0; i < transferCalls.length; i++) {
            const call    = transferCalls[i];
            const proof   = zkProofs[i];
            const signals = buildPublicSignals(call);

            console.log(`[transfer][${network}] built public signals:`, signals);

            const verified = await snarkjs.groth16.verify(transferVKey, signals, proof);
            console.log(`[transfer][${network}] call ${i} verified:`, verified);

            if (!verified) {
                return res.status(400).json({ success: false, message: "Invalid proof" });
            }
        }

        // ── Nullifier check (the Set holds hex bytes32; check both forms) ──
        for (const call of transferCalls) {
            for (const nullifier of call.inputs.nullifiers) {
                if (nullifier === ZERO_COMMITMENT) continue;
                if (networkNullifiers.has(nullifier) || networkNullifiers.has(BigInt(nullifier).toString())) {
                    return res.status(400).json({ success: false, message: "Nullifier already spent" });
                }
            }
        }

        // ── Decrypt relayer notes ──
        let totalRelayerFee = 0n;
        for (const call of transferCalls) {
            try {
                const decrypted = decryptMessage(
                    call.encryptedNote3,
                    providerModule.relayerWallet.privateWallet.privateKey
                );
                const parsed = JSON.parse(decrypted);
                totalRelayerFee += BigInt(parsed.amount);
            } catch (_) {
                return res.status(400).json({ success: false, message: "Invalid relayer encrypted note" });
            }
        }

        // ── Estimate gas ──
        const gasEstimate = await privatePool.connect(signingWallet).transfer.estimateGas(transferCalls);
        const feeData     = await providerModule.getProviderForNetwork(network).getFeeData();
        const gasPrice    = feeData.gasPrice;

        if (!gasPrice) {
            return res.status(500).json({ success: false, message: "Unable to fetch gas price" });
        }

        const estimatedCost = gasEstimate * gasPrice;
        console.log(`[transfer][${network}] estimated cost:`, estimatedCost.toString());

        // ── Profitability check ──
        if (totalRelayerFee < estimatedCost) {
            return res.status(400).json({
                success:        false,
                message:        "Relayer fee insufficient",
                estimatedCost:  estimatedCost.toString(),
                totalRelayerFee: totalRelayerFee.toString()
            });
        }

        // ── Send tx ──
        const tx      = await privatePool.connect(signingWallet).transfer(transferCalls);
        const receipt = await tx.wait();

        // ── Update pools locally + globally from the receipt's events ──
        const { latestRoots } = await applyReceiptEvents(network, receipt);

        return res.json({
            success:         true,
            network,
            txHash:          receipt.hash,
            gasUsed:         receipt.gasUsed.toString(),
            totalRelayerFee: totalRelayerFee.toString(),
            estimatedCost:   estimatedCost.toString(),
            latestRoots
        });

    } catch (err) {
        console.error("[transfer] error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = { transferController };