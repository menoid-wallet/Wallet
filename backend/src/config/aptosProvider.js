/**
 * aptosProvider.js
 *
 * Configures the Aptos Client and the Relayer Account.
 */
"use strict";

const { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } = require("@aptos-labs/ts-sdk");

require("dotenv").config();

const NODE_URL = process.env.APTOS_NODE_URL || "https://fullnode.testnet.aptoslabs.com/v1";
// MODULE_ADDR = object/function prefix (e.g. 0xMODULE::pool::deposit).
// POOL_ADDR   = address where the PoolState resource lives (the deployer/admin),
//               passed as the `pool_addr` argument to every entry function.
// For object-code deployments these differ; default POOL_ADDR to MODULE_ADDR
// for backward compatibility with same-address (legacy) deployments.
const MODULE_ADDR = process.env.APTOS_MODULE_ADDR || "0x3d4f846b4023cba619dc1e1523b0a80716887da90cbdcdaa3e50f453a9b915cc";
const POOL_ADDR = process.env.APTOS_POOL_ADDR || MODULE_ADDR;
const POOL_RESOURCE_ADDR = process.env.APTOS_POOL_RESOURCE_ADDR || "0x95d0e7ae768af7e34ed3d0daf84ba4130af5b655abbeb56e74d732802c810a95";

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
    poolAddr: POOL_ADDR,
    poolResourceAddr: POOL_RESOURCE_ADDR
};
