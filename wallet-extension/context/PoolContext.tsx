/**
 * PoolContext.tsx
 *
 * Owns the private-balance state for the Noid wallet.
 *
 * What it does on a loop (every 10s while a wallet is unlocked):
 *   1. GET /state/latest from the backend.
 *   2. For each pool, lazily build/extend an incremental Merkle tree of
 *      its commitments — we only insert the DELTA since the last sync so
 *      large pools stay cheap.
 *   3. For every commitment we haven't seen before, try to ECIES-decrypt
 *      the matching encryptedNote with the user's noidAccount.privateKey.
 *      If it succeeds, it's ours → we have { amount, randomness } and can
 *      derive a nullifier with Poseidon([2, commitment, randomness, sk]).
 *   4. Mark each UTXO as spent if its nullifier appears in the global
 *      spentNullifiers list.
 *   5. Sum unspent UTXO amounts → formattedBalance in MON.
 *
 * What it exposes:
 *   - myUTXOs:           { [poolId]: UTXO[] }
 *   - allUnspentUTXOs:   UTXO[]  (flattened, unspent only)
 *   - formattedBalance:  "0.0000" style string ready for AnimatedNumber
 *   - syncing / lastSyncedAt / error: status for the UI
 *   - getRoot(poolId) / getMerkleProof(poolId, leafIndex): used by the
 *     withdraw / mask circuits later
 *   - forceSync(): trigger an immediate poll (called by the mask modal
 *     after a successful tx so the new commitment lands quickly)
 *
 * Why a ref-stored tree?
 *   IncrementalMerkleTree mutates on insert; we don't want to put it in
 *   useState (no structural sharing, and we don't need a re-render on
 *   every insert). The ref keeps it stable across renders and we trigger
 *   re-renders explicitly via setMyUTXOs / setLastSyncedAt.
 *
 * Why no MetaMask?
 *   The original PriFi dapp derived keys from a signature each session.
 *   We already have permanent keys in WalletContext (noidAccount), so the
 *   poller can start the moment the wallet is unlocked and stop the
 *   moment it locks — no signature popup needed.
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

// ─── Types ─────────────────────────────────────────────────────────────────
export interface UTXO {
  commitment: string
  amount: string // wei, as decimal string
  randomness: string
  leafIndex: number
  nullifier: string
  spent: boolean
  poolId: string
}

/** A successfully-decrypted Noid Smart Account belonging to this wallet */
export interface NoidSmartAccount {
  /** The commitment (cmx) — decimal bigint string */
  commitment: string
  /** Randomness extracted from the decrypted note */
  randomness: string
  /** The wallet's zkPublicKey used to compute this commitment */
  zkPublicKey: string
  /** The on-chain address of the smart account contract */
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
  /** All Noid Smart Accounts that could be decrypted by this wallet */
  myNoidSmartAccounts: NoidSmartAccount[]
}

const PoolContext = createContext<PoolContextValue | null>(null)

// ─── Poseidon singleton ────────────────────────────────────────────────────
let _poseidon: any = null
async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon()
  return _poseidon
}

function makeHashFn(poseidon: any) {
  return (inputs: bigint[]) =>
    BigInt(poseidon.F.toString(poseidon(inputs)))
}

function buildFreshTree(poseidon: any) {
  return new IncrementalMerkleTree(
    makeHashFn(poseidon),
    TREE_DEPTH,
    BigInt(0),
    TREE_ARITY
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────
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

// Format wei → "0.0000"-style MON string with stable digit count for the
// AnimatedNumber odometer. Mirrors OpenModeView.formatBalance.
function formatBalanceWei(wei: bigint): string {
  if (wei === 0n) return "0.0000"
  const asNum = Number(ethers.formatEther(wei))
  if (!Number.isFinite(asNum) || asNum === 0) return "0.0000"
  if (asNum < 0.0001) return asNum.toFixed(6)
  return asNum.toFixed(4)
}

// ─── Provider ──────────────────────────────────────────────────────────────
export function PoolProvider({ children }: { children: React.ReactNode }) {
  const { wallet, setSelectedNoidAccount, selectedNoidAccount, pendingNoidAccount, setPendingNoidAccount } = useWallet()
  const noidAddress = wallet?.noidAccount?.address ?? null
  const noidPrivateKey = wallet?.noidAccount?.privateKey ?? null
  const noidZkSecret = wallet?.noidAccount?.zkSecretKey ?? null
  const noidZkPublicKey = wallet?.noidAccount?.zkPublicKey ?? null

  // raw server state
  const [spentNullifiers, setSpentNullifiers] = useState<string[]>([])
  const [poolStates, setPoolStates] = useState<LatestStateDTO["poolStates"]>([])

  // merkle trees + insert cursors (refs — we don't want re-renders on insert)
  const treeMapRef = useRef<Record<string, IncrementalMerkleTree>>({})
  const insertedCountRef = useRef<Record<string, number>>({})

  // decrypted UTXOs keyed by poolId
  const [myUTXOs, setMyUTXOs] = useState<Record<string, UTXO[]>>({})

  // decrypted Noid Smart Accounts
  const [myNoidSmartAccounts, setMyNoidSmartAccounts] = useState<NoidSmartAccount[]>([])

  // status
  const [syncing, setSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // poseidon singleton + a ref so the latest myUTXOs is visible inside
  // processState without putting it in the dep list (which would loop)
  const poseidonRef = useRef<any>(null)
  const myUTXOsRef = useRef<Record<string, UTXO[]>>({})
  useEffect(() => {
    myUTXOsRef.current = myUTXOs
  }, [myUTXOs])

  // Bootstrap poseidon once
  useEffect(() => {
    let cancelled = false
    getPoseidon().then((p) => {
      if (!cancelled) poseidonRef.current = p
    })
    return () => {
      cancelled = true
    }
  }, [])

  function toBytes32(v: string | bigint) {
  return (
    "0x" +
    BigInt(v)
      .toString(16)
      .padStart(64, "0")
  )
}

  // ── Process one server snapshot ──────────────────────────────────────────
  const processState = useCallback(
    async (data: LatestStateDTO) => {
      const poseidon = poseidonRef.current
      if (!poseidon) return
      if (!noidPrivateKey || !noidZkSecret) return

      setSpentNullifiers(data.spentNullifiers || [])
      const pools = data.poolStates || []
      setPoolStates(pools)

      // ── Decrypt Noid Smart Accounts ──────────────────────────────────────
      const noidAccountStates = data.NoidAccountStates || []
      if (noidAccountStates.length > 0 && noidZkPublicKey) {
        const decryptedAccounts: NoidSmartAccount[] = []
        for (const entry of noidAccountStates) {
          try {
            const plaintext = decryptMessage(entry.encryptedNote, noidPrivateKey)
            const parsed: { randomness: string } = JSON.parse(plaintext)

            // Verify: poseidon([4, zkPublicKey, randomness]) must equal ownerCommitment
            const computedCmx: string = poseidon.F.toString(
              poseidon([
                4n,
                BigInt(noidZkPublicKey),
                BigInt(parsed.randomness)
              ])
            )

            const computedCmxHex = toBytes32(computedCmx)
            if (computedCmxHex !== entry.ownerCommitment) continue

            decryptedAccounts.push({
              commitment: entry.ownerCommitment ?? "",
              randomness: parsed.randomness ?? "",
              zkPublicKey: noidZkPublicKey,
              account: entry.noidAccountAddress ?? ""
            })
          } catch {
            // not ours or corrupt — skip
          }
        }
        setMyNoidSmartAccounts(decryptedAccounts)
      }

      const updatedUTXOs: Record<string, UTXO[]> = {}

      for (const pool of pools) {
        const pid = pool.poolId
        const commitments = pool.commitments || []
        // encryptedNotes may arrive as a Map (rare via JSON) or a plain object
        const encryptedNotes =
          pool.encryptedNotes instanceof Map
            ? Object.fromEntries(pool.encryptedNotes as Map<string, string>)
            : ((pool.encryptedNotes as Record<string, string>) || {})

        // ensure a tree exists, then extend with only the delta
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

        // carry already-decrypted UTXOs forward (we only need to re-check
        // their spent status)
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
              spent: data.spentNullifiers.includes(
                existingByCm[cmx].nullifier
              )
            })
            continue
          }

          const encryptedHex = encryptedNotes[cmx]
          if (!encryptedHex) continue

          const decrypted = tryDecryptNote(encryptedHex, noidPrivateKey)
          if (!decrypted) continue // not ours

          // leafIndex comes from server map; fall back to position
          const leafIndex =
            pool.leafToIndex && pool.leafToIndex instanceof Map
              ? (pool.leafToIndex as Map<string, number>).get(cmx) ?? i
              : (pool.leafToIndex as Record<string, number> | undefined)?.[cmx] ?? i

          // nullifier = Poseidon([2, commitment, randomness, zkSecretKey])
          const nullifierBig = BigInt(
            poseidon.F.toString(
              poseidon([
                2n,
                BigInt(cmx),
                BigInt(decrypted.randomness),
                BigInt(noidZkSecret)
              ])
            )
          )
          const nullifier = ethers.zeroPadValue(
            ethers.toBeHex(nullifierBig),
            32
          )

          out.push({
            commitment: cmx,
            amount: decrypted.amount,
            randomness: decrypted.randomness,
            leafIndex,
            nullifier,
            spent: data.spentNullifiers.includes(nullifier),
            poolId: pid
          })
        }
        updatedUTXOs[pid] = out
      }

      setMyUTXOs(updatedUTXOs)
      setLastSyncedAt(Date.now())
    },
    [noidPrivateKey, noidZkSecret, noidZkPublicKey]
  )

  // ── Fetch + dispatch ────────────────────────────────────────────────────
  const fetchLatest = useCallback(async () => {
    if (!noidPrivateKey) return
    setSyncing(true)
    setError(null)
    try {
      const data = await fetchLatestState()
      await processState(data)
    } catch (e: any) {
      setError(e?.message ?? "Sync failed")
    } finally {
      setSyncing(false)
    }
  }, [noidPrivateKey, processState])

  // expose as forceSync (intuitive name for the mask modal)
  const forceSync = fetchLatest

  // ── Reset everything when wallet changes (login/lock/import) ────────────
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
    if (noidAddress) void fetchLatest()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noidAddress])

  // ── Poll loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!noidAddress) return
    const id = setInterval(() => {
      // skip when the popup is hidden to save the backend some load
      if (!document.hidden) void fetchLatest()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [noidAddress, fetchLatest])

  // refs so the effect below always reads current values without re-subscribing
  const pendingNoidAccountRef = useRef<NoidSmartAccount | null>(null)
  const selectedNoidAccountRef = useRef<NoidSmartAccount | null>(null)
  useEffect(() => { pendingNoidAccountRef.current = pendingNoidAccount }, [pendingNoidAccount])
  useEffect(() => { selectedNoidAccountRef.current = selectedNoidAccount }, [selectedNoidAccount])

  // ── Pending account lifecycle + smart auto-select ──────────────────────
  useEffect(() => {
    if (myNoidSmartAccounts.length === 0) return

    const pending = pendingNoidAccountRef.current
    const selected = selectedNoidAccountRef.current

    // If the pending account is now confirmed in the pool list, clear it
    // and upgrade selectedNoidAccount to the confirmed version (real address)
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

    // Auto-select: only set if nothing is currently selected
    if (!selected) {
      setSelectedNoidAccount(myNoidSmartAccounts[0])
    } else {
      // If the selected account disappeared from pool AND is not pending, fall back
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

  // ── Helpers exposed to consumers ────────────────────────────────────────
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

  // derived: unspent UTXOs + total balance
  const allUnspentUTXOs = Object.values(myUTXOs)
    .flat()
    .filter((u) => !u.spent)
  const totalBalanceWei = allUnspentUTXOs.reduce(
    (s, u) => s + BigInt(u.amount),
    0n
  )
  const formattedBalance = formatBalanceWei(totalBalanceWei)

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
    myNoidSmartAccounts
  }

  return <PoolContext.Provider value={value}>{children}</PoolContext.Provider>
}

export function usePool() {
  const ctx = useContext(PoolContext)
  if (!ctx) throw new Error("usePool must be used within PoolProvider")
  return ctx
}