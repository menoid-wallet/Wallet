/**
 * crypto.ts
 *
 * ECIES wrappers for Monad (secp256k1) and Solana/Sui/Aptos (Ed25519/Curve25519).
 */

import { encrypt, decrypt } from "eciesjs";
import bs58 from "bs58";
// @ts-ignore
import nacl from "tweetnacl";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { sha512 } from "@noble/hashes/sha2.js";

const P = (1n << 255n) - 19n;

function modInverse(e: bigint): bigint {
  return expMod(e, P - 2n, P);
}

function expMod(base: bigint, exp: bigint, mod: bigint): bigint {
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

function stripHex(s: string): string {
  return s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = stripHex(hex);
  const result = new Uint8Array(clean.length / 2);
  for (let i = 0; i < result.length; i++) {
    result[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return result;
}

export function ed25519PubkeyToCurve25519(ed25519Pub: Uint8Array): Uint8Array {
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

export function ed25519SecretKeyToCurve25519(ed25519Sec: Uint8Array): Uint8Array {
  const seed = ed25519Sec.length === 64 ? ed25519Sec.slice(0, 32) : ed25519Sec;
  const hash = sha512(seed);
  const curveSec = new Uint8Array(hash.slice(0, 32));
  curveSec[0] &= 248;
  curveSec[31] &= 127;
  curveSec[31] |= 64;
  return curveSec;
}

// ─── Network Specific Encryption / Decryption ────────────────────────────────

function encryptSolana(message: string, publicKeyBase58: string): string {
  const edPub = bs58.decode(publicKeyBase58);
  const recipientCurvePub = ed25519PubkeyToCurve25519(edPub);
  const ephemeralKeypair = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  
  const msgBytes = new TextEncoder().encode(message);
  const encrypted = nacl.box(
    msgBytes,
    nonce,
    recipientCurvePub,
    ephemeralKeypair.secretKey
  );
  
  const result = new Uint8Array(32 + 24 + encrypted.length);
  result.set(ephemeralKeypair.publicKey, 0);
  result.set(nonce, 32);
  result.set(encrypted, 32 + 24);
  
  return "0x" + Buffer.from(result).toString("hex");
}

function decryptSolana(ciphertextHex: string, secretKeyBase58: string): string {
  const cleanHex = stripHex(ciphertextHex);
  const ciphertext = Uint8Array.from(Buffer.from(cleanHex, "hex"));
  
  let edSec: Uint8Array;
  try {
    edSec = bs58.decode(secretKeyBase58.trim());
  } catch (e) {
    const clean = secretKeyBase58.replace(/^0x/, "").trim();
    edSec = Uint8Array.from(Buffer.from(clean, "hex"));
  }
  const recipientCurveSec = ed25519SecretKeyToCurve25519(edSec);
  
  const ephemeralPub = ciphertext.slice(0, 32);
  const nonce = ciphertext.slice(32, 56);
  const encrypted = ciphertext.slice(56);
  
  const decrypted = nacl.box.open(
    encrypted,
    nonce,
    ephemeralPub,
    recipientCurveSec
  );
  if (!decrypted) {
    throw new Error("Failed to decrypt Solana message");
  }
  return new TextDecoder().decode(decrypted);
}

function encryptSui(message: string, publicKeyBase64: string): string {
  const edPub = Uint8Array.from(Buffer.from(publicKeyBase64, "base64"));
  const recipientCurvePub = ed25519PubkeyToCurve25519(edPub);
  const ephemeralKeypair = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  
  const msgBytes = new TextEncoder().encode(message);
  const encrypted = nacl.box(
    msgBytes,
    nonce,
    recipientCurvePub,
    ephemeralKeypair.secretKey
  );
  
  const result = new Uint8Array(32 + 24 + encrypted.length);
  result.set(ephemeralKeypair.publicKey, 0);
  result.set(nonce, 32);
  result.set(encrypted, 32 + 24);
  
  return "0x" + Buffer.from(result).toString("hex");
}

function decryptSui(ciphertextHex: string, secretKeyBech32: string): string {
  const cleanHex = stripHex(ciphertextHex);
  const ciphertext = Uint8Array.from(Buffer.from(cleanHex, "hex"));
  
  const decoded = decodeSuiPrivateKey(secretKeyBech32);
  const recipientCurveSec = ed25519SecretKeyToCurve25519(decoded.secretKey);
  
  const ephemeralPub = ciphertext.slice(0, 32);
  const nonce = ciphertext.slice(32, 56);
  const encrypted = ciphertext.slice(56);
  
  const decrypted = nacl.box.open(
    encrypted,
    nonce,
    ephemeralPub,
    recipientCurveSec
  );
  if (!decrypted) {
    throw new Error("Failed to decrypt Sui message");
  }
  return new TextDecoder().decode(decrypted);
}

function encryptAptos(message: string, publicKeyHex: string): string {
  const edPub = hexToBytes(publicKeyHex);
  const recipientCurvePub = ed25519PubkeyToCurve25519(edPub);
  const ephemeralKeypair = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  
  const msgBytes = new TextEncoder().encode(message);
  const encrypted = nacl.box(
    msgBytes,
    nonce,
    recipientCurvePub,
    ephemeralKeypair.secretKey
  );
  
  const result = new Uint8Array(32 + 24 + encrypted.length);
  result.set(ephemeralKeypair.publicKey, 0);
  result.set(nonce, 32);
  result.set(encrypted, 32 + 24);
  
  return "0x" + Buffer.from(result).toString("hex");
}

function decryptAptos(ciphertextHex: string, privateKeyHex: string): string {
  const cleanHex = stripHex(ciphertextHex);
  const ciphertext = Uint8Array.from(Buffer.from(cleanHex, "hex"));
  
  const edSec = hexToBytes(privateKeyHex);
  const recipientCurveSec = ed25519SecretKeyToCurve25519(edSec);
  
  const ephemeralPub = ciphertext.slice(0, 32);
  const nonce = ciphertext.slice(32, 56);
  const encrypted = ciphertext.slice(56);
  
  const decrypted = nacl.box.open(
    encrypted,
    nonce,
    ephemeralPub,
    recipientCurveSec
  );
  if (!decrypted) {
    throw new Error("Failed to decrypt Aptos message");
  }
  return new TextDecoder().decode(decrypted);
}

// ─── Unified Exports ─────────────────────────────────────────────────────────

/** Encrypt a UTF-8 message for the recipient's public key (based on network). */
export function encryptMessage(
  plaintext: string,
  recipientPublicKey: string,
  network: string = "monad"
): string {
  if (network === "solana") return encryptSolana(plaintext, recipientPublicKey);
  if (network === "sui") return encryptSui(plaintext, recipientPublicKey);
  if (network === "aptos") return encryptAptos(plaintext, recipientPublicKey);

  // EVM fallback (secp256k1 ECIES)
  const pk = stripHex(recipientPublicKey);
  const pubBuf = Buffer.from(pk, "hex");
  const cipher = encrypt(pubBuf, Buffer.from(plaintext, "utf8"));
  return "0x" + cipher.toString("hex");
}

/** Decrypt an ECIES ciphertext with the recipient's private key (based on network). */
export function decryptMessage(
  ciphertextHex: string,
  privateKey: string,
  network: string = "monad"
): string {
  if (network === "solana") return decryptSolana(ciphertextHex, privateKey);
  if (network === "sui") return decryptSui(ciphertextHex, privateKey);
  if (network === "aptos") return decryptAptos(ciphertextHex, privateKey);

  // EVM fallback (secp256k1 ECIES)
  const ct = stripHex(ciphertextHex);
  const sk = stripHex(privateKey);
  const plainBuf = decrypt(Buffer.from(sk, "hex"), Buffer.from(ct, "hex"));
  return plainBuf.toString("utf8");
}