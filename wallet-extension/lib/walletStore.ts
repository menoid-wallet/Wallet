/**
 * walletStore.ts
 *
 * Multi-wallet persistence layer.
 *
 * Storage layout (chrome.storage.local):
 *
 *   menoid_wallets_v2          → JSON string of WalletEntry[]
 *   menoid_active_wallet_id    → string (id of currently selected wallet)
 *   menoid_onboarding          → boolean (unchanged, kept for popup boot)
 *
 *   menoid_wallet              → LEGACY (single-wallet blob). We auto-migrate
 *                                into menoid_wallets_v2 on first successful
 *                                unlock (see migrateLegacyIfNeeded).
 *
 * Storage layout (chrome.storage.session — in-memory, cleared on restart):
 *
 *   menoid_session_unlock_v2   → SessionRecord
 *     {
 *       wallets:   StoredWalletWithMeta[]   (decrypted)
 *       activeId:  string
 *       password:  string                   (held so additional wallets can
 *                                            be added/encrypted without re-
 *                                            asking the user)
 *       expiresAt: number
 *     }
 *
 * Why hold the password in session?
 *   - chrome.storage.session is RAM-only, never written to disk, cleared on
 *     browser restart / extension reload.
 *   - Without it, every "Add wallet" click would have to re-prompt for the
 *     password. That breaks the UX requirement.
 *   - Sensitivity is comparable to holding the decrypted privateKeys (which
 *     we already do in the same session record), so this doesn't widen the
 *     blast radius.
 */

import {
  decryptWallet,
  encryptWallet,
  type EncryptedWallet,
  type StoredWallet
} from "../crypto/walletCrypto"

// ── Keys ───────────────────────────────────────────────────────────────────

export const WALLETS_KEY = "menoid_wallets_v2"
export const ACTIVE_WALLET_KEY = "menoid_active_wallet_id"
export const LEGACY_WALLET_KEY = "menoid_wallet"
export const ONBOARDING_KEY = "menoid_onboarding"

// ── Types ──────────────────────────────────────────────────────────────────

export interface WalletEntry {
  /** stable random id */
  id: string
  /** auto-generated display label (e.g. "Wallet 1") */
  label: string
  /** open-identity .meno name (or "" if not registered yet) */
  openName: string
  /** noid-identity .meno name (or "" if not registered yet) */
  noidName: string
  /** true if the open address is in the backend users table */
  openRegistered: boolean
  /** true if the noid keypair is in the backend noidusers table */
  noidRegistered: boolean
  /** encrypted wallet blob */
  encrypted: EncryptedWallet
  createdAt: number
}

export interface StoredWalletWithMeta extends StoredWallet {
  /** id from WalletEntry */
  id: string
  label: string
  openName: string
  noidName: string
  openRegistered: boolean
  noidRegistered: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function newWalletId(): string {
  // crypto.randomUUID is available in service workers + extension contexts.
  if (typeof crypto !== "undefined" && (crypto as any).randomUUID) {
    return (crypto as any).randomUUID()
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function safeJsonParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// ── List / get ─────────────────────────────────────────────────────────────

export async function listWalletEntries(): Promise<WalletEntry[]> {
  const r = await chrome.storage.local.get(WALLETS_KEY)
  return safeJsonParse<WalletEntry[]>(r?.[WALLETS_KEY], [])
}

export async function getActiveWalletId(): Promise<string | null> {
  const r = await chrome.storage.local.get(ACTIVE_WALLET_KEY)
  return (r?.[ACTIVE_WALLET_KEY] as string | undefined) || null
}

export async function setActiveWalletId(id: string): Promise<void> {
  await chrome.storage.local.set({ [ACTIVE_WALLET_KEY]: id })
}

export async function writeWalletEntries(entries: WalletEntry[]): Promise<void> {
  await chrome.storage.local.set({ [WALLETS_KEY]: JSON.stringify(entries) })
}

// ── Add / update / remove ──────────────────────────────────────────────────

export async function appendWalletEntry(entry: WalletEntry): Promise<void> {
  const current = await listWalletEntries()
  current.push(entry)
  await writeWalletEntries(current)
}

export async function updateWalletEntry(
  id: string,
  patch: Partial<WalletEntry>
): Promise<void> {
  const current = await listWalletEntries()
  const idx = current.findIndex((e) => e.id === id)
  if (idx === -1) return
  current[idx] = { ...current[idx], ...patch }
  await writeWalletEntries(current)
}

export async function removeWalletEntry(id: string): Promise<void> {
  const current = await listWalletEntries()
  await writeWalletEntries(current.filter((e) => e.id !== id))
  const active = await getActiveWalletId()
  if (active === id) {
    const remaining = current.filter((e) => e.id !== id)
    if (remaining.length > 0) {
      await setActiveWalletId(remaining[0].id)
    }
  }
}

// ── Decrypt all + active ───────────────────────────────────────────────────

export async function unlockAllWallets(
  password: string
): Promise<{
  wallets: StoredWalletWithMeta[]
  activeId: string
}> {
  await migrateLegacyIfNeeded(password)

  const entries = await listWalletEntries()
  if (entries.length === 0) {
    throw new Error("No wallets found.")
  }

  const decrypted: StoredWalletWithMeta[] = []
  for (const e of entries) {
    // If even one fails, the password is wrong → throw the same error so the
    // LockScreen behaves identically to the single-wallet days.
    const sw = await decryptWallet(e.encrypted, password)
    decrypted.push({
      ...sw,
      id: e.id,
      label: e.label,
      openName: e.openName,
      noidName: e.noidName,
      openRegistered: e.openRegistered,
      noidRegistered: e.noidRegistered
    })
  }

  let active = await getActiveWalletId()
  if (!active || !decrypted.find((d) => d.id === active)) {
    active = decrypted[0].id
    await setActiveWalletId(active)
  }
  return { wallets: decrypted, activeId: active }
}

/**
 * If we still have a legacy single-wallet blob and no v2 entries, fold it
 * into v2 as "Wallet 1". We only do this if the password verifies — that's
 * how we both authenticate the user AND prove we can re-write the blob.
 */
async function migrateLegacyIfNeeded(password: string): Promise<void> {
  const r = await chrome.storage.local.get([WALLETS_KEY, LEGACY_WALLET_KEY])
  const v2Raw = r?.[WALLETS_KEY] as string | undefined
  const legacyRaw = r?.[LEGACY_WALLET_KEY] as string | undefined

  const v2Existing = safeJsonParse<WalletEntry[]>(v2Raw, [])
  if (v2Existing.length > 0) return // already migrated
  if (!legacyRaw) return // nothing to migrate

  let encrypted: EncryptedWallet
  try {
    encrypted = JSON.parse(legacyRaw)
  } catch {
    return
  }
  // verify password
  try {
    await decryptWallet(encrypted, password)
  } catch {
    // Wrong password — let unlockAllWallets throw naturally. We won't migrate
    // until the user gets the password right.
    return
  }

  const entry: WalletEntry = {
    id: newWalletId(),
    label: "Wallet 1",
    openName: "",
    noidName: "",
    openRegistered: false,
    noidRegistered: false,
    encrypted,
    createdAt: Date.now()
  }
  await writeWalletEntries([entry])
  await setActiveWalletId(entry.id)
  // Keep the legacy key around for one more session in case of rollback;
  // remove it now to avoid drift.
  await chrome.storage.local.remove(LEGACY_WALLET_KEY)
}

// ── Encryption helper used by the "Add wallet" flow ───────────────────────

export async function encryptAndAppend(opts: {
  password: string
  storedWallet: StoredWallet
  label: string
  openName: string
  noidName: string
  openRegistered: boolean
  noidRegistered: boolean
}): Promise<WalletEntry> {
  const encrypted = await encryptWallet(opts.storedWallet, opts.password)
  const entry: WalletEntry = {
    id: newWalletId(),
    label: opts.label,
    openName: opts.openName,
    noidName: opts.noidName,
    openRegistered: opts.openRegistered,
    noidRegistered: opts.noidRegistered,
    encrypted,
    createdAt: Date.now()
  }
  await appendWalletEntry(entry)
  return entry
}

// ── Initial wallet (onboarding) ───────────────────────────────────────────

/**
 * Save the very first wallet during onboarding (Create/Import flows).
 * Writes the v2 array (one entry) AND marks onboarding as done.
 */
export async function persistFirstWallet(opts: {
  password: string
  storedWallet: StoredWallet
  openName: string
  noidName: string
  openRegistered: boolean
  noidRegistered: boolean
}): Promise<WalletEntry> {
  const encrypted = await encryptWallet(opts.storedWallet, opts.password)
  const entry: WalletEntry = {
    id: newWalletId(),
    label: "Wallet 1",
    openName: opts.openName,
    noidName: opts.noidName,
    openRegistered: opts.openRegistered,
    noidRegistered: opts.noidRegistered,
    encrypted,
    createdAt: Date.now()
  }
  await writeWalletEntries([entry])
  await setActiveWalletId(entry.id)
  await chrome.storage.local.set({ [ONBOARDING_KEY]: true })
  // Clear any legacy single-wallet blob to avoid drift.
  await chrome.storage.local.remove(LEGACY_WALLET_KEY)
  return entry
}

/** "Wallet 2", "Wallet 3" … based on count of existing entries. */
export async function nextDefaultLabel(): Promise<string> {
  const entries = await listWalletEntries()
  return `Wallet ${entries.length + 1}`
}

/** True if v2 list non-empty or legacy blob still present. */
export async function hasAnyWallet(): Promise<boolean> {
  const r = await chrome.storage.local.get([WALLETS_KEY, LEGACY_WALLET_KEY])
  const v2 = safeJsonParse<WalletEntry[]>(r?.[WALLETS_KEY], [])
  if (v2.length > 0) return true
  return !!r?.[LEGACY_WALLET_KEY]
}