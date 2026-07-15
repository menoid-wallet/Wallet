/**
 * privateWallet.js — noid key derivation (register / user-commitment architecture)
 *
 * There is NO derived second wallet anymore. The REAL wallet signs the message
 * "menoid_Wallet" once; from that signature we derive:
 *
 *   - spending keypair (BabyJubJub): sk = H("menoid/spend" ‖ sig) mod l,
 *     pk = sk·Base8
 *   - encryption keypair:            H("menoid/encryption" ‖ sig)
 *     (used ONLY for encrypting/decrypting notes — never an on-chain account)
 *
 * The user representation on-chain is:
 *
 *   userCommitment = Poseidon(address mod p, spendPk.x, spendPk.y)
 *
 * Returned wallets carry BOTH the new fields and legacy-shaped aliases so the
 * rest of the backend keeps working:
 *   privateWallet: { address (REAL), privateKey (enc), publicKey (enc) }
 *   zk:            { secretKey: spend sk, publicKey: userCommitment }
 */
"use strict";

const { ethers } = require("ethers");
const circomlibjs = require("circomlibjs");
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58").default || require("bs58");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const { Ed25519Keypair } = require("@mysten/sui/keypairs/ed25519");
const { decodeSuiPrivateKey } = require("@mysten/sui/cryptography");
const { Account, Ed25519PrivateKey } = require("@aptos-labs/ts-sdk");

const REGISTRATION_MESSAGE = "menoid_Wallet";

// BabyJubJub prime subgroup order (l)
const BABYJUB_SUBGROUP_ORDER =
    2736030358979909402780800718157159386076813972158567259200215660948447373041n;

// BN254 scalar field prime
const BN254_P =
    21888242871839275222246405745257275088548364400416034343698204186575808495617n;

let _poseidon = null;
let _babyjub = null;

async function getPoseidon() {
    if (!_poseidon) _poseidon = await circomlibjs.buildPoseidon();
    return _poseidon;
}

async function getBabyjub() {
    if (!_babyjub) _babyjub = await circomlibjs.buildBabyjub();
    return _babyjub;
}

async function spendKeysFromScalarSeed(skBig) {
    const babyJub = await getBabyjub();
    const sk = skBig % BABYJUB_SUBGROUP_ORDER;
    const pkPoint = babyJub.mulPointEscalar(babyJub.Base8, sk);
    return {
        privateKey: sk.toString(),
        publicKey: {
            x: babyJub.F.toString(pkPoint[0]),
            y: babyJub.F.toString(pkPoint[1])
        }
    };
}

async function computeUserCommitment(addressField, spendPublicKey) {
    const poseidon = await getPoseidon();
    return poseidon.F.toString(
        poseidon([
            BigInt(addressField),
            BigInt(spendPublicKey.x),
            BigInt(spendPublicKey.y)
        ])
    );
}

function shaConcat(tag, signatureBytes) {
    return crypto
        .createHash("sha256")
        .update(Buffer.concat([Buffer.from(tag), Buffer.from(signatureBytes)]))
        .digest();
}

function buildResult({ address, addressField, spend, encryption, userCommitment }) {
    return {
        address,
        addressField,
        spend,
        encryption,
        userCommitment,
        // ── legacy-shaped aliases (keep the rest of the backend working) ──
        privateWallet: {
            address,
            privateKey: encryption.privateKey,
            publicKey: encryption.publicKey
        },
        zk: {
            secretKey: spend.privateKey,
            publicKey: userCommitment
        }
    };
}

// ─── EVM ──────────────────────────────────────────────────────────────────────

async function generatePrivateWallet(privateKeyHex) {
    const pk = privateKeyHex.startsWith("0x") ? privateKeyHex : "0x" + privateKeyHex;
    const realWallet = new ethers.Wallet(pk);

    // real wallet signs the registration message (EIP-191)
    const signature = await realWallet.signMessage(REGISTRATION_MESSAGE);

    const spendSk = BigInt(
        ethers.solidityPackedKeccak256(["string", "bytes"], ["menoid/spend", signature])
    );
    const spend = await spendKeysFromScalarSeed(spendSk);

    const encPrivateKey = ethers.solidityPackedKeccak256(
        ["string", "bytes"],
        ["menoid/encryption", signature]
    );
    const encryption = {
        privateKey: encPrivateKey,
        publicKey: ethers.SigningKey.computePublicKey(encPrivateKey, false)
    };

    const addressField = BigInt(realWallet.address).toString();
    const userCommitment = await computeUserCommitment(addressField, spend.publicKey);

    return buildResult({
        address: realWallet.address,
        addressField,
        spend,
        encryption,
        userCommitment
    });
}

// ─── Solana ───────────────────────────────────────────────────────────────────

async function generateSolanaPrivateWallet(secretKeyBase58) {
    const keypair = Keypair.fromSecretKey(bs58.decode(secretKeyBase58.trim()));

    const signature = nacl.sign.detached(
        new TextEncoder().encode(REGISTRATION_MESSAGE),
        keypair.secretKey
    );

    const spendSeed = shaConcat("menoid/spend", signature);
    const spend = await spendKeysFromScalarSeed(BigInt("0x" + spendSeed.toString("hex")));

    const encSeed = shaConcat("menoid/encryption", signature);
    const encKeypair = nacl.sign.keyPair.fromSeed(encSeed);
    const encryption = {
        privateKey: bs58.encode(Buffer.from(encKeypair.secretKey)),
        publicKey: bs58.encode(Buffer.from(encKeypair.publicKey))
    };

    const address = keypair.publicKey.toBase58();
    const addressField = (
        BigInt("0x" + Buffer.from(keypair.publicKey.toBytes()).toString("hex")) % BN254_P
    ).toString();
    const userCommitment = await computeUserCommitment(addressField, spend.publicKey);

    return buildResult({ address, addressField, spend, encryption, userCommitment });
}

// ─── Sui ──────────────────────────────────────────────────────────────────────

async function generateSuiPrivateWallet(secretKey) {
    const trimmed = secretKey.trim();
    const seed = trimmed.startsWith("suiprivkey")
        ? decodeSuiPrivateKey(trimmed).secretKey
        : Uint8Array.from(Buffer.from(trimmed, "base64"));
    const keypair = Ed25519Keypair.fromSecretKey(seed);

    // raw deterministic ed25519 signature over the registration message
    const naclKeypair = nacl.sign.keyPair.fromSeed(seed);
    const signature = nacl.sign.detached(
        new TextEncoder().encode(REGISTRATION_MESSAGE),
        naclKeypair.secretKey
    );

    const spendSeed = shaConcat("menoid/spend", signature);
    const spend = await spendKeysFromScalarSeed(BigInt("0x" + spendSeed.toString("hex")));

    const encSeed = shaConcat("menoid/encryption", signature);
    const encKeypair = Ed25519Keypair.fromSecretKey(encSeed);
    const encryption = {
        privateKey: encKeypair.getSecretKey(),
        publicKey: encKeypair.getPublicKey().toBase64()
    };

    const address = keypair.getPublicKey().toSuiAddress();
    const addressField = (BigInt(address) % BN254_P).toString();
    const userCommitment = await computeUserCommitment(addressField, spend.publicKey);

    return buildResult({ address, addressField, spend, encryption, userCommitment });
}

// ─── Aptos ────────────────────────────────────────────────────────────────────

async function generateAptosPrivateWallet(privateKeyHex) {
    const account = Account.fromPrivateKey({
        privateKey: new Ed25519PrivateKey(privateKeyHex.trim())
    });

    const signature = account
        .sign(new TextEncoder().encode(REGISTRATION_MESSAGE))
        .toUint8Array();

    const spendSeed = shaConcat("menoid/spend", signature);
    const spend = await spendKeysFromScalarSeed(BigInt("0x" + spendSeed.toString("hex")));

    const encSeed = shaConcat("menoid/encryption", signature);
    const encKeypair = nacl.sign.keyPair.fromSeed(encSeed);
    const toHex = (bytes) => "0x" + Buffer.from(bytes).toString("hex");
    const encryption = {
        privateKey: toHex(encKeypair.secretKey),
        publicKey: toHex(encKeypair.publicKey)
    };

    const address = account.accountAddress.toString();
    const addressField = (BigInt(address) % BN254_P).toString();
    const userCommitment = await computeUserCommitment(addressField, spend.publicKey);

    return buildResult({ address, addressField, spend, encryption, userCommitment });
}

module.exports = {
    REGISTRATION_MESSAGE,
    BABYJUB_SUBGROUP_ORDER,
    BN254_P,
    computeUserCommitment,
    generatePrivateWallet,
    generateSolanaPrivateWallet,
    generateSuiPrivateWallet,
    generateAptosPrivateWallet
};
