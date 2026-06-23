/**
 * PoolContext.tsx
 *
 * Owns the private-balance state for the Noid wallet, now per-network.
 *
 * On every 10s poll (or forced sync):
 *   1. GET /state/:network/latest from the backend.
 *   2. Extend the per-pool Merkle trees with new commitments (delta only).
 *   3. Try to ECIES-decrypt each new encryptedNote; matches → UTXOs.
 *   4. Derive nullifiers; mark UTXOs as spent if found in spentNullifiers.
 *   5. Sum unspent UTXOs → formattedBalance.
 *
 * When `activeNetwork` changes in WalletContext:
 *   - Trees, UTXOs, and pool state are reset for the new chain.
 *   - A fresh sync starts immediately.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from "react"
import { ethers } from "ethers"
import { buildPoseidon } from "circomlibjs"
import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree"
import { decryptMessage } from "../lib/crypto"
import { fetchLatestState, type LatestStateDTO } from "../services/api"
import { useWallet } from "./WalletContext"
import { NETWORKS, type NetworkId } from "../lib/networks"

const POLL_INTERVAL_MS = 10_000
const TREE_DEPTH = 20
const TREE_ARITY = 2

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface UTXO {
  commitment: string
  amount: string        // wei, as decimal string
  randomness: string
  leafIndex: number
  nullifier: string
  spent: boolean
  poolId: string
}

interface PoolContextValue {
  spentNullifiers: string[]
  poolStates: LatestStateDTO["poolStates"]
  myUTXOs: Record<string, UTXO[]>
  allUnspentUTXOs: UTXO[]
  formattedBalance: string
  totalBalanceWei: bigint
  syncing: boolean
  lastSyncedAt: number | null
  error: string | null
  forceSync: () => Promise<void>
  getRoot: (poolId: string) => string | null
  getMerkleProof: (poolId: string, leafIndex: number) => unknown | null

  // Multi-network exposes
  allBalances: Record<NetworkId, string>
  allUTXOs: Record<NetworkId, UTXO[]>
  syncingStates: Record<NetworkId, boolean>
  errors: Record<NetworkId, string | null>
}

const PoolContext = createContext<PoolContextValue | null>(null)

// ─── Poseidon singleton ────────────────────────────────────────────────────────

let _poseidon: any = null
async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon()
  return _poseidon
}

function makeHashFn(poseidon: any) {
  return (inputs: bigint[]) => BigInt(poseidon.F.toString(poseidon(inputs)))
}

function buildFreshTree(poseidon: any) {
  return new IncrementalMerkleTree(makeHashFn(poseidon), TREE_DEPTH, BigInt(0), TREE_ARITY)
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function tryDecryptNote(
  encryptedHex: string,
  privateKey: string,
  networkId: string
): { amount: string; randomness: string } | null {
  try {
    const plaintext = decryptMessage(encryptedHex, privateKey, networkId)
    return JSON.parse(plaintext)
  } catch {
    return null
  }
}

function getDecimals(networkId: string): number {
  if (networkId === "solana" || networkId === "sui") return 9
  if (networkId === "aptos") return 8
  return 18
}

function formatBalanceWei(wei: bigint, networkId: string = "monad"): string {
  if (wei === 0n) return "0.0000"
  const decimals = getDecimals(networkId)
  const formatted = ethers.formatUnits(wei, decimals)
  const asNum = Number(formatted)
  if (!Number.isFinite(asNum) || asNum === 0) return "0.0000"
  if (asNum < 0.0001) return asNum.toFixed(6)
  return asNum.toFixed(4)
}

function toBytes32(v: string | bigint): string {
  return "0x" + BigInt(v).toString(16).padStart(64, "0")
}

// ─── Provider ──────────────────────────────────────────────────────────────────

export function PoolProvider({ children }: { children: React.ReactNode }) {
  const {
    wallet,
    activeNetwork,
  } = useWallet()

  const walletSessionId = wallet?.noidAccount?.address ?? null

  // raw server states per network
  const [spentNullifiersMap, setSpentNullifiersMap] = useState<Record<NetworkId, string[]>>({
    monad: [], sepolia: [], base_sepolia: [], solana: [], sui: [], aptos: []
  })
  const [poolStatesMap, setPoolStatesMap] = useState<Record<NetworkId, LatestStateDTO["poolStates"]>>({
    monad: [], sepolia: [], base_sepolia: [], solana: [], sui: [], aptos: []
  })

  // merkle trees + insert cursors (refs — qualified by `${networkId}_${poolId}`)
  const treeMapRef = useRef<Record<string, IncrementalMerkleTree>>({})
  const insertedCountRef = useRef<Record<string, number>>({})

  // UTXOs state and ref per network
  const [allUTXOs, setAllUTXOs] = useState<Record<NetworkId, UTXO[]>>({
    monad: [], sepolia: [], base_sepolia: [], solana: [], sui: [], aptos: []
  })
  const [allBalances, setAllBalances] = useState<Record<NetworkId, string>>({
    monad: "0.0000", sepolia: "0.0000", base_sepolia: "0.0000", solana: "0.0000", sui: "0.0000", aptos: "0.0000"
  })
  const [syncingStates, setSyncingStates] = useState<Record<NetworkId, boolean>>({
    monad: false, sepolia: false, base_sepolia: false, solana: false, sui: false, aptos: false
  })
  const [errors, setErrors] = useState<Record<NetworkId, string | null>>({
    monad: null, sepolia: null, base_sepolia: null, solana: null, sui: null, aptos: null
  })
  const [lastSyncedAtStates, setLastSyncedAtStates] = useState<Record<NetworkId, number | null>>({
    monad: null, sepolia: null, base_sepolia: null, solana: null, sui: null, aptos: null
  })

  const poseidonRef  = useRef<any>(null)
  const myUTXOsRef   = useRef<Record<NetworkId, Record<string, UTXO[]>>>({
    monad: {}, sepolia: {}, base_sepolia: {}, solana: {}, sui: {}, aptos: {}
  })

  // Bootstrap poseidon once
  useEffect(() => {
    let cancelled = false
    getPoseidon().then((p) => { if (!cancelled) poseidonRef.current = p })
    return () => { cancelled = true }
  }, [])

  // Helper to robustly check if a nullifier is in the spentNullifiers list
  const isNullifierSpent = useCallback((nullifierStr: string, spentList: string[]): boolean => {
    if (!nullifierStr) return false
    if (spentList.includes(nullifierStr)) return true
    try {
      const val = BigInt(nullifierStr)
      if (spentList.includes(val.toString())) return true
      const hex = ethers.zeroPadValue(ethers.toBeHex(val), 32)
      if (spentList.includes(hex)) return true
      if (spentList.includes(hex.toLowerCase())) return true
    } catch {}
    return false
  }, [])

  // ── Process one server snapshot ────────────────────────────────────────────

  const processState = useCallback(
    async (networkId: NetworkId, data: LatestStateDTO) => {
      const poseidon = poseidonRef.current
      if (!poseidon) return
      
      const keys = (() => {
        if (networkId === "solana") return wallet?.solanaNoidAccount
        if (networkId === "sui") return wallet?.suiNoidAccount
        if (networkId === "aptos") return wallet?.aptosNoidAccount
        return wallet?.noidAccount
      })()
      if (!keys?.privateKey || !keys?.zkSecretKey) return

      setSpentNullifiersMap(prev => ({ ...prev, [networkId]: data.spentNullifiers || [] }))
      const pools = data.poolStates || []
      setPoolStatesMap(prev => ({ ...prev, [networkId]: pools }))

      const updatedUTXOs: Record<string, UTXO[]> = {}

      for (const pool of pools) {
        const pid = pool.poolId
        const commitments = pool.commitments || []
        const encryptedNotes =
          pool.encryptedNotes instanceof Map
            ? Object.fromEntries(pool.encryptedNotes as Map<string, string>)
            : ((pool.encryptedNotes as Record<string, string>) || {})

        const treeKey = `${networkId}_${pid}`
        if (!treeMapRef.current[treeKey]) {
          treeMapRef.current[treeKey] = buildFreshTree(poseidon)
          insertedCountRef.current[treeKey] = 0
        }
        const tree = treeMapRef.current[treeKey]
        const alreadyInserted = insertedCountRef.current[treeKey] ?? 0
        const newCommitments = commitments.slice(alreadyInserted)
        for (const cmx of newCommitments) {
          tree.insert(BigInt(cmx))
        }
        insertedCountRef.current[treeKey] = commitments.length

        const existing = myUTXOsRef.current[networkId]?.[pid] || []
        const existingByCm: Record<string, UTXO> = Object.fromEntries(
          existing.map((u) => [u.commitment, u])
        )

        const out: UTXO[] = []
        for (let i = 0; i < commitments.length; i++) {
          const cmx = commitments[i]

          if (existingByCm[cmx]) {
            out.push({
              ...existingByCm[cmx],
              spent: isNullifierSpent(existingByCm[cmx].nullifier, data.spentNullifiers || []),
            })
            continue
          }

          const encryptedHex = encryptedNotes[cmx]
          if (!encryptedHex) continue

          const decrypted = tryDecryptNote(encryptedHex, keys.privateKey, networkId)
          if (!decrypted) continue

          const leafIndex =
            pool.leafToIndex && pool.leafToIndex instanceof Map
              ? (pool.leafToIndex as Map<string, number>).get(cmx) ?? i
              : (pool.leafToIndex as Record<string, number> | undefined)?.[cmx] ?? i

          const nullifierBig = BigInt(
            poseidon.F.toString(
              poseidon([2n, BigInt(cmx), BigInt(decrypted.randomness), BigInt(keys.zkSecretKey)])
            )
          )
          const nullifier = ethers.zeroPadValue(ethers.toBeHex(nullifierBig), 32)

          out.push({
            commitment: cmx,
            amount: decrypted.amount,
            randomness: decrypted.randomness,
            leafIndex,
            nullifier,
            spent: isNullifierSpent(nullifier, data.spentNullifiers || []),
            poolId: pid,
          })
        }
        updatedUTXOs[pid] = out
      }

      myUTXOsRef.current[networkId] = updatedUTXOs
      
      const unspent = Object.values(updatedUTXOs).flat().filter((u) => !u.spent)
      const totalWei = unspent.reduce((s, u) => s + BigInt(u.amount), 0n)
      const formatted = formatBalanceWei(totalWei, networkId)

      setAllUTXOs(prev => ({ ...prev, [networkId]: unspent }))
      setAllBalances(prev => ({ ...prev, [networkId]: formatted }))
      setLastSyncedAtStates(prev => ({ ...prev, [networkId]: Date.now() }))
    },
    [wallet, isNullifierSpent]
  )

  // ── Fetch + dispatch ─────────────────────────────────────────────────────────

  const fetchNetworkLatest = useCallback(async (netId: NetworkId) => {
    const keys = (() => {
      if (netId === "solana") return wallet?.solanaNoidAccount
      if (netId === "sui") return wallet?.suiNoidAccount
      if (netId === "aptos") return wallet?.aptosNoidAccount
      return wallet?.noidAccount
    })()
    if (!keys?.privateKey) return

    setSyncingStates(prev => ({ ...prev, [netId]: true }))
    setErrors(prev => ({ ...prev, [netId]: null }))

    try {
      const data = await fetchLatestState(netId)
      await processState(netId, data)
    } catch (e: any) {
      console.error(`[PoolContext] Sync failed for ${netId}:`, e)
      setErrors(prev => ({ ...prev, [netId]: e?.message ?? "Sync failed" }))
    } finally {
      setSyncingStates(prev => ({ ...prev, [netId]: false }))
    }
  }, [wallet, processState])

  const fetchLatestAll = useCallback(async () => {
    const networks = Object.keys(NETWORKS) as NetworkId[]
    await Promise.all(networks.map(n => fetchNetworkLatest(n)))
  }, [fetchNetworkLatest])

  const forceSync = fetchLatestAll

  // ── Reset when wallet changes ─────────────────────────────────────

  useEffect(() => {
    treeMapRef.current = {}
    insertedCountRef.current = {}
    myUTXOsRef.current = {
      monad: {}, sepolia: {}, base_sepolia: {}, solana: {}, sui: {}, aptos: {}
    }
    setAllBalances({
      monad: "0.0000", sepolia: "0.0000", base_sepolia: "0.0000", solana: "0.0000", sui: "0.0000", aptos: "0.0000"
    })
    setAllUTXOs({
      monad: [], sepolia: [], base_sepolia: [], solana: [], sui: [], aptos: []
    })
    setErrors({
      monad: null, sepolia: null, base_sepolia: null, solana: null, sui: null, aptos: null
    })
    setLastSyncedAtStates({
      monad: null, sepolia: null, base_sepolia: null, solana: null, sui: null, aptos: null
    })

    if (walletSessionId) void fetchLatestAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletSessionId])

  // ── Poll loop ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!walletSessionId) return
    const id = setInterval(() => {
      if (!document.hidden) void fetchLatestAll()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [walletSessionId, fetchLatestAll])

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const getRoot = useCallback((poolId: string) => {
    const treeKey = `${activeNetwork}_${poolId}`
    const tree = treeMapRef.current[treeKey]
    return tree ? tree.root.toString() : null
  }, [activeNetwork])

  const getMerkleProof = useCallback((poolId: string, leafIndex: number) => {
    const treeKey = `${activeNetwork}_${poolId}`
    const tree = treeMapRef.current[treeKey]
    if (!tree) return null
    try {
      return tree.createProof(leafIndex)
    } catch {
      return null
    }
  }, [activeNetwork])

  const spentNullifiers = spentNullifiersMap[activeNetwork] || []
  const poolStates = poolStatesMap[activeNetwork] || []
  const myUTXOs = myUTXOsRef.current[activeNetwork] || {}
  const allUnspentUTXOs = allUTXOs[activeNetwork] || []
  const formattedBalance = allBalances[activeNetwork] || "0.0000"
  const totalBalanceWei = allUnspentUTXOs.reduce((s, u) => s + BigInt(u.amount), 0n)
  const syncing = syncingStates[activeNetwork] || false
  const error = errors[activeNetwork] || null
  const lastSyncedAt = lastSyncedAtStates[activeNetwork] || null

  const value: PoolContextValue = {
    spentNullifiers,
    poolStates,
    myUTXOs,
    allUnspentUTXOs,
    formattedBalance,
    totalBalanceWei,
    syncing,
    lastSyncedAt,
    error,
    forceSync,
    getRoot,
    getMerkleProof,
    allBalances,
    allUTXOs,
    syncingStates,
    errors,
  }

  return <PoolContext.Provider value={value}>{children}</PoolContext.Provider>
}

export function usePool() {
  const ctx = useContext(PoolContext)
  if (!ctx) throw new Error("usePool must be used within PoolProvider")
  return ctx
}