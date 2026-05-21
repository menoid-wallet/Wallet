/**
 * crypto.ts
 *
 * ECIES (secp256k1) wrapper for encrypting / decrypting per-commitment
 * notes. This is the SAME format the relayer/backend already speaks —
 * directly ported from the old PriFi dapp's encryption helper.
 *
 * Why we use ethers' byte helpers and not `Buffer`:
 *   `Buffer` is a Node global. In a Plasmo browser bundle it either
 *   doesn't exist or gets polyfilled clumsily, which can break things.
 *   `getBytes` / `hexlify` / `toUtf8Bytes` / `toUtf8String` from ethers
 *   are pure ESM, work in every environment, and give us exactly what
 *   eciesjs expects (Uint8Array in, Uint8Array out).
 *
 * Why we don't strip the "0x" prefix manually:
 *   `getBytes` accepts "0x"-prefixed hex AND bare hex AND a Uint8Array.
 *   We let it normalize for us.
 *
 * Format contract:
 *   - encryptMessage(plaintext, publicKey)  → "0x..." hex string
 *   - decryptMessage(ciphertextHex, sk)     → UTF-8 plaintext
 *
 * Key shape:
 *   - publicKey: 65-byte uncompressed hex (matches SigningKey.computePublicKey(pk, false))
 *   - privateKey: 32-byte hex
 *   Both with or without "0x" — ethers normalizes.
 *
 * Errors:
 *   decryptMessage throws on garbage input or wrong key. PoolContext
 *   catches that and treats the note as "not mine", which is the
 *   expected path for most commitments in any given pool.
 */

import { encrypt, decrypt } from "eciesjs"
import {
  getBytes,
  hexlify,
  toUtf8Bytes,
  toUtf8String
} from "ethers"

/** Encrypt a UTF-8 message for the recipient's secp256k1 public key. */
export function encryptMessage(
  message: string,
  publicKey: string
): string {
  const messageBytes = toUtf8Bytes(message)
  const publicKeyBytes = getBytes(publicKey)
  const encrypted = encrypt(publicKeyBytes, messageBytes)
  return hexlify(encrypted)
}

/** Decrypt an ECIES ciphertext (hex) with the recipient's private key. */
export function decryptMessage(
  ciphertextHex: string,
  privateKey: string
): string {
  const ciphertextBytes = getBytes(ciphertextHex)
  const privateKeyBytes = getBytes(privateKey)
  const decrypted = decrypt(privateKeyBytes, ciphertextBytes)
  return toUtf8String(decrypted)
}