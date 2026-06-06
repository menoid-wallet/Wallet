/**
 * WalletContext.tsx
 *
 * Holds ALL unlocked wallets (decrypted, in memory) plus the active
 * index and the active network.
 *
 * Network changes propagate to PoolContext (which re-fetches state for
 * the new chain) and to the background script (which updates the EIP-1193
 * chainId advertised to dapps).
 *
 * Inactivity model: LOCK_AFTER_MS = 5 minutes of no user interaction.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from "react"
import type { StoredWallet } from "../crypto/walletCrypto"
import {
  clearSessionPassword,
  getSessionPassword,
  setSessionPassword
} from "../lib/sessionPassword"
import {
  addWalletEntry,
  readWalletsState,
  setActiveIndex as persistActiveIndex,
  type WalletEntry
} from "../lib/wallets"
import type { NoidSmartAccount } from "./PoolContext"
import { listOpenUsers, listNoidUsers } from "../services/users"
import {
  NETWORKS,
  NETWORK_IDS,
  DEFAULT_NETWORK,
  type NetworkId,
  type NetworkConfig
} from "../lib/networks"

const LOCK_AFTER_MS = 5 * 60 * 1000
const SESSION_KEY = "menoid_session_unlock"
const ACTIVE_NETWORK_KEY = "menoid_active_network"

export type WalletMode = "open" | "noid"

interface SessionRecord {
  wallets: StoredWallet[]
  entries: WalletEntry[]
  active: number
  expiresAt: number
  activeNetwork?: NetworkId
}

interface UnlockPayload {
  wallets: StoredWallet[]
  entries: WalletEntry[]
  active: number
  password: string
}

interface AddWalletPayload {
  openName?: string
  noidName?: string
  name: string
  fullWallet: StoredWallet
  registeredOpen: boolean
  registeredNoid: boolean
}

interface WalletContextValue {
  wallet: StoredWallet | null
  wallets: StoredWallet[]
  entries: WalletEntry[]
  activeIndex: number
  mode: WalletMode
  hydrating: boolean
  /** The currently active network. */
  activeNetwork: NetworkId
  /** Config for the currently active network. */
  networkConfig: NetworkConfig
  /** Switch to a different network. Notifies the background. */
  setActiveNetwork: (network: NetworkId) => void
  unlock: (payload: UnlockPayload) => void
  lock: () => void
  switchWallet: (index: number) => Promise<void>
  addWallet: (payload: AddWalletPayload) => Promise<void>
  refreshEntries: () => Promise<void>
  setMode: (m: WalletMode) => void
  toggleMode: () => void
  selectedNoidAccount: NoidSmartAccount | null
  setSelectedNoidAccount: (account: NoidSmartAccount | null) => void
  pendingNoidAccount: NoidSmartAccount | null
  setPendingNoidAccount: (account: NoidSmartAccount | null) => void
  openNamesMap: Record<string, string>
  noidNamesMap: Record<string, string>
  namesLoading: boolean
  refreshNames: () => Promise<void>
}

const WalletContext = createContext<WalletContextValue | null>(null)

// ─── Session storage helpers ───────────────────────────────────────────────────

function hasSessionStorage(): boolean {
  return (
    typeof chrome !== "undefined" &&
    !!chrome?.storage &&
    !!(chrome.storage as any).session
  )
}

async function readSession(): Promise<SessionRecord | null> {
  if (!hasSessionStorage()) return null
  try {
    const result = await (chrome.storage as any).session.get(SESSION_KEY)
    const rec = result?.[SESSION_KEY] as SessionRecord | undefined
    if (!rec) return null
    if (Date.now() > rec.expiresAt) {
      await (chrome.storage as any).session.remove(SESSION_KEY)
      return null
    }
    return rec
  } catch {
    return null
  }
}

async function writeSession(rec: SessionRecord): Promise<void> {
  if (!hasSessionStorage()) return
  try {
    await (chrome.storage as any).session.set({ [SESSION_KEY]: rec })
  } catch {/* ignore */}
}

async function clearSession(): Promise<void> {
  if (!hasSessionStorage()) return
  try {
    await (chrome.storage as any).session.remove(SESSION_KEY)
  } catch {/* ignore */}
}

/** Persist selected network to local storage so it survives extension reload. */
async function persistNetwork(network: NetworkId): Promise<void> {
  try {
    await chrome.storage.local.set({ [ACTIVE_NETWORK_KEY]: network })
  } catch {/* ignore */}
}

async function readPersistedNetwork(): Promise<NetworkId> {
  try {
    const r = await chrome.storage.local.get(ACTIVE_NETWORK_KEY)
    const n = r?.[ACTIVE_NETWORK_KEY] as NetworkId | undefined
    if (n && NETWORK_IDS.includes(n)) return n
  } catch {/* ignore */}
  return DEFAULT_NETWORK
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<StoredWallet[]>([])
  const [entries, setEntries] = useState<WalletEntry[]>([])
  const [activeIndex, setActiveIndexState] = useState<number>(0)
  const [mode, setModeState] = useState<WalletMode>("open")
  const [hydrating, setHydrating] = useState(true)
  const [selectedNoidAccount, setSelectedNoidAccount] = useState<NoidSmartAccount | null>(null)
  const [pendingNoidAccount, setPendingNoidAccount] = useState<NoidSmartAccount | null>(null)
  const [activeNetwork, setActiveNetworkState] = useState<NetworkId>(DEFAULT_NETWORK)

  const [openNamesMap, setOpenNamesMap] = useState<Record<string, string>>({})
  const [noidNamesMap, setNoidNamesMap] = useState<Record<string, string>>({})
  const [namesLoading, setNamesLoading] = useState(false)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const walletsRef = useRef<StoredWallet[]>([])
  const entriesRef = useRef<WalletEntry[]>([])
  const activeRef = useRef<number>(0)
  const networkRef = useRef<NetworkId>(DEFAULT_NETWORK)

  useEffect(() => { walletsRef.current = wallets }, [wallets])
  useEffect(() => { entriesRef.current = entries }, [entries])
  useEffect(() => { activeRef.current = activeIndex }, [activeIndex])
  useEffect(() => { networkRef.current = activeNetwork }, [activeNetwork])

  const lock = useCallback(() => {
    setWallets([])
    setEntries([])
    setActiveIndexState(0)
    setModeState("open")
    setSelectedNoidAccount(null)
    void clearSession()
    void clearSessionPassword()
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const bumpExpiry = useCallback(() => {
    const ws = walletsRef.current
    const es = entriesRef.current
    if (!ws.length) return
    const expiresAt = Date.now() + LOCK_AFTER_MS
    void writeSession({
      wallets: ws,
      entries: es,
      active: activeRef.current,
      expiresAt,
      activeNetwork: networkRef.current,
    })
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void (async () => {
        const rec = await readSession()
        if (!rec) return lock()
        const remaining = rec.expiresAt - Date.now()
        if (remaining <= 0) return lock()
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => lock(), remaining)
      })()
    }, LOCK_AFTER_MS)
  }, [lock])

  // ─── Network switching ───────────────────────────────────────────────────────

  const setActiveNetwork = useCallback(
    (network: NetworkId) => {
      if (!NETWORK_IDS.includes(network)) return
      setActiveNetworkState(network)
      networkRef.current = network
      void persistNetwork(network)
      bumpExpiry()
      // Notify background so EIP-1193 chainChanged fires on connected dapps
      chrome.runtime.sendMessage({
        type: "MENOID_NETWORK_CHANGED",
        network,
      }).catch(() => {})
    },
    [bumpExpiry]
  )

  // ─── Names ───────────────────────────────────────────────────────────────────

  const refreshNames = useCallback(async () => {
    setNamesLoading(true)
    try {
      const [openUsers, noidUsers] = await Promise.all([
        listOpenUsers().catch(() => []),
        listNoidUsers().catch(() => []),
      ])
      const om: Record<string, string> = {}
      for (const u of openUsers) {
        if (u.realAddress && u.name) om[u.realAddress.toLowerCase()] = u.name
      }
      const nm: Record<string, string> = {}
      for (const u of noidUsers) {
        if (u.noidModePublicKey && u.name) nm[u.noidModePublicKey.toLowerCase()] = u.name
      }
      setOpenNamesMap(om)
      setNoidNamesMap(nm)
    } catch {/* silently ignore */}
    finally { setNamesLoading(false) }
  }, [])

  // ─── Unlock ───────────────────────────────────────────────────────────────────

  const unlock: WalletContextValue["unlock"] = useCallback(
    (payload) => {
      setWallets(payload.wallets)
      walletsRef.current = payload.wallets
      setEntries(payload.entries)
      entriesRef.current = payload.entries
      setActiveIndexState(payload.active)
      activeRef.current = payload.active
      const expiresAt = Date.now() + LOCK_AFTER_MS
      void writeSession({
        wallets: payload.wallets,
        entries: payload.entries,
        active: payload.active,
        expiresAt,
        activeNetwork: networkRef.current,
      })
      void setSessionPassword(payload.password)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => lock(), LOCK_AFTER_MS)
      void refreshNames()
    },
    [lock, refreshNames]
  )

  const switchWallet = useCallback(
    async (index: number) => {
      if (index < 0 || index >= walletsRef.current.length) return
      setActiveIndexState(index)
      activeRef.current = index
      setSelectedNoidAccount(null)
      const state = await readWalletsState()
      if (state) await persistActiveIndex(state, index)
      bumpExpiry()

      const newEntry = entriesRef.current[index]
      const newWallet = walletsRef.current[index]
      if (newEntry && newWallet) {
        chrome.runtime.sendMessage({
          type: "MENOID_ACCOUNT_SWITCHED",
          walletId: newEntry.id,
          openAddress: newEntry.openAddress,
        }).catch(() => {})
      }
    },
    [bumpExpiry]
  )

  const addWallet: WalletContextValue["addWallet"] = useCallback(
    async (payload) => {
      const password = await getSessionPassword()
      if (!password) throw new Error("Session expired — please unlock again.")
      let state = await readWalletsState()
      if (!state) state = { active: 0, list: [] }

      const dup = state.list.find(
        (e) =>
          e.openAddress.toLowerCase() ===
          payload.fullWallet.normalAccount.address.toLowerCase()
      )
      if (dup) throw new Error(`A wallet with this address is already saved as "${dup.name}".`)

      const nextState = await addWalletEntry({
        state,
        name: payload.name,
        password,
        fullWallet: payload.fullWallet,
        registeredOpen: payload.registeredOpen,
        registeredNoid: payload.registeredNoid,
        openName: payload.openName,
        noidName: payload.noidName,
      })
      const newEntries = nextState.list
      const newWallets = [...walletsRef.current, payload.fullWallet]
      setEntries(newEntries)
      entriesRef.current = newEntries
      setWallets(newWallets)
      walletsRef.current = newWallets
      const newActive = newWallets.length - 1
      setActiveIndexState(newActive)
      activeRef.current = newActive
      bumpExpiry()
    },
    [bumpExpiry]
  )

  const refreshEntries = useCallback(async () => {
    const state = await readWalletsState()
    if (!state) return
    setEntries(state.list)
    entriesRef.current = state.list
    bumpExpiry()
  }, [bumpExpiry])

  const setMode = useCallback((m: WalletMode) => setModeState(m), [])
  const toggleMode = useCallback(
    () => setModeState((p) => (p === "open" ? "noid" : "open")),
    []
  )

  // ─── Notify background on noid account / mode changes ────────────────────────

  useEffect(() => {
    const entry = entriesRef.current[activeRef.current]
    if (!entry) return

    if (mode === "noid" && selectedNoidAccount?.account) {
      chrome.runtime.sendMessage({
        type: "MENOID_NOID_ACCOUNT_SWITCHED",
        walletId: entry.id,
        noidSmartAccountAddress: selectedNoidAccount.account,
        noidAccountCommitment: selectedNoidAccount.commitment,
      }).catch(() => {})
    } else if (mode === "open") {
      const ws = walletsRef.current[activeRef.current]
      if (ws?.normalAccount?.address) {
        chrome.runtime.sendMessage({
          type: "MENOID_NOID_ACCOUNT_SWITCHED",
          walletId: entry.id,
          noidSmartAccountAddress: null,
          noidAccountCommitment: null,
          openAddress: ws.normalAccount.address,
        }).catch(() => {})
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNoidAccount, mode])

  // ─── Hydrate from session storage on first mount ──────────────────────────────

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Load persisted network first (from local storage)
      const persistedNetwork = await readPersistedNetwork()
      if (!cancelled) {
        setActiveNetworkState(persistedNetwork)
        networkRef.current = persistedNetwork
      }

      const rec = await readSession()
      if (cancelled) return
      if (rec) {
        setWallets(rec.wallets)
        walletsRef.current = rec.wallets
        setEntries(rec.entries)
        entriesRef.current = rec.entries
        setActiveIndexState(rec.active)
        activeRef.current = rec.active
        // Session-stored network takes precedence over local storage
        if (rec.activeNetwork && NETWORK_IDS.includes(rec.activeNetwork)) {
          setActiveNetworkState(rec.activeNetwork)
          networkRef.current = rec.activeNetwork
        }
        const remaining = rec.expiresAt - Date.now()
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => lock(), remaining)
        void refreshNames()
      }
      setHydrating(false)
    })()
    return () => { cancelled = true }
  }, [lock])  // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Activity listeners ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!wallets.length) return
    const events: (keyof WindowEventMap)[] = ["mousedown", "keydown", "touchstart", "scroll"]
    const handler = () => bumpExpiry()
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }))
    return () => events.forEach((e) => window.removeEventListener(e, handler))
  }, [wallets.length, bumpExpiry])

  useEffect(() => {
    if (!wallets.length) return
    const handler = () => { if (!document.hidden) bumpExpiry() }
    document.addEventListener("visibilitychange", handler)
    return () => document.removeEventListener("visibilitychange", handler)
  }, [wallets.length, bumpExpiry])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const active = wallets[activeIndex] ?? null
  const networkConfig = NETWORKS[activeNetwork]

  return (
    <WalletContext.Provider
      value={{
        wallet: active,
        wallets,
        entries,
        activeIndex,
        mode,
        hydrating,
        activeNetwork,
        networkConfig,
        setActiveNetwork,
        unlock,
        lock,
        switchWallet,
        addWallet,
        refreshEntries,
        setMode,
        toggleMode,
        selectedNoidAccount,
        setSelectedNoidAccount,
        pendingNoidAccount,
        setPendingNoidAccount,
        openNamesMap,
        noidNamesMap,
        namesLoading,
        refreshNames,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider")
  return ctx
}