const { ethers }      = require("ethers");
const circomlibjs     = require("circomlibjs");

const PoolState        = require("../models/PoolState");
const NullifierState   = require("../models/NullifierState");
const NoidAccountState = require("../models/NoidAccountState");

const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");
const { decryptMessage }        = require("../helpers/crypto");
const { generatePrivateWallet } = require("../helpers/privateWallet");

require("dotenv").config();

// ─── Providers ────────────────────────────────────────────────────────────────

const monadProvider     = new ethers.JsonRpcProvider(process.env.RPC_URL);
const sepoliaProvider   = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
const baseSepoliaProvider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC_URL);

// Single signing wallet (same key, each provider)
const wallet            = new ethers.Wallet(process.env.PRIVATE_KEY, monadProvider);
const sepoliaWallet     = new ethers.Wallet(process.env.PRIVATE_KEY, sepoliaProvider);
const baseSepoliaWallet = new ethers.Wallet(process.env.PRIVATE_KEY, baseSepoliaProvider);

// ─── Relayer ZK wallet (derived once, shared across chains) ──────────────────

let relayerWallet;

async function initializeRelayer() {
    relayerWallet = await generatePrivateWallet(
        process.env.PRIVATE_KEY + "Menoid wallet"
    );
}

// ─── buildWallet (per-network) ────────────────────────────────────────────────

async function buildWallet(network = "monad") {
    console.log(`\n========== BUILDING RELAYER WALLET [${network}] ==========`);

    const poseidon = await circomlibjs.buildPoseidon();

    const pools = await PoolState.find({ network });

    const nullifierState = await NullifierState.findOne({ key: "global", network });
    const noidAccountState = await NoidAccountState.findOne({ key: "global", network });

    const spentNullifiers = new Set(nullifierState?.nullifiers || []);

    const walletState = {
        notes:       [],
        noidAccounts: [],
        balance:     ethers.parseEther("0"),
        pools:       {}
    };

    // ── Noid accounts ──
    for (const account of noidAccountState?.noidAccounts || []) {
        try {
            const decrypted = decryptMessage(
                account.encryptedNote,
                relayerWallet.privateWallet.privateKey
            );
            const parsed = JSON.parse(decrypted);
            walletState.noidAccounts.push({
                noidAccountAddress: account.noidAccountAddress,
                ownerCommitment:    account.ownerCommitment,
                randomness:         parsed.randomness
            });
        } catch (_) {}
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
                const decrypted     = decryptMessage(
                    encryptedNote,
                    relayerWallet.privateWallet.privateKey
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
                                    BigInt(relayerWallet.zk.secretKey)
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

function getNoidAccountManagerAddressForNetwork(network) {
    switch (network) {
        case "sepolia":     return process.env.SEPOLIA_NOID_ACCOUNT_MANAGER_ADDRESS;
        case "base_sepolia": return process.env.BASE_SEPOLIA_NOID_ACCOUNT_MANAGER_ADDRESS;
        case "monad":
        default:            return process.env.MONAD_NOID_ACCOUNT_MANAGER_ADDRESS;
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
    getNoidAccountManagerAddressForNetwork,

    // relayer
    buildWallet,
    initializeRelayer,

    get relayerWallet() {
        return relayerWallet;
    }
};