/**
 * verifyPassword.ts
 * Used by the Settings → Account Details flow to gate key reveal
 * behind a password check, without ever holding the raw password
 * around longer than necessary.
 */

import { decryptWallet } from "../crypto/walletCrypto"
import type { EncryptedWallet } from "../crypto/walletCrypto"

export async function verifyPasswordFromStorage(
  password: string
): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get("menoid_wallet")
    if (!result.menoid_wallet) return false
    const encrypted: EncryptedWallet = JSON.parse(result.menoid_wallet)
    await decryptWallet(encrypted, password)
    return true
  } catch {
    return false
  }
}