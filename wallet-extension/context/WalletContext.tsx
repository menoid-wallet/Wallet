/**
 * WalletContext.tsx
 *
 * Holds ALL unlocked wallets (decrypted, in memory) plus the active
 * index. A single wallet password unlocks every entry — the password
 * itself is kept obfuscated in chrome.storage.session (see
 * sessionPassword.ts) so the "Add wallet" flow inside the switcher does
 * not need to re-prompt for it.
 *
 * Why chrome.storage.session for the session record?
 *   - Lives only in RAM (never written to disk).
 *   - Cleared on browser restart / extension reload.
 *   - Survives popup unmount, so closing & reopening the popup within
 *     the inactivity window does NOT force the user to re-enter their
 *     password.
 *
 * Inactivity model:
 *   - LOCK_AFTER_MS = 5 minutes since the last user interaction.
 *   - Every interaction bumps `expiresAt` forward.
 *   - On mount we read the session record; if it's still valid we
 *     auto-unlock without a password prompt. If it's expired we wipe it.
 *
 * Modes (Open vs Noid) are per-session, not per-wallet — switching
 * wallets keeps the current mode.
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

const LOCK_AFTER_MS = 5 * 60 * 1000 // 5 minutes
const SESSION_KEY = "menoid_session_unlock"

export type WalletMode = "open" | "noid"

interface SessionRecord {
  wallets: StoredWallet[]
  entries: WalletEntry[]
  active: number
  expiresAt: number
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
  /** The currently active wallet (convenience). Null until unlocked. */
  wallet: StoredWallet | null
  /** Every decrypted wallet, in storage order. */
  wallets: StoredWallet[]
  /** Metadata for every wallet — same order as `wallets`. */
  entries: WalletEntry[]
  activeIndex: number
  mode: WalletMode
  /** true while we're checking chrome.storage.session on first paint */
  hydrating: boolean
  unlock: (payload: UnlockPayload) => void
  lock: () => void
  switchWallet: (index: number) => Promise<void>
  /** Adds a new wallet, encrypting it with the cached session password. */
  addWallet: (payload: AddWalletPayload) => Promise<void>
  refreshEntries: () => Promise<void>
  setMode: (m: WalletMode) => void
  toggleMode: () => void
  /** The currently selected Noid Smart Account for this wallet. Null if none. */
  selectedNoidAccount: NoidSmartAccount | null
  /** Set the selected Noid Smart Account manually (e.g. from the picker modal). */
  setSelectedNoidAccount: (account: NoidSmartAccount | null) => void
  /**
   * Optimistic account created locally after a successful creation tx.
   * Shown immediately in the UI before the 10 s pool sync confirms it.
   * Cleared automatically by PoolContext once the commitment is found on-chain.
   */
  pendingNoidAccount: NoidSmartAccount | null
  setPendingNoidAccount: (account: NoidSmartAccount | null) => void
  /**
   * Map of openAddress.toLowerCase() → .meno username, fetched from /users/all.
   * Populated after unlock. Empty until fetch completes.
   */
  openNamesMap: Record<string, string>
  /**
   * Map of noidPublicKey.toLowerCase() → .meno username, fetched from /noidusers/all.
   * Populated after unlock. Empty until fetch completes.
   */
  noidNamesMap: Record<string, string>
  /** true while the initial names fetch is in-flight */
  namesLoading: boolean
  /** Re-fetch both name maps from the backend (call after setting a name). */
  refreshNames: () => Promise<void>
}

const WalletContext = createContext<WalletContextValue | null>(null)

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
  } catch {
    /* ignore */
  }
}

async function clearSession(): Promise<void> {
  if (!hasSessionStorage()) return
  try {
    await (chrome.storage as any).session.remove(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<StoredWallet[]>([])
  const [entries, setEntries] = useState<WalletEntry[]>([])
  const [activeIndex, setActiveIndexState] = useState<number>(0)
  const [mode, setModeState] = useState<WalletMode>("open")
  const [hydrating, setHydrating] = useState(true)
  const [selectedNoidAccount, setSelectedNoidAccount] = useState<NoidSmartAccount | null>(null)
  const [pendingNoidAccount, setPendingNoidAccount] = useState<NoidSmartAccount | null>(null)

  const [openNamesMap, setOpenNamesMap] = useState<Record<string, string>>({})
  const [noidNamesMap, setNoidNamesMap] = useState<Record<string, string>>({})
  const [namesLoading, setNamesLoading] = useState(false)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const walletsRef = useRef<StoredWallet[]>([])
  const entriesRef = useRef<WalletEntry[]>([])
  const activeRef = useRef<number>(0)

  useEffect(() => {
    walletsRef.current = wallets
  }, [wallets])
  useEffect(() => {
    entriesRef.current = entries
  }, [entries])
  useEffect(() => {
    activeRef.current = activeIndex
  }, [activeIndex])

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
      expiresAt
    })
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      // Re-check session in case another popup/tab pushed it forward
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

  /** Fetch open + noid name maps from the backend. */
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
    } catch {
      /* silently ignore — UI degrades gracefully */
    } finally {
      setNamesLoading(false)
    }
  }, [])

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
        expiresAt
      })
      void setSessionPassword(payload.password)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => lock(), LOCK_AFTER_MS)
      // Kick off name resolution in background — don't block unlock
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

      // Tell background about the account switch so it can trigger a
      // fresh connection-approval for any dapps connected to this wallet.
      const newEntry = entriesRef.current[index]
      const newWallet = walletsRef.current[index]
      if (newEntry && newWallet) {
        chrome.runtime.sendMessage({
          type: "MENOID_ACCOUNT_SWITCHED",
          walletId: newEntry.id,
          openAddress: newEntry.openAddress,
        }).catch(() => {/* background may not be listening yet — ignore */})
      }
    },
    [bumpExpiry]
  )

  const addWallet: WalletContextValue["addWallet"] = useCallback(
    async (payload) => {
      const password = await getSessionPassword()
      if (!password) {
        throw new Error("Session expired — please unlock again.")
      }
      let state = await readWalletsState()
      if (!state) state = { active: 0, list: [] }

      // refuse duplicate addresses
      const dup = state.list.find(
        (e) =>
          e.openAddress.toLowerCase() ===
          payload.fullWallet.normalAccount.address.toLowerCase()
      )
      if (dup) {
        throw new Error(`A wallet with this address is already saved as "${dup.name}".`)
      }

      const nextState = await addWalletEntry({
        state,
        name: payload.name,
        password,
        fullWallet: payload.fullWallet,
        registeredOpen: payload.registeredOpen,
        registeredNoid: payload.registeredNoid,
        openName: payload.openName,
        noidName: payload.noidName
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

  /** Re-read entries from storage — used after patching in-wallet name. */
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

  // ─── Hydrate from chrome.storage.session on first mount ────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const rec = await readSession()
      if (cancelled) return
      if (rec) {
        setWallets(rec.wallets)
        walletsRef.current = rec.wallets
        setEntries(rec.entries)
        entriesRef.current = rec.entries
        setActiveIndexState(rec.active)
        activeRef.current = rec.active
        const remaining = rec.expiresAt - Date.now()
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => lock(), remaining)
        // Restore names silently in the background
        void refreshNames()
      }
      setHydrating(false)
    })()
    return () => {
      cancelled = true
    }
  }, [lock])

  // ─── Activity listeners ─────────────────────────────────────────────────
  useEffect(() => {
    if (!wallets.length) return
    const events: (keyof WindowEventMap)[] = [
      "mousedown",
      "keydown",
      "touchstart",
      "scroll"
    ]
    const handler = () => bumpExpiry()
    events.forEach((e) =>
      window.addEventListener(e, handler, { passive: true })
    )
    return () => events.forEach((e) => window.removeEventListener(e, handler))
  }, [wallets.length, bumpExpiry])

  useEffect(() => {
    if (!wallets.length) return
    const handler = () => {
      if (!document.hidden) bumpExpiry()
    }
    document.addEventListener("visibilitychange", handler)
    return () => document.removeEventListener("visibilitychange", handler)
  }, [wallets.length, bumpExpiry])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  const active = wallets[activeIndex] ?? null

  return (
    <WalletContext.Provider
      value={{
        wallet: active,
        wallets,
        entries,
        activeIndex,
        mode,
        hydrating,
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
      }}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider")
  return ctx
}