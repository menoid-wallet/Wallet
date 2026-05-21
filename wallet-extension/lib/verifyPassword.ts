/**
 * verifyPassword.ts
 * Used by the Settings → Account Details flow to gate key reveal behind
 * a password check, without ever holding the raw password around longer
 * than necessary.
 *
 * Verifies against the ACTIVE wallet's encrypted blob in the new
 * multi-wallet store. Falls back to the legacy single-wallet record so
 * users that have not yet had their data migrated can still verify.
 */

import { decryptWallet, type EncryptedWallet } from "../crypto/walletCrypto"
import { readLegacyEncrypted, readWalletsState } from "./wallets"

export async function verifyPasswordFromStorage(
  password: string
): Promise<boolean> {
  try {
    const state = await readWalletsState()
    if (state && state.list.length > 0) {
      const active = state.list[state.active] ?? state.list[0]
      await decryptWallet(active.encrypted, password)
      return true
    }
    const legacy = await readLegacyEncrypted()
    if (legacy) {
      await decryptWallet(legacy as EncryptedWallet, password)
      return true
    }
    return false
  } catch {
    return false
  }
}
