/**
 * register.controller.js
 *
 * On-chain wallet registration, relayed through the backend.
 *
 * The USER signs the register transaction client-side (register(user_commitment)
 * must be sent from the user's own wallet — the on-chain map is keyed by the
 * sender). The wallet extension posts the signed transaction here and the
 * backend broadcasts it, so the extension never needs its own RPC/indexer.
 *
 *   POST /api/register/:network         — submit a user-signed register tx
 *     evm networks body:  { signedTx }                (raw signed tx hex)
 *     solana body:        { serializedTx }            (hex serialized signed tx)
 *     sui body:           { txBytes, signature }      (base64 + base64)
 *     aptos body:         { signedTxn }               (hex BCS SignedTransaction)
 *
 *   GET  /api/register/:network/status/:address — on-chain registration check
 *     → { registered: boolean, userCommitment: string | null }
 */
"use strict";

const { ethers } = require("ethers");
const { PublicKey } = require("@solana/web3.js");

const providerModule = require("../config/provider");
const { getPrivatePoolForNetwork } = require("../contracts/privatePool");
const solanaProvider = require("../config/solanaProvider");
const suiProvider = require("../config/suiProvider");
const aptosProvider = require("../config/aptosProvider");
const NoidRegistration = require("../models/NoidRegistration");

const EVM_NETWORKS = new Set(["monad", "sepolia", "base_sepolia"]);
const ALL_NETWORKS = new Set([...EVM_NETWORKS, "solana", "sui", "aptos"]);

function badNetwork(res, network) {
    return res.status(400).json({
        success: false,
        message: `Unknown network "${network}". Valid values: monad, sepolia, base_sepolia, solana, sui, aptos`
    });
}

/**
 * Persist the wallet's encryption public key + user commitment off-chain so a
 * sender can look them up by the receiver's real address (the encryption key
 * cannot be recovered from the on-chain user commitment hash). Best-effort:
 * a store failure must not fail the registration whose tx already landed.
 */
async function storeRegistration(network, req) {
    const { address, userCommitment, encryptionPublicKey } = req.body;
    if (!address || !userCommitment || !encryptionPublicKey) return;
    try {
        await NoidRegistration.findOneAndUpdate(
            { network, address: String(address).toLowerCase() },
            { network, address: String(address).toLowerCase(), userCommitment, encryptionPublicKey },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    } catch (e) {
        console.error(`[register][${network}] failed to store encryption key:`, e.message);
    }
}

// ─── Submit a user-signed register transaction ────────────────────────────────

async function registerController(req, res) {
    const network = req.params.network;
    if (!ALL_NETWORKS.has(network)) return badNetwork(res, network);

    try {
        if (EVM_NETWORKS.has(network)) {
            const { signedTx } = req.body;
            if (!signedTx) {
                return res.status(400).json({ success: false, message: "Missing signedTx" });
            }
            const provider = providerModule.getProviderForNetwork(network);
            console.log(`[register][${network}] broadcasting signed register tx...`);
            const txResponse = await provider.broadcastTransaction(signedTx);
            const receipt = await txResponse.wait();
            if (!receipt || receipt.status !== 1) {
                return res.status(400).json({
                    success: false,
                    message: "Register transaction reverted on-chain (already registered?)",
                    txHash: txResponse.hash
                });
            }
            await storeRegistration(network, req);
            return res.json({ success: true, network, txHash: receipt.hash });
        }

        if (network === "solana") {
            const { serializedTx } = req.body;
            if (!serializedTx) {
                return res.status(400).json({ success: false, message: "Missing serializedTx" });
            }
            const { Transaction } = require("@solana/web3.js");
            const tx = Transaction.from(Buffer.from(serializedTx, "hex"));

            // co-sign as fee payer when the relayer sponsors the registration
            const relayerIsFeePayer =
                tx.feePayer && tx.feePayer.equals(solanaProvider.relayerKeypair.publicKey);
            if (relayerIsFeePayer) {
                try { tx.partialSign(solanaProvider.relayerKeypair); } catch (_) { /* already signed */ }
            }

            console.log("[register][solana] submitting register tx...");
            const signature = await solanaProvider.connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: false,
                preflightCommitment: "confirmed"
            });
            await solanaProvider.connection.confirmTransaction(signature, "confirmed");
            await storeRegistration(network, req);
            return res.json({ success: true, network, txHash: signature });
        }

        if (network === "sui") {
            const { txBytes, signature } = req.body;
            if (!txBytes || !signature) {
                return res.status(400).json({ success: false, message: "Missing txBytes / signature" });
            }
            console.log("[register][sui] submitting register tx...");
            const result = await suiProvider.suiClient.executeTransactionBlock({
                transactionBlock: txBytes,
                signature: Array.isArray(signature) ? signature : [signature],
                options: { showEffects: true }
            });
            if (result.effects?.status.status !== "success") {
                return res.status(400).json({
                    success: false,
                    message: `Register failed: ${JSON.stringify(result.effects?.status)}`,
                    txHash: result.digest
                });
            }
            await suiProvider.suiClient.waitForTransaction({ digest: result.digest });
            await storeRegistration(network, req);
            return res.json({ success: true, network, txHash: result.digest });
        }

        if (network === "aptos") {
            const { signedTxn } = req.body;
            if (!signedTxn) {
                return res.status(400).json({ success: false, message: "Missing signedTxn" });
            }
            console.log("[register][aptos] submitting register tx...");
            const nodeUrl = process.env.APTOS_NODE_URL || "https://fullnode.testnet.aptoslabs.com/v1";
            const bcsBytes = Buffer.from(
                signedTxn.startsWith("0x") ? signedTxn.slice(2) : signedTxn,
                "hex"
            );
            const submitRes = await fetch(`${nodeUrl}/transactions`, {
                method: "POST",
                headers: { "Content-Type": "application/x.aptos.signed_transaction+bcs" },
                body: bcsBytes
            });
            const submitJson = await submitRes.json();
            if (!submitRes.ok) {
                return res.status(400).json({
                    success: false,
                    message: `Register failed: ${submitJson.message || JSON.stringify(submitJson)}`
                });
            }
            const receipt = await aptosProvider.aptos.waitForTransaction({
                transactionHash: submitJson.hash
            });
            if (!receipt.success) {
                return res.status(400).json({
                    success: false,
                    message: "Register transaction failed on-chain (already registered?)",
                    txHash: submitJson.hash
                });
            }
            await storeRegistration(network, req);
            return res.json({ success: true, network, txHash: submitJson.hash });
        }
    } catch (err) {
        console.error(`[register][${network}] error:`, err);
        return res.status(500).json({
            success: false,
            message: err.shortMessage || err.reason || err.message
        });
    }
}

// ─── On-chain registration status ─────────────────────────────────────────────

async function registrationStatus(network, address) {
    if (EVM_NETWORKS.has(network)) {
        const pool = getPrivatePoolForNetwork(network);
        const uc = await pool.registered(address);
        const registered = uc !== ethers.ZeroHash;
        return { registered, userCommitment: registered ? BigInt(uc).toString() : null };
    }

    if (network === "solana") {
        const [registrationPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("registration"), new PublicKey(address).toBuffer()],
            solanaProvider.programId
        );
        try {
            const registration =
                await solanaProvider.program.account.registration.fetch(registrationPda);
            const uc = BigInt(
                "0x" + Buffer.from(registration.userCommitment).toString("hex")
            ).toString();
            return { registered: true, userCommitment: uc };
        } catch (_) {
            return { registered: false, userCommitment: null };
        }
    }

    if (network === "sui") {
        // registered is a Table<address, u256> on PoolState → dynamic-field lookup
        const obj = await suiProvider.suiClient.getObject({
            id: suiProvider.poolStateId,
            options: { showContent: true }
        });
        const tableId = obj.data?.content?.fields?.registered?.fields?.id?.id;
        if (!tableId) throw new Error("registered table not found in PoolState");
        try {
            const entry = await suiProvider.suiClient.getDynamicFieldObject({
                parentId: tableId,
                name: { type: "address", value: address }
            });
            const value = entry.data?.content?.fields?.value;
            if (value === undefined || value === null) {
                return { registered: false, userCommitment: null };
            }
            return { registered: true, userCommitment: BigInt(value).toString() };
        } catch (_) {
            return { registered: false, userCommitment: null };
        }
    }

    if (network === "aptos") {
        const [isRegistered] = await aptosProvider.aptos.view({
            payload: {
                function: `${aptosProvider.moduleAddr}::pool::is_registered`,
                typeArguments: [],
                functionArguments: [aptosProvider.poolAddr, address]
            }
        });
        if (!isRegistered) return { registered: false, userCommitment: null };
        const [uc] = await aptosProvider.aptos.view({
            payload: {
                function: `${aptosProvider.moduleAddr}::pool::registered_commitment`,
                typeArguments: [],
                functionArguments: [aptosProvider.poolAddr, address]
            }
        });
        return { registered: true, userCommitment: BigInt(uc).toString() };
    }

    throw new Error(`Unknown network ${network}`);
}

async function registerStatusController(req, res) {
    const { network, address } = req.params;
    if (!ALL_NETWORKS.has(network)) return badNetwork(res, network);
    if (!address) {
        return res.status(400).json({ success: false, message: "Missing address" });
    }
    try {
        const status = await registrationStatus(network, address);
        // enrich with the stored encryption public key (needed to encrypt notes)
        let encryptionPublicKey = null;
        try {
            const rec = await NoidRegistration.findOne({
                network,
                address: String(address).toLowerCase()
            });
            if (rec) encryptionPublicKey = rec.encryptionPublicKey;
        } catch (_) { /* ignore */ }
        return res.json({ success: true, network, address, ...status, encryptionPublicKey });
    } catch (err) {
        console.error(`[register][status][${network}] error:`, err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = { registerController, registerStatusController, registrationStatus };
