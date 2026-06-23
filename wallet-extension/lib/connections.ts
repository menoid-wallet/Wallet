/**
 * connections.ts
 *
 * Persistent storage for dapp connections.
 *
 * A "connection" is one approval granted by the user:
 *   - which wallet entry (by id)
 *   - which mode ("open" | "noid")
 *   - if noid, which smart account commitment
 *   - which host was approved
 *   - what address is exposed to the dapp
 *
 * Stored in chrome.storage.local under CONNECTIONS_KEY as an array.
 */

export const CONNECTIONS_KEY = "menoid_connections"

export interface DappConnection {
  /** Unique id for this connection record */
  id: string
  /** WalletEntry.id of the wallet that approved */
  walletId: string
  /** Display name of the wallet (snapshot at connection time) */
  walletName: string
  /** "open" or "noid" */
  mode: "open" | "noid"
  /** The address exposed to the dapp */
  exposedAddress: string
  /** Origin host of the approved dapp (e.g. "app.uniswap.org") */
  host: string
  /** When the connection was first approved (unix ms) */
  connectedAt: number
}

export async function readConnections(): Promise<DappConnection[]> {
  const r = await chrome.storage.local.get(CONNECTIONS_KEY)
  return (r?.[CONNECTIONS_KEY] as DappConnection[]) ?? []
}

export async function writeConnections(list: DappConnection[]): Promise<void> {
  await chrome.storage.local.set({ [CONNECTIONS_KEY]: list })
}

/**
 * Returns the connection for a given (walletId, host) pair, or null.
 * We allow at most one connection per wallet per host.
 */
export async function getConnection(
  walletId: string,
  host: string
): Promise<DappConnection | null> {
  const list = await readConnections()
  return list.find((c) => c.walletId === walletId && c.host === host) ?? null
}

/**
 * Returns ALL connections for a given host (across wallets).
 */
export async function getConnectionsForHost(
  host: string
): Promise<DappConnection[]> {
  const list = await readConnections()
  return list.filter((c) => c.host === host)
}

/**
 * Upserts a connection (replaces by walletId+host).
 */
export async function upsertConnection(conn: DappConnection): Promise<void> {
  const list = await readConnections()
  const idx = list.findIndex(
    (c) => c.walletId === conn.walletId && c.host === conn.host
  )
  if (idx >= 0) {
    list[idx] = conn
  } else {
    list.push(conn)
  }
  await writeConnections(list)
}

/**
 * Removes a connection by id.
 */
export async function removeConnection(id: string): Promise<void> {
  const list = await readConnections()
  await writeConnections(list.filter((c) => c.id !== id))
}

/**
 * Removes all connections for a given host.
 */
export async function removeConnectionsForHost(host: string): Promise<void> {
  const list = await readConnections()
  await writeConnections(list.filter((c) => c.host !== host))
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function makeConnection(opts: {
  walletId: string
  walletName: string
  mode: "open" | "noid"
  exposedAddress: string
  host: string
}): DappConnection {
  return {
    id: makeId(),
    connectedAt: Date.now(),
    ...opts,
  }
}