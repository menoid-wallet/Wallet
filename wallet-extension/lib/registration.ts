/**
 * registration.ts
 *
 * Per-wallet, per-chain registration tracking in chrome.storage.local.
 *
 * A wallet is "registered" on a chain once it has submitted register(userCommitment)
 * on that chain. We cache that fact locally (keyed by the REAL wallet address +
 * network) so the noid-mode view can render instantly without hitting the chain
 * every time. The source of truth is still on-chain — the "already registered?"
 * helper re-verifies against the backend and repairs the cache.
 */

import type { NetworkId } from "./networks"
import { NETWORK_IDS } from "./networks"

const STORAGE_KEY = "menoid_registered_chains"

// { [walletAddressLower]: { [network]: true } }
type RegistrationMap = Record<string, Partial<Record<NetworkId, boolean>>>

async function readMap(): Promise<RegistrationMap> {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY)
    return (r?.[STORAGE_KEY] as RegistrationMap) || {}
  } catch {
    return {}
  }
}

async function writeMap(map: RegistrationMap): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: map })
  } catch {
    /* ignore */
  }
}

function keyOf(address: string): string {
  return address.toLowerCase()
}

/** All chains this wallet is locally marked registered on. */
export async function getRegisteredChains(address: string): Promise<NetworkId[]> {
  if (!address) return []
  const map = await readMap()
  const entry = map[keyOf(address)] || {}
  return NETWORK_IDS.filter((n) => entry[n])
}

export async function isChainRegisteredLocally(
  address: string,
  network: NetworkId
): Promise<boolean> {
  if (!address) return false
  const map = await readMap()
  return !!map[keyOf(address)]?.[network]
}

export async function setChainRegistered(
  address: string,
  network: NetworkId,
  registered = true
): Promise<void> {
  if (!address) return
  const map = await readMap()
  const k = keyOf(address)
  if (!map[k]) map[k] = {}
  if (registered) map[k][network] = true
  else delete map[k][network]
  await writeMap(map)
}

/** True when the wallet is registered on at least one chain (local cache). */
export async function hasAnyRegistration(address: string): Promise<boolean> {
  const chains = await getRegisteredChains(address)
  return chains.length > 0
}
