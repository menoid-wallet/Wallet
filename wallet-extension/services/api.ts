/**
 * api.ts
 *
 * Tiny service layer for the PriFi/Menoid backend.
 *
 * BASE_URL is read from Plasmo's process.env (PLASMO_PUBLIC_* is exposed
 * to the browser bundle). Falls back to localhost during dev so you can
 * point at a local server without a .env file. Override in your
 * `.env.development` / `.env.production`:
 *
 *   PLASMO_PUBLIC_API_BASE=https://api.menoid.xyz/api
 *
 * The endpoint shapes match the old PriFi backend you shared:
 *   GET /state/latest   → { spentNullifiers, poolStates, NoidAccountStates }
 *   GET /relayer/get    → { publicKey, zkPublicKey }
 */




export const BASE_URL = process.env.PLASMO_PUBLIC_API_BASE || "http://localhost:4000/api"
  

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

export async function fetchLatestState(): Promise<LatestStateDTO> {
  const res = await fetch(`${BASE_URL}/state/latest`)
  if (!res.ok) throw new Error(`State fetch failed (${res.status})`)
  return res.json()
}

export async function fetchRelayerKeys(): Promise<RelayerKeys> {
  const res = await fetch(`${BASE_URL}/relayer/get`)
  if (!res.ok) throw new Error(`Relayer fetch failed (${res.status})`)
  return res.json()
}