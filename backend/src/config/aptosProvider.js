/**
 * aptosProvider.js
 *
 * Configures the Aptos Client and the Relayer Account.
 */
"use strict";

const { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } = require("@aptos-labs/ts-sdk");

require("dotenv").config();

const NODE_URL = process.env.APTOS_NODE_URL || "https://fullnode.testnet.aptoslabs.com/v1";
const MODULE_ADDR = process.env.APTOS_MODULE_ADDR || "0xb50ddea69fa72666f7fc54ad9e1814a66e47ea61288131b0991e17a2ef08dabb";
const POOL_RESOURCE_ADDR = process.env.APTOS_POOL_RESOURCE_ADDR || "0x8f041f33125b093d771c93ea8f311a34b679e18ce7682c4724c62cff8728a08c";

const config = new AptosConfig({
    network: NODE_URL.includes("testnet") ? Network.TESTNET : (NODE_URL.includes("devnet") ? Network.DEVNET : Network.LOCAL),
    fullnode: NODE_URL
});
const aptos = new Aptos(config);

// Initialize Aptos Relayer Account
let relayerAccount = null;
const privateKeyStr = process.env.APTOS_DEPLOYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;

if (privateKeyStr) {
    try {
        const pk = new Ed25519PrivateKey(privateKeyStr.trim());
        relayerAccount = Account.fromPrivateKey({ privateKey: pk });
    } catch (err) {
        console.error("Failed to initialize Aptos relayer account:", err.message);
    }
}

if (!relayerAccount) {
    console.warn("⚠️ Aptos relayer account not configured! Using a temporary random account.");
    relayerAccount = Account.generate();
}

module.exports = {
    aptos,
    relayerAccount,
    moduleAddr: MODULE_ADDR,
    poolResourceAddr: POOL_RESOURCE_ADDR
};
