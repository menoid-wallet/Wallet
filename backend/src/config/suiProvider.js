/**
 * suiProvider.js
 *
 * Configures the SuiClient and the Relayer Keypair.
 */
"use strict";

const { SuiClient } = require("@mysten/sui/client");
const { Ed25519Keypair } = require("@mysten/sui/keypairs/ed25519");
const { fromBase64 } = require("@mysten/sui/utils");

require("dotenv").config();

const RPC_URL = process.env.SUI_RPC_URL || "https://fullnode.testnet.sui.io:443";
const PACKAGE_ID = process.env.SUI_PACKAGE_ID || "0x8eb346e371efef3b48d51cc76ef00a10875fffc800a966df25b4ddf024ae9d55";
const POOL_STATE_ID = process.env.SUI_POOL_STATE_ID || "0x4b4aecb18020a1bd7f22dfc03f30cb10526fa167d02e40683197c334f9791a33";
const VERIFIER_CONFIG_ID = process.env.SUI_VERIFIER_CONFIG_ID || "0x19a4ed9c23910e00887a2f73efffd29c45e4deed6da98261370601b314030e7a";

const suiClient = new SuiClient({ url: RPC_URL });

// Initialize Sui Relayer Keypair
let relayerKeypair = null;
const secretKey = process.env.SUI_DEPLOYER_SECRET_KEY || process.env.DEPLOYER_SECRET_KEY;

if (secretKey) {
    try {
        if (secretKey.startsWith("suiprivkey")) {
            // Import Bech32 key using decodeSuiPrivateKey if available, or parse custom
            try {
                const { decodeSuiPrivateKey } = require("@mysten/sui/cryptography");
                const { secretKey: rawKey } = decodeSuiPrivateKey(secretKey);
                relayerKeypair = Ed25519Keypair.fromSecretKey(rawKey);
            } catch (bechErr) {
                console.error("Failed importing Bech32 Sui key via cryptography SDK:", bechErr.message);
            }
        } else {
            // Assume Base64
            relayerKeypair = Ed25519Keypair.fromSecretKey(fromBase64(secretKey.trim()));
        }
    } catch (err) {
        console.error("Failed to initialize Sui relayer keypair:", err.message);
    }
}

if (!relayerKeypair) {
    console.warn("⚠️ Sui relayer keypair not configured! Using a temporary random keypair.");
    relayerKeypair = new Ed25519Keypair();
}

const relayerAddress = relayerKeypair.getPublicKey().toSuiAddress();

module.exports = {
    suiClient,
    relayerKeypair,
    relayerAddress,
    packageId: PACKAGE_ID,
    poolStateId: POOL_STATE_ID,
    verifierConfigId: VERIFIER_CONFIG_ID
};
