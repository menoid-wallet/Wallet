/**
 * crypto.ts
 *
 * ECIES wrapper (secp256k1) for encrypting/decrypting per-commitment notes.
 *
 * Why eciesjs and not the wallet's own ECDH?
 *   The on-chain contract emits `bytes` blobs of opaque ciphertext keyed by
 *   commitment. Any holder of the recipient's secp256k1 PRIVATE KEY can
 *   decrypt; nobody else can. eciesjs gives us that with one call per side
 *   and matches the format the relayer/backend already speaks (the same
 *   scheme used in the original PriFi dapp).
 *
 * Format:
 *   - encryptMessage returns a "0x"-prefixed hex string that can be stored
 *     on-chain or in the indexer's encryptedNotes Map.
 *   - decryptMessage takes that hex back and returns the original UTF-8
 *     plaintext. We JSON.parse it ourselves at the call site.
 *
 * Key shape:
 *   - publicKey: 65-byte uncompressed hex ("0x04...") — matches what
 *     keyDerivation.ts produces via SigningKey.computePublicKey(pk, false).
 *   - privateKey: 32-byte hex ("0x..."). Either prefix works because
 *     eciesjs strips it internally.
 *
 * Errors:
 *   - decryptMessage throws on garbage input / wrong key. PoolContext
 *     swallows that and treats the note as "not mine", which is exactly
 *     what we want — every poll iterates over EVERY commitment in the
 *     pool, and most of them aren't ours.
 */

import { encrypt, decrypt } from "eciesjs"

function stripHex(s: string): string {
  return s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s
}

/** Encrypt a UTF-8 message for the recipient's secp256k1 public key. */
export function encryptMessage(plaintext: string, recipientPublicKeyHex: string): string {
  const pk = stripHex(recipientPublicKeyHex)
  const pubBuf = Buffer.from(pk, "hex")
  const cipher = encrypt(pubBuf, Buffer.from(plaintext, "utf8"))
  return "0x" + cipher.toString("hex")
}

/** Decrypt an ECIES ciphertext (as hex) with the recipient's private key. */
export function decryptMessage(ciphertextHex: string, privateKeyHex: string): string {
  const ct = stripHex(ciphertextHex)
  const sk = stripHex(privateKeyHex)
  const plainBuf = decrypt(Buffer.from(sk, "hex"), Buffer.from(ct, "hex"))
  return plainBuf.toString("utf8")
}