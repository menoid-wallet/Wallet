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

export interface NoidSmartAccount {
  commitment: string
  randomness: string
  zkPublicKey: string
  account: string
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
  myNoidSmartAccounts: NoidSmartAccount[]
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
  privateKey: string
): { amount: string; randomness: string } | null {
  try {
    const plaintext = decryptMessage(encryptedHex, privateKey)
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
    setSelectedNoidAccount,
    selectedNoidAccount,
    pendingNoidAccount,
    setPendingNoidAccount,
    activeNetwork,
  } = useWallet()

  const noidAddress    = wallet?.noidAccount?.address    ?? null
  const noidPrivateKey = wallet?.noidAccount?.privateKey ?? null
  const noidZkSecret   = wallet?.noidAccount?.zkSecretKey  ?? null
  const noidZkPublicKey = wallet?.noidAccount?.zkPublicKey  ?? null

  // raw server state
  const [spentNullifiers, setSpentNullifiers] = useState<string[]>([])
  const [poolStates, setPoolStates] = useState<LatestStateDTO["poolStates"]>([])

  // merkle trees + insert cursors (refs — no re-renders on tree insert)
  const treeMapRef = useRef<Record<string, IncrementalMerkleTree>>({})
  const insertedCountRef = useRef<Record<string, number>>({})

  const [myUTXOs, setMyUTXOs] = useState<Record<string, UTXO[]>>({})
  const [myNoidSmartAccounts, setMyNoidSmartAccounts] = useState<NoidSmartAccount[]>([])

  const [syncing, setSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const poseidonRef  = useRef<any>(null)
  const myUTXOsRef   = useRef<Record<string, UTXO[]>>({})
  useEffect(() => { myUTXOsRef.current = myUTXOs }, [myUTXOs])

  // Bootstrap poseidon once
  useEffect(() => {
    let cancelled = false
    getPoseidon().then((p) => { if (!cancelled) poseidonRef.current = p })
    return () => { cancelled = true }
  }, [])

  // ── Process one server snapshot ────────────────────────────────────────────

  const processState = useCallback(
    async (data: LatestStateDTO) => {
      const poseidon = poseidonRef.current
      if (!poseidon) return
      if (!noidPrivateKey || !noidZkSecret) return

      setSpentNullifiers(data.spentNullifiers || [])
      const pools = data.poolStates || []
      setPoolStates(pools)

      // ── Decrypt Noid Smart Accounts ──────────────────────────────────────────
      const isEVM = ["monad", "sepolia", "base_sepolia"].includes(activeNetwork)
      const noidAccountStates = data.NoidAccountStates || []
      if (isEVM && noidAccountStates.length > 0 && noidZkPublicKey) {
        const decryptedAccounts: NoidSmartAccount[] = []
        for (const entry of noidAccountStates) {
          try {
            const plaintext = decryptMessage(entry.encryptedNote, noidPrivateKey)
            const parsed: { randomness: string } = JSON.parse(plaintext)

            const computedCmx: string = poseidon.F.toString(
              poseidon([4n, BigInt(noidZkPublicKey), BigInt(parsed.randomness)])
            )
            const computedCmxHex = toBytes32(computedCmx)
            if (computedCmxHex !== entry.ownerCommitment) continue

            decryptedAccounts.push({
              commitment: entry.ownerCommitment,
              randomness: parsed.randomness,
              zkPublicKey: noidZkPublicKey,
              account: entry.noidAccountAddress,
            })
          } catch {
            // not ours or corrupt — skip
          }
        }
        setMyNoidSmartAccounts(decryptedAccounts)
      } else {
        setMyNoidSmartAccounts([])
      }

      const updatedUTXOs: Record<string, UTXO[]> = {}

      for (const pool of pools) {
        const pid = pool.poolId
        const commitments = pool.commitments || []
        const encryptedNotes =
          pool.encryptedNotes instanceof Map
            ? Object.fromEntries(pool.encryptedNotes as Map<string, string>)
            : ((pool.encryptedNotes as Record<string, string>) || {})

        if (!treeMapRef.current[pid]) {
          treeMapRef.current[pid] = buildFreshTree(poseidon)
          insertedCountRef.current[pid] = 0
        }
        const tree = treeMapRef.current[pid]
        const alreadyInserted = insertedCountRef.current[pid] ?? 0
        const newCommitments = commitments.slice(alreadyInserted)
        for (const cmx of newCommitments) {
          tree.insert(BigInt(cmx))
        }
        insertedCountRef.current[pid] = commitments.length

        const existing = myUTXOsRef.current[pid] || []
        const existingByCm: Record<string, UTXO> = Object.fromEntries(
          existing.map((u) => [u.commitment, u])
        )

        const out: UTXO[] = []
        for (let i = 0; i < commitments.length; i++) {
          const cmx = commitments[i]

          if (existingByCm[cmx]) {
            out.push({
              ...existingByCm[cmx],
              spent: data.spentNullifiers.includes(existingByCm[cmx].nullifier),
            })
            continue
          }

          const encryptedHex = encryptedNotes[cmx]
          if (!encryptedHex) continue

          const decrypted = tryDecryptNote(encryptedHex, noidPrivateKey)
          if (!decrypted) continue

          const leafIndex =
            pool.leafToIndex && pool.leafToIndex instanceof Map
              ? (pool.leafToIndex as Map<string, number>).get(cmx) ?? i
              : (pool.leafToIndex as Record<string, number> | undefined)?.[cmx] ?? i

          const nullifierBig = BigInt(
            poseidon.F.toString(
              poseidon([2n, BigInt(cmx), BigInt(decrypted.randomness), BigInt(noidZkSecret)])
            )
          )
          const nullifier = ethers.zeroPadValue(ethers.toBeHex(nullifierBig), 32)

          out.push({
            commitment: cmx,
            amount: decrypted.amount,
            randomness: decrypted.randomness,
            leafIndex,
            nullifier,
            spent: data.spentNullifiers.includes(nullifier),
            poolId: pid,
          })
        }
        updatedUTXOs[pid] = out
      }

      setMyUTXOs(updatedUTXOs)
      setLastSyncedAt(Date.now())
    },
    [noidPrivateKey, noidZkSecret, noidZkPublicKey]
  )

  // ── Fetch + dispatch ─────────────────────────────────────────────────────────

  const fetchLatest = useCallback(async () => {
    if (!noidPrivateKey) return
    setSyncing(true)
    setError(null)
    try {
      const data = await fetchLatestState(activeNetwork)
      await processState(data)
    } catch (e: any) {
      setError(e?.message ?? "Sync failed")
    } finally {
      setSyncing(false)
    }
  }, [noidPrivateKey, activeNetwork, processState])

  const forceSync = fetchLatest

  // ── Reset when wallet OR network changes ─────────────────────────────────────

  useEffect(() => {
    treeMapRef.current = {}
    insertedCountRef.current = {}
    myUTXOsRef.current = {}
    setMyUTXOs({})
    setMyNoidSmartAccounts([])
    setSpentNullifiers([])
    setPoolStates([])
    setLastSyncedAt(null)
    setError(null)
    // Clear the selected account immediately so the UI doesn't show a stale
    // account from the previous network while the new sync is in flight.
    setSelectedNoidAccount(null)
    if (noidAddress) void fetchLatest()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noidAddress, activeNetwork])

  // ── Poll loop ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!noidAddress) return
    const id = setInterval(() => {
      if (!document.hidden) void fetchLatest()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [noidAddress, fetchLatest])

  // ── Pending account lifecycle + smart auto-select ─────────────────────────────

  const pendingNoidAccountRef  = useRef<NoidSmartAccount | null>(null)
  const selectedNoidAccountRef = useRef<NoidSmartAccount | null>(null)
  useEffect(() => { pendingNoidAccountRef.current  = pendingNoidAccount },  [pendingNoidAccount])
  useEffect(() => { selectedNoidAccountRef.current = selectedNoidAccount }, [selectedNoidAccount])

  useEffect(() => {
    if (myNoidSmartAccounts.length === 0) return

    const pending  = pendingNoidAccountRef.current
    const selected = selectedNoidAccountRef.current

    if (pending) {
      const confirmed = myNoidSmartAccounts.find(
        (a) => a.commitment === pending.commitment
      )
      if (confirmed) {
        setPendingNoidAccount(null)
        setSelectedNoidAccount(confirmed)
        return
      }
    }

    if (!selected) {
      setSelectedNoidAccount(myNoidSmartAccounts[0])
    } else {
      const stillExists = myNoidSmartAccounts.some(
        (a) => a.commitment === selected.commitment
      )
      const isPending = pending?.commitment === selected.commitment
      if (!stillExists && !isPending) {
        setSelectedNoidAccount(myNoidSmartAccounts[0])
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myNoidSmartAccounts])

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const getRoot = useCallback((poolId: string) => {
    const tree = treeMapRef.current[poolId]
    return tree ? tree.root.toString() : null
  }, [])

  const getMerkleProof = useCallback((poolId: string, leafIndex: number) => {
    const tree = treeMapRef.current[poolId]
    if (!tree) return null
    try {
      return tree.createProof(leafIndex)
    } catch {
      return null
    }
  }, [])

  const allUnspentUTXOs = Object.values(myUTXOs).flat().filter((u) => !u.spent)
  const totalBalanceWei = allUnspentUTXOs.reduce((s, u) => s + BigInt(u.amount), 0n)
  const formattedBalance = formatBalanceWei(totalBalanceWei, activeNetwork)

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
    myNoidSmartAccounts,
  }

  return <PoolContext.Provider value={value}>{children}</PoolContext.Provider>
}

export function usePool() {
  const ctx = useContext(PoolContext)
  if (!ctx) throw new Error("usePool must be used within PoolProvider")
  return ctx
}