/**
 * api.ts
 *
 * Service layer for the Menoid backend.
 *
 * BASE_URL is read from the PLASMO_PUBLIC_API_BASE env var.
 * All network-specific routes take a `network` path segment:
 *   monad | sepolia | base_sepolia
 *
 * Updated .env keys:
 *   PLASMO_PUBLIC_API_BASE=http://localhost:4000/api
 */

import type { NetworkId } from "../lib/networks"

export const BASE_URL =
  process.env.PLASMO_PUBLIC_API_BASE || "http://localhost:4000/api"

// ─── DTOs ──────────────────────────────────────────────────────────────────────

export interface PoolStateDTO {
  poolId: string
  commitments: string[]
  encryptedNotes: Record<string, string> | Map<string, string>
  roots: string[]
  latestRoot: string | null
  leafToIndex?: Record<string, number> | Map<string, number>
  lastProcessedBlock: number
}

export interface LatestStateDTO {
  network: NetworkId
  spentNullifiers: string[]
  poolStates: PoolStateDTO[]
  NoidAccountStates: Array<{
    noidAccountAddress: string
    ownerCommitment: string
    encryptedNote: string
  }>
}

export interface RelayerKeys {
  publicKey: string
  zkPublicKey: string
}

// ─── State ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the latest on-chain state for a given network.
 * Route: GET /api/state/:network/latest
 */
export async function fetchLatestState(
  network: NetworkId = "monad"
): Promise<LatestStateDTO> {
  const res = await fetch(`${BASE_URL}/state/${network}/latest`)
  if (!res.ok) throw new Error(`State fetch failed (${res.status}) for ${network}`)
  return res.json()
}

// ─── Relayer ───────────────────────────────────────────────────────────────────

/**
 * Fetch the relayer's public keys (shared across all chains).
 * Route: GET /api/relayer/get
 */
export async function fetchRelayerKeys(network?: string): Promise<RelayerKeys> {
  const url = network ? `${BASE_URL}/relayer/get?network=${network}` : `${BASE_URL}/relayer/get`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Relayer fetch failed (${res.status})`)
  return res.json()
}