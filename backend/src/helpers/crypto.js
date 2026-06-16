const { encrypt, decrypt } = require("eciesjs");
const { getBytes, hexlify, toUtf8Bytes, toUtf8String } = require("ethers");
const bs58 = require("bs58").default || require("bs58");
const nacl = require("tweetnacl");
const crypto = require("crypto");
const { decodeSuiPrivateKey } = require("@mysten/sui/cryptography");

const P = (1n << 255n) - 19n;

function modInverse(e) {
    return expMod(e, P - 2n, P);
}

function expMod(base, exp, mod) {
    let res = 1n;
    let b = base % mod;
    let e = exp;
    while (e > 0n) {
        if (e % 2n === 1n) res = (res * b) % mod;
        b = (b * b) % mod;
        e /= 2n;
    }
    return res;
}

function ed25519PubkeyToCurve25519(ed25519Pub) {
    const yBytes = new Uint8Array(ed25519Pub);
    yBytes[31] &= 0x7f;
    let y = 0n;
    for (let i = 31; i >= 0; i--) {
        y = (y << 8n) + BigInt(yBytes[i]);
    }
    const num = (1n + y) % P;
    const den = (1n - y + P) % P;
    const u = (num * modInverse(den)) % P;
    const uBytes = new Uint8Array(32);
    let temp = u;
    for (let i = 0; i < 32; i++) {
        uBytes[i] = Number(temp & 0xffn);
        temp >>= 8n;
    }
    return uBytes;
}

function ed25519SecretKeyToCurve25519(ed25519Sec) {
    const seed = ed25519Sec.length === 64 ? ed25519Sec.slice(0, 32) : ed25519Sec;
    const hash = crypto.createHash("sha512").update(seed).digest();
    const curveSec = new Uint8Array(hash.slice(0, 32));
    curveSec[0] &= 248;
    curveSec[31] &= 127;
    curveSec[31] |= 64;
    return curveSec;
}

function hexToBytes(hex) {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    const result = new Uint8Array(clean.length / 2);
    for (let i = 0; i < result.length; i++) {
        result[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return result;
}

// encrypt plaintext using public key (EVM secp256k1)
function encryptMessage(message, publicKey) {
    const messageBytes = toUtf8Bytes(message);
    const publicKeyBytes = getBytes(publicKey);
    const encrypted = encrypt(publicKeyBytes, messageBytes);
    return hexlify(encrypted);
}

// decrypt ciphertext using private key (EVM secp256k1)
function decryptMessage(ciphertextHex, privateKey) {
    const ciphertextBytes = getBytes(ciphertextHex);
    const privateKeyBytes = getBytes(privateKey);
    const decrypted = decrypt(privateKeyBytes, ciphertextBytes);
    return toUtf8String(decrypted);
}

function decryptSolanaMessage(ciphertextHex, secretKeyBase58) {
    const cleanHex = ciphertextHex.startsWith("0x") ? ciphertextHex.slice(2) : ciphertextHex;
    const ciphertext = Uint8Array.from(Buffer.from(cleanHex, "hex"));
    const edSec = bs58.decode(secretKeyBase58);
    const recipientCurveSec = ed25519SecretKeyToCurve25519(edSec);
    const ephemeralPub = ciphertext.slice(0, 32);
    const nonce = ciphertext.slice(32, 56);
    const encrypted = ciphertext.slice(56);
    const decrypted = nacl.box.open(encrypted, nonce, ephemeralPub, recipientCurveSec);
    if (!decrypted) throw new Error("Failed to decrypt Solana message");
    return new TextDecoder().decode(decrypted);
}

// decrypt a 0x-prefixed hex ciphertext using Bech32 Ed25519 suiprivkey.
function decryptSuiMessage(ciphertextHex, secretKeyBech32) {
    const cleanHex = ciphertextHex.startsWith("0x") ? ciphertextHex.slice(2) : ciphertextHex;
    const ciphertext = Uint8Array.from(Buffer.from(cleanHex, "hex"));
    const decoded = decodeSuiPrivateKey(secretKeyBech32);
    const recipientCurveSec = ed25519SecretKeyToCurve25519(decoded.secretKey);
    const ephemeralPub = ciphertext.slice(0, 32);
    const nonce = ciphertext.slice(32, 56);
    const encrypted = ciphertext.slice(56);
    const decrypted = nacl.box.open(encrypted, nonce, ephemeralPub, recipientCurveSec);
    if (!decrypted) throw new Error("Failed to decrypt Sui message");
    return new TextDecoder().decode(decrypted);
}

function decryptAptosMessage(ciphertextHex, privateKeyHex) {
    const cleanHex = ciphertextHex.startsWith("0x") ? ciphertextHex.slice(2) : ciphertextHex;
    const ciphertext = Uint8Array.from(Buffer.from(cleanHex, "hex"));
    const edSec = hexToBytes(privateKeyHex);
    const recipientCurveSec = ed25519SecretKeyToCurve25519(edSec);
    const ephemeralPub = ciphertext.slice(0, 32);
    const nonce = ciphertext.slice(32, 56);
    const encrypted = ciphertext.slice(56);
    const decrypted = nacl.box.open(encrypted, nonce, ephemeralPub, recipientCurveSec);
    if (!decrypted) throw new Error("Failed to decrypt Aptos message");
    return new TextDecoder().decode(decrypted);
}

function decryptMessageForNetwork(ciphertextHex, privateKey, network) {
    if (network === "solana") return decryptSolanaMessage(ciphertextHex, privateKey);
    if (network === "sui") return decryptSuiMessage(ciphertextHex, privateKey);
    if (network === "aptos") return decryptAptosMessage(ciphertextHex, privateKey);
    return decryptMessage(ciphertextHex, privateKey);
}

module.exports = {
    encryptMessage,
    decryptMessage,
    decryptMessageForNetwork
};