const { ethers } = require("ethers");
const circomlibjs = require("circomlibjs");
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58").default || require("bs58");
const crypto = require("crypto");
const { Ed25519Keypair } = require("@mysten/sui/keypairs/ed25519");
const { Account, Ed25519PrivateKey } = require("@aptos-labs/ts-sdk");

async function generatePrivateWallet(seedInput) {
    const poseidon = await circomlibjs.buildPoseidon();

    // deterministic seed
    const seed = ethers.keccak256(ethers.toUtf8Bytes(seedInput));

    // derived private wallet
    const privateWallet = new ethers.Wallet(seed);

    // zk secret key
    const sk = BigInt(privateWallet.privateKey).toString();

    // zk public key
    const pk = poseidon.F.toString(
        poseidon([3, sk])
    );

    return {
        privateWallet: {
            address: privateWallet.address,
            privateKey: privateWallet.privateKey,
            publicKey: ethers.SigningKey.computePublicKey(
                privateWallet.privateKey,
                false
            )
        },
        zk: {
            secretKey: sk,
            publicKey: pk
        }
    };
}

async function generateSolanaPrivateWallet(seedInput) {
    const poseidon = await circomlibjs.buildPoseidon();

    // Deterministic 32-byte private key via sha256 of seed
    const hash = crypto.createHash("sha256").update(seedInput).digest();
    const privateKeyHex = "0x" + hash.toString("hex");

    // Derive Solana Ed25519 Keypair
    const keypair = Keypair.fromSeed(hash);
    const address = keypair.publicKey.toBase58();
    const privateKey = bs58.encode(keypair.secretKey);
    const publicKey = keypair.publicKey.toBase58();

    // ZK secret key = private key interpreted as a decimal BigInt
    const sk = BigInt(privateKeyHex).toString(10);

    // ZK public key = Poseidon(3, sk)
    const pkBig = poseidon([BigInt("3"), BigInt(sk)]);
    const pk = poseidon.F.toString(pkBig);

    return {
        privateWallet: {
            address,
            privateKey,
            publicKey
        },
        zk: {
            secretKey: sk,
            publicKey: pk
        }
    };
}

async function generateSuiPrivateWallet(seedInput) {
    const poseidon = await circomlibjs.buildPoseidon();

    // Deterministic 32-byte private key via sha256 of seed
    const hash = crypto.createHash("sha256").update(seedInput).digest();
    const privateKeyHex = "0x" + hash.toString("hex");

    // Derive Sui Ed25519 Keypair
    const keypair = Ed25519Keypair.fromSecretKey(hash);
    const address = keypair.getPublicKey().toSuiAddress();
    const privateKey = keypair.getSecretKey();
    const publicKey = keypair.getPublicKey().toBase64();

    // ZK secret key = private key interpreted as a decimal BigInt
    const sk = BigInt(privateKeyHex).toString(10);

    // ZK public key = Poseidon(3, sk)
    const pkBig = poseidon([BigInt("3"), BigInt(sk)]);
    const pk = poseidon.F.toString(pkBig);

    return {
        privateWallet: {
            address,
            privateKey,
            publicKey
        },
        zk: {
            secretKey: sk,
            publicKey: pk
        }
    };
}

async function generateAptosPrivateWallet(seedInput) {
    const poseidon = await circomlibjs.buildPoseidon();

    // Deterministic 32-byte private key via sha256 of seed
    const hash = crypto.createHash("sha256").update(seedInput).digest();
    const privateKeyHex = "0x" + hash.toString("hex");

    // Derive Aptos Ed25519 Keypair
    const privateKeyObj = new Ed25519PrivateKey(hash);
    const account = Account.fromPrivateKey({ privateKey: privateKeyObj });
    const address = account.accountAddress.toString();

    const toHex = (bytes) => "0x" + Buffer.from(bytes).toString("hex");
    const privateKey = toHex(privateKeyObj.toUint8Array());
    const publicKey = toHex(privateKeyObj.publicKey().toUint8Array());

    // ZK secret key = private key interpreted as a decimal BigInt
    const sk = BigInt(privateKeyHex).toString(10);

    // ZK public key = Poseidon(3, sk)
    const pkBig = poseidon([BigInt("3"), BigInt(sk)]);
    const pk = poseidon.F.toString(pkBig);

    return {
        privateWallet: {
            address,
            privateKey,
            publicKey
        },
        zk: {
            secretKey: sk,
            publicKey: pk
        }
    };
}

module.exports = {
    generatePrivateWallet,
    generateSolanaPrivateWallet,
    generateSuiPrivateWallet,
    generateAptosPrivateWallet
};