const { ethers }      = require("ethers");
const circomlibjs     = require("circomlibjs");
const crypto          = require("crypto");

const PoolState        = require("../models/PoolState");
const NullifierState   = require("../models/NullifierState");


const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");
const { decryptMessageForNetwork } = require("../helpers/crypto");
const {
    generatePrivateWallet,
    generateSolanaPrivateWallet,
    generateSuiPrivateWallet,
    generateAptosPrivateWallet
} = require("../helpers/privateWallet");

require("dotenv").config();

// ─── Providers ────────────────────────────────────────────────────────────────

const monadProvider     = new ethers.JsonRpcProvider(process.env.RPC_URL);
const sepoliaProvider   = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
const baseSepoliaProvider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC_URL);

// Single signing wallet (same key, each provider)
const wallet            = new ethers.Wallet(process.env.PRIVATE_KEY, monadProvider);
const sepoliaWallet     = new ethers.Wallet(process.env.PRIVATE_KEY, sepoliaProvider);
const baseSepoliaWallet = new ethers.Wallet(process.env.PRIVATE_KEY, baseSepoliaProvider);

// ─── Relayer ZK wallets ──────────────────

let relayerWallet;
let solanaRelayerWallet;
let suiRelayerWallet;
let aptosRelayerWallet;

async function initializeRelayer() {
    // Relayer noid keys are derived from the REAL deployer wallets — the same
    // sign("menoid_Wallet") derivation the deploy scripts used, so the relayer
    // user commitments match the on-chain registrations.

    // EVM
    relayerWallet = await generatePrivateWallet(process.env.PRIVATE_KEY);

    // Solana
    const solanaKey = process.env.SOLANA_DEPLOYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
    if (solanaKey) solanaRelayerWallet = await generateSolanaPrivateWallet(solanaKey);

    // Sui
    const suiKey = process.env.SUI_DEPLOYER_SECRET_KEY || process.env.DEPLOYER_SECRET_KEY;
    if (suiKey) suiRelayerWallet = await generateSuiPrivateWallet(suiKey);

    // Aptos
    const aptosKey = process.env.APTOS_DEPLOYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
    if (aptosKey) aptosRelayerWallet = await generateAptosPrivateWallet(aptosKey);

    console.log("[relayer] user commitments:", {
        evm:    relayerWallet?.userCommitment,
        solana: solanaRelayerWallet?.userCommitment,
        sui:    suiRelayerWallet?.userCommitment,
        aptos:  aptosRelayerWallet?.userCommitment
    });
}

// ─── buildWallet (per-network) ────────────────────────────────────────────────

async function buildWallet(network = "monad") {
    console.log(`\n========== BUILDING RELAYER WALLET [${network}] ==========`);

    const poseidon = await circomlibjs.buildPoseidon();

    const pools = await PoolState.find({ network });

    const nullifierState = await NullifierState.findOne({ key: "global", network });

    const spentNullifiers = new Set(nullifierState?.nullifiers || []);

    const walletState = {
        notes:       [],
        balance:     ethers.parseEther("0"),
        pools:       {}
    };

    // Determine relayer keys based on network
    let recipientPrivateKey;
    let zkSecretKey;
    if (network === "solana") {
        recipientPrivateKey = solanaRelayerWallet.privateWallet.privateKey;
        zkSecretKey = solanaRelayerWallet.zk.secretKey;
    } else if (network === "sui") {
        recipientPrivateKey = suiRelayerWallet.privateWallet.privateKey;
        zkSecretKey = suiRelayerWallet.zk.secretKey;
    } else if (network === "aptos") {
        recipientPrivateKey = aptosRelayerWallet.privateWallet.privateKey;
        zkSecretKey = aptosRelayerWallet.zk.secretKey;
    } else {
        recipientPrivateKey = relayerWallet.privateWallet.privateKey;
        zkSecretKey = relayerWallet.zk.secretKey;
    }


    // ── Notes / pools ──
    for (const pool of pools) {
        const poolId     = pool.poolId;
        const latestRoot = pool.latestRoot;

        const hash = (inputs) =>
            BigInt(poseidon.F.toString(poseidon(inputs)));

        const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);

        for (const commitment of pool.commitments) {
            tree.insert(BigInt(commitment));

            try {
                const encryptedNote = pool.encryptedNotes.get(commitment);
                const decrypted     = decryptMessageForNetwork(
                    encryptedNote,
                    recipientPrivateKey,
                    network
                );
                const parsed = JSON.parse(decrypted);

                const nullifier = ethers.zeroPadValue(
                    ethers.toBeHex(
                        BigInt(
                            poseidon.F.toString(
                                poseidon([
                                    2,
                                    BigInt(commitment),
                                    BigInt(parsed.randomness),
                                    BigInt(zkSecretKey)
                                    // Use the network-specific ZK secret key
                                ])
                            )
                        )
                    ),
                    32
                );

                if (spentNullifiers.has(nullifier)) continue;

                const leafIndex = pool.leafToIndex.get(commitment);

                walletState.notes.push({
                    poolId,
                    commitment,
                    amount:    parsed.amount,
                    randomness: parsed.randomness,
                    leafIndex,
                    root:      latestRoot
                });

                walletState.balance += BigInt(parsed.amount);
            } catch (_) {}
        }

        walletState.pools[poolId] = { tree, latestRoot };
    }

    console.log(`\n========== RELAYER WALLET [${network}] ==========`);
    console.log("Balance:", walletState.balance.toString());
    console.log("Unspent notes:", walletState.notes);

    return walletState;
}

// ─── Helpers: get provider / wallet / addresses by network name ───────────────

function getProviderForNetwork(network) {
    switch (network) {
        case "sepolia":     return sepoliaProvider;
        case "base_sepolia": return baseSepoliaProvider;
        case "monad":
        default:            return monadProvider;
    }
}

function getWalletForNetwork(network) {
    switch (network) {
        case "sepolia":     return sepoliaWallet;
        case "base_sepolia": return baseSepoliaWallet;
        case "monad":
        default:            return wallet;
    }
}

function getPoolAddressForNetwork(network) {
    switch (network) {
        case "sepolia":     return process.env.SEPOLIA_PRIVATE_POOL_ADDRESS;
        case "base_sepolia": return process.env.BASE_SEPOLIA_PRIVATE_POOL_ADDRESS;
        case "monad":
        default:            return process.env.MONAD_PRIVATE_POOL_ADDRESS;
    }
}


module.exports = {
    // raw providers
    provider:             monadProvider,      // kept for backward-compat (relayerWithdraw uses it)
    monadProvider,
    sepoliaProvider,
    baseSepoliaProvider,

    // raw wallets
    wallet,                                   // monad signing wallet (kept for backward-compat)
    sepoliaWallet,
    baseSepoliaWallet,

    // helpers
    getProviderForNetwork,
    getWalletForNetwork,
    getPoolAddressForNetwork,


    // relayer
    buildWallet,
    initializeRelayer,

    get relayerWallet() {
        return relayerWallet;
    },
    get solanaRelayerWallet() {
        return solanaRelayerWallet;
    },
    get suiRelayerWallet() {
        return suiRelayerWallet;
    },
    get aptosRelayerWallet() {
        return aptosRelayerWallet;
    }
};