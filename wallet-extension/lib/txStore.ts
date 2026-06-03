/**
 * txStore.ts
 *
 * Persists transaction history to localStorage.
 *
 * ── Open mode ──────────────────────────────────────────────────────────────
 *   key: openaccount:{openAddress}
 *   value: OpenTxEntry[]          ← dapp txns + send txns
 *
 * ── Noid mode (all keyed by noidPublicKey) ─────────────────────────────────
 *   key: noidkey:{noidPublicKey}
 *   value: Record<smartAccountAddress, NoidTxEntry[]>   ← dapp executions
 *
 *   key: noidmask:{noidPublicKey}
 *   value: MaskEntry[]            ← mask (hide) history
 *
 *   key: noidunmask:{noidPublicKey}
 *   value: UnmaskEntry[]          ← unmask (reveal) history
 *
 *   key: noidsend:{noidPublicKey}
 *   value: NoidSendEntry[]        ← private transfers
 *
 * Max 50 entries per store (oldest pruned first).
 */

// ── Entry types ───────────────────────────────────────────────────────────────

export interface OpenTxEntry {
  type: "open"
  txHash: string
  gasUsed: string | null
  to: string | null
  value: string | null        // hex wei
  functionName: string | null
  timestamp: number
}

export interface NoidTxEntry {
  type: "noid"
  txHash: string
  noidSmartAccount: string    // smart account contract address
  gasUsed: string | null
  totalRelayerFee: string | null  // wei string
  estimatedCost: string | null    // wei string
  to: string | null
  value: string | null            // hex wei
  functionName: string | null
  timestamp: number
}

/** Mask: open → shadow */
export interface MaskEntry {
  type: "mask"
  txHash: string
  fromAddress: string         // open address MON was taken from
  noidPublicKey: string       // noid identity that received the note
  amountMon: string           // deposit amount (before fee) as decimal MON string
  feeMon: string              // fee as decimal MON string
  timestamp: number
}

/** Unmask: shadow → open */
export interface UnmaskEntry {
  type: "unmask"
  txHash: string
  toAddress: string           // open address MON was sent to
  noidPublicKey: string       // noid identity notes were spent from
  amountMon: string           // withdrawn amount as decimal MON string
  relayerFeeMon: string       // relayer fee (flat 0.5 MON)
  timestamp: number
}

/** Private noid transfer: shadow → recipient shadow */
export interface NoidSendEntry {
  type: "noid_send"
  txHash: string
  senderNoidPublicKey: string
  receiverNoidPublicKey: string   // recipient's ecPublicKey (noidModePublicKey)
  amountMon: string               // send amount as decimal MON string
  totalRelayerFee: string         // total relayer fee paid as decimal MON string
  timestamp: number
}

export type TxEntry = OpenTxEntry | NoidTxEntry | MaskEntry | UnmaskEntry | NoidSendEntry

// ── Storage helpers ───────────────────────────────────────────────────────────

const MAX = 50

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T[]) : []
  } catch { return [] }
}

function write<T>(key: string, entries: T[]): void {
  try { localStorage.setItem(key, JSON.stringify(entries)) } catch {}
}

export const TX_UPDATE_EVENT = "menoid_tx_updated"

function notifyUpdate() {
  try { window.dispatchEvent(new CustomEvent(TX_UPDATE_EVENT)) } catch {}
}

function prepend<T>(key: string, entry: T): void {
  write(key, [entry, ...read<T>(key)].slice(0, MAX))
  notifyUpdate()
}

// ── Open mode ─────────────────────────────────────────────────────────────────

function openKey(address: string)   { return `openaccount:${address.toLowerCase()}` }

export function saveOpenTx(address: string, tx: OpenTxEntry): void {
  prepend(openKey(address), tx)
}

/** Update an existing open tx entry (matched by txHash) — used to add gasUsed after receipt. */
export function updateOpenTx(address: string, txHash: string, patch: Partial<OpenTxEntry>): void {
  const key = openKey(address)
  const entries = read<OpenTxEntry>(key)
  const idx = entries.findIndex(e => e.txHash === txHash)
  if (idx === -1) return
  entries[idx] = { ...entries[idx], ...patch }
  write(key, entries)
  notifyUpdate()
}

export function loadOpenTxns(address: string): OpenTxEntry[] {
  return read<OpenTxEntry>(openKey(address))
}

// ── Noid dapp executions (two-level) ──────────────────────────────────────────

function noidKey(noidPublicKey: string) { return `noidkey:${noidPublicKey.toLowerCase()}` }

function readNoidMap(noidPublicKey: string): Record<string, NoidTxEntry[]> {
  try {
    const raw = localStorage.getItem(noidKey(noidPublicKey))
    return raw ? (JSON.parse(raw) as Record<string, NoidTxEntry[]>) : {}
  } catch { return {} }
}

export function saveNoidTx(noidPublicKey: string, smartAccount: string, tx: NoidTxEntry): void {
  const map  = readNoidMap(noidPublicKey)
  const addr = smartAccount.toLowerCase()
  map[addr]  = [tx, ...(map[addr] ?? [])].slice(0, MAX)
  try { localStorage.setItem(noidKey(noidPublicKey), JSON.stringify(map)) } catch {}
  notifyUpdate()
}

export function loadNoidTxns(noidPublicKey: string, smartAccount?: string): NoidTxEntry[] {
  const map = readNoidMap(noidPublicKey)
  if (smartAccount) return map[smartAccount.toLowerCase()] ?? []
  return Object.values(map).flat().sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX)
}

// ── Mask ──────────────────────────────────────────────────────────────────────

function maskKey(noidPublicKey: string) { return `noidmask:${noidPublicKey.toLowerCase()}` }

export function saveMaskTx(noidPublicKey: string, entry: MaskEntry): void {
  prepend(maskKey(noidPublicKey), entry)
}

export function loadMaskTxns(noidPublicKey: string): MaskEntry[] {
  return read<MaskEntry>(maskKey(noidPublicKey))
}

// ── Unmask ────────────────────────────────────────────────────────────────────

function unmaskKey(noidPublicKey: string) { return `noidunmask:${noidPublicKey.toLowerCase()}` }

export function saveUnmaskTx(noidPublicKey: string, entry: UnmaskEntry): void {
  prepend(unmaskKey(noidPublicKey), entry)
}

export function loadUnmaskTxns(noidPublicKey: string): UnmaskEntry[] {
  return read<UnmaskEntry>(unmaskKey(noidPublicKey))
}

// ── Noid private send ─────────────────────────────────────────────────────────

function noidSendKey(noidPublicKey: string) { return `noidsend:${noidPublicKey.toLowerCase()}` }

export function saveNoidSendTx(noidPublicKey: string, entry: NoidSendEntry): void {
  prepend(noidSendKey(noidPublicKey), entry)
}

export function loadNoidSendTxns(noidPublicKey: string): NoidSendEntry[] {
  return read<NoidSendEntry>(noidSendKey(noidPublicKey))
}