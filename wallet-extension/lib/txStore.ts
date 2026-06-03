/**
 * txStore.ts
 *
 * Persists transaction history to localStorage.
 *
 * Open mode:
 *   key: openaccount:{openAddress}
 *   value: OpenTxEntry[]
 *
 * Noid mode (two-level):
 *   key: noidkey:{noidPublicKey}
 *   value: Record<smartAccountAddress, NoidTxEntry[]>
 *   → one noid identity can have multiple smart accounts
 *
 * Max 50 entries per account (oldest pruned first).
 */

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

export type TxEntry = OpenTxEntry | NoidTxEntry

const MAX_ENTRIES = 50

// ── Open mode ─────────────────────────────────────────────────────────────────

function openKey(address: string): string {
  return `openaccount:${address.toLowerCase()}`
}

function readEntries<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    return JSON.parse(raw) as T[]
  } catch { return [] }
}

function writeEntries<T>(key: string, entries: T[]): void {
  try { localStorage.setItem(key, JSON.stringify(entries)) } catch {}
}

export function saveOpenTx(address: string, tx: OpenTxEntry): void {
  const key = openKey(address)
  const existing = readEntries<OpenTxEntry>(key)
  writeEntries(key, [tx, ...existing].slice(0, MAX_ENTRIES))
}

export function loadOpenTxns(address: string): OpenTxEntry[] {
  return readEntries<OpenTxEntry>(openKey(address))
}

// ── Noid mode (two-level) ─────────────────────────────────────────────────────

function noidKey(noidPublicKey: string): string {
  return `noidkey:${noidPublicKey.toLowerCase()}`
}

/** Read the full map: smartAccountAddress → NoidTxEntry[] */
function readNoidMap(noidPublicKey: string): Record<string, NoidTxEntry[]> {
  try {
    const raw = localStorage.getItem(noidKey(noidPublicKey))
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, NoidTxEntry[]>
  } catch { return {} }
}

function writeNoidMap(noidPublicKey: string, map: Record<string, NoidTxEntry[]>): void {
  try { localStorage.setItem(noidKey(noidPublicKey), JSON.stringify(map)) } catch {}
}

/**
 * Save a noid tx.
 * @param noidPublicKey   – wallet's noid public key (outer key)
 * @param smartAccount    – smart account contract address (inner key)
 * @param tx              – the tx entry to prepend
 */
export function saveNoidTx(
  noidPublicKey: string,
  smartAccount: string,
  tx: NoidTxEntry
): void {
  const map = readNoidMap(noidPublicKey)
  const addr = smartAccount.toLowerCase()
  const existing = map[addr] ?? []
  map[addr] = [tx, ...existing].slice(0, MAX_ENTRIES)
  writeNoidMap(noidPublicKey, map)
}

/**
 * Load all noid txns for a given noid identity, optionally filtered to one smart account.
 * Returns newest first across all accounts (or just the specified one).
 */
export function loadNoidTxns(
  noidPublicKey: string,
  smartAccount?: string
): NoidTxEntry[] {
  const map = readNoidMap(noidPublicKey)
  if (smartAccount) {
    return map[smartAccount.toLowerCase()] ?? []
  }
  // Flatten all accounts, sort newest first
  return Object.values(map)
    .flat()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_ENTRIES)
}