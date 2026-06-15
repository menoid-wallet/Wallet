/**
 * solanaProvider.js
 *
 * Configures the Solana Connection, Anchor Provider, Program, and Relayer Keypair.
 */
"use strict";

const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { Program, AnchorProvider, Wallet } = require("@coral-xyz/anchor");
const bs58 = require("bs58").default || require("bs58");
const path = require("path");
const fs = require("fs");

require("dotenv").config();

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID_STR = process.env.SOLANA_PROGRAM_ID || "3wxDTqw42qqftiAcTZ6kLeNtepuSmB1mR1skrEcwD9SC";
const POOL_STATE_PDA_STR = process.env.SOLANA_POOL_STATE_PDA || "AsND4jSJBC9t7kwRqD4R6gkwnF4kibVuyGvSNTD1S7QG";

const connection = new Connection(RPC_URL, "confirmed");

// Initialize Relayer Keypair
let relayerKeypair = null;
if (process.env.SOLANA_DEPLOYER_PRIVATE_KEY) {
    try {
        const decoded = bs58.decode(process.env.SOLANA_DEPLOYER_PRIVATE_KEY.trim());
        relayerKeypair = Keypair.fromSecretKey(decoded);
    } catch (err) {
        console.error("Failed to decode SOLANA_DEPLOYER_PRIVATE_KEY from base58, trying as raw byte array...");
    }
}
if (!relayerKeypair && process.env.DEPLOYER_PRIVATE_KEY) {
    try {
        const decoded = bs58.decode(process.env.DEPLOYER_PRIVATE_KEY.trim());
        relayerKeypair = Keypair.fromSecretKey(decoded);
    } catch (err) {
        // Try as byte array
        try {
            const arr = JSON.parse(process.env.DEPLOYER_PRIVATE_KEY);
            relayerKeypair = Keypair.fromSecretKey(Uint8Array.from(arr));
        } catch (_) {
            console.error("Failed to decode DEPLOYER_PRIVATE_KEY for Solana.");
        }
    }
}

// Fallback to random keypair if not provided (so startup does not crash, though execution will fail)
if (!relayerKeypair) {
    console.warn("⚠️ Solana relayer keypair not configured! Using a temporary random keypair.");
    relayerKeypair = Keypair.generate();
}

const wallet = new Wallet(relayerKeypair);
const provider = new AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
    commitment: "confirmed"
});

// Load IDL
const idlPath = path.resolve(__dirname, "../abis/solana/noid_solana.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
const program = new Program(idl, provider);

module.exports = {
    connection,
    relayerKeypair,
    program,
    programId: new PublicKey(PROGRAM_ID_STR),
    poolStatePda: new PublicKey(POOL_STATE_PDA_STR),
    wallet
};
