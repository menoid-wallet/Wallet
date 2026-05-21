/**
 * wallets.ts
 *
 * Storage layer for the multi-wallet system.
 *
 *   chrome.storage.local["menoid_wallets"] →
 *     {
 *       active: number,           // index into list
 *       list: WalletEntry[]       // each entry has cached metadata + ciphertext
 *     }
 *
 *   chrome.storage.local["menoid_wallet"] (LEGACY single-wallet record)
 *     → migrated on first unlock into "menoid_wallets" and then removed.
 *
 * Every entry in the list is encrypted with the SAME wallet password — so a
 * single password unlocks everything. The session keeps that password in
 * memory (see sessionPassword.ts) so adding a wallet later does not require
 * the user to retype it.
 */

import {
  decryptWallet,
  encryptWallet,
  type EncryptedWallet,
  type StoredWallet
} from "../crypto/walletCrypto"

const WALLETS_KEY = "menoid_wallets"
const LEGACY_KEY = "menoid_wallet"
const ONBOARDING_KEY = "menoid_onboarding"

export interface WalletEntry {
  id: string
  name: string                 // includes the ".meno" suffix
  encrypted: EncryptedWallet
  openAddress: string          // cached normalAccount.address
  noidPublicKey: string        // cached noidAccount.publicKey
  zkPublicKey: string          // cached noidAccount.zkPublicKey
  registeredOpen: boolean      // whether this wallet has an /api/users record
  registeredNoid: boolean      // whether this wallet has an /api/noidusers record
}

export interface WalletsState {
  active: number
  list: WalletEntry[]
}

export function ensureMenoSuffix(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return "Account.meno"
  return trimmed.toLowerCase().endsWith(".meno") ? trimmed : `${trimmed}.meno`
}

function makeId(): string {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID()
  return "w_" + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export async function readWalletsState(): Promise<WalletsState | null> {
  const r = await chrome.storage.local.get(WALLETS_KEY)
  if (r?.[WALLETS_KEY]) {
    try {
      const parsed = JSON.parse(r[WALLETS_KEY]) as WalletsState
      if (parsed && Array.isArray(parsed.list)) return parsed
    } catch {
      /* fall through */
    }
  }
  return null
}

export async function readLegacyEncrypted(): Promise<EncryptedWallet | null> {
  const r = await chrome.storage.local.get(LEGACY_KEY)
  if (!r?.[LEGACY_KEY]) return null
  try {
    return JSON.parse(r[LEGACY_KEY]) as EncryptedWallet
  } catch {
    return null
  }
}

export async function writeWalletsState(state: WalletsState): Promise<void> {
  await chrome.storage.local.set({
    [WALLETS_KEY]: JSON.stringify(state),
    [ONBOARDING_KEY]: true
  })
}

export async function clearLegacyEncrypted(): Promise<void> {
  try {
    await chrome.storage.local.remove(LEGACY_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * If only a legacy single-wallet record exists, decrypt it with `password`
 * and migrate to the new multi-wallet shape. Returns the (already
 * persisted) state, or null if there was nothing to migrate.
 */
export async function migrateLegacyIfNeeded(
  password: string
): Promise<WalletsState | null> {
  const existing = await readWalletsState()
  if (existing) return existing

  const legacy = await readLegacyEncrypted()
  if (!legacy) return null

  const wallet = await decryptWallet(legacy, password)
  const entry: WalletEntry = {
    id: makeId(),
    name: "Account 1.meno",
    encrypted: legacy,
    openAddress: wallet.normalAccount.address,
    noidPublicKey: wallet.noidAccount.publicKey,
    zkPublicKey: wallet.noidAccount.zkPublicKey,
    registeredOpen: false,
    registeredNoid: false
  }
  const state: WalletsState = { active: 0, list: [entry] }
  await writeWalletsState(state)
  await clearLegacyEncrypted()
  return state
}

export async function decryptAll(
  state: WalletsState,
  password: string
): Promise<StoredWallet[]> {
  const out: StoredWallet[] = []
  for (const entry of state.list) {
    out.push(await decryptWallet(entry.encrypted, password))
  }
  return out
}

export async function addWalletEntry(opts: {
  state: WalletsState
  name: string
  password: string
  fullWallet: StoredWallet
  registeredOpen: boolean
  registeredNoid: boolean
}): Promise<WalletsState> {
  const {
    state,
    name,
    password,
    fullWallet,
    registeredOpen,
    registeredNoid
  } = opts
  const encrypted = await encryptWallet(fullWallet, password)
  const entry: WalletEntry = {
    id: makeId(),
    name: ensureMenoSuffix(name),
    encrypted,
    openAddress: fullWallet.normalAccount.address,
    noidPublicKey: fullWallet.noidAccount.publicKey,
    zkPublicKey: fullWallet.noidAccount.zkPublicKey,
    registeredOpen,
    registeredNoid
  }
  const next: WalletsState = {
    active: state.list.length, // new one becomes active
    list: [...state.list, entry]
  }
  await writeWalletsState(next)
  return next
}

export async function setActiveIndex(
  state: WalletsState,
  index: number
): Promise<WalletsState> {
  const next: WalletsState = { ...state, active: index }
  await writeWalletsState(next)
  return next
}

export async function createInitialState(opts: {
  name: string
  password: string
  fullWallet: StoredWallet
  registeredOpen: boolean
  registeredNoid: boolean
}): Promise<WalletsState> {
  const encrypted = await encryptWallet(opts.fullWallet, opts.password)
  const entry: WalletEntry = {
    id: makeId(),
    name: ensureMenoSuffix(opts.name),
    encrypted,
    openAddress: opts.fullWallet.normalAccount.address,
    noidPublicKey: opts.fullWallet.noidAccount.publicKey,
    zkPublicKey: opts.fullWallet.noidAccount.zkPublicKey,
    registeredOpen: opts.registeredOpen,
    registeredNoid: opts.registeredNoid
  }
  const state: WalletsState = { active: 0, list: [entry] }
  await writeWalletsState(state)
  return state
}

export async function hasAnyWallet(): Promise<boolean> {
  const r = await chrome.storage.local.get([WALLETS_KEY, LEGACY_KEY])
  return !!r?.[WALLETS_KEY] || !!r?.[LEGACY_KEY]
}
