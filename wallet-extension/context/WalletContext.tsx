/**
 * WalletContext.tsx
 *
 * Holds the decrypted wallet in memory + a session-persisted "unlock"
 * record so closing & reopening the popup within the inactivity window
 * does NOT force the user to re-enter their password.
 *
 * Why chrome.storage.session?
 *   - Lives only in memory (not on disk).
 *   - Cleared on browser restart / extension reload.
 *   - Survives popup unmount, which is exactly what we need for #6.
 *
 * Inactivity model:
 *   - LOCK_AFTER_MS = 5 minutes since the last user interaction.
 *   - Every interaction bumps `expiresAt` forward.
 *   - On mount we read the session record; if it's still valid we
 *     auto-unlock without a password prompt. If it's expired we wipe it.
 *
 * Modes:
 *   - "open"  → the public (formerly "normal") wallet
 *   - "noid"  → the ZK / Menoid wallet
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

const LOCK_AFTER_MS = 5 * 60 * 1000 // 5 minutes
const SESSION_KEY = "menoid_session_unlock"

export type WalletMode = "open" | "noid"

interface SessionRecord {
  wallet: StoredWallet
  expiresAt: number
}

interface WalletContextValue {
  wallet: StoredWallet | null
  mode: WalletMode
  /** true while we're checking chrome.storage.session on first paint */
  hydrating: boolean
  unlock: (wallet: StoredWallet) => void
  lock: () => void
  setMode: (m: WalletMode) => void
  toggleMode: () => void
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
  const [wallet, setWallet] = useState<StoredWallet | null>(null)
  const [mode, setModeState] = useState<WalletMode>("open")
  const [hydrating, setHydrating] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const walletRef = useRef<StoredWallet | null>(null)

  // keep ref in sync so the activity-event handler always sees current wallet
  useEffect(() => {
    walletRef.current = wallet
  }, [wallet])

  const lock = useCallback(() => {
    setWallet(null)
    setModeState("open")
    void clearSession()
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const bumpExpiry = useCallback(() => {
    const w = walletRef.current
    if (!w) return
    const expiresAt = Date.now() + LOCK_AFTER_MS
    void writeSession({ wallet: w, expiresAt })

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      // Re-check session in case another popup/tab pushed it forward
      void (async () => {
        const rec = await readSession()
        if (!rec) {
          lock()
        } else {
          // schedule next check at the new expiry
          const remaining = rec.expiresAt - Date.now()
          if (remaining <= 0) lock()
          else {
            if (timerRef.current) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => lock(), remaining)
          }
        }
      })()
    }, LOCK_AFTER_MS)
  }, [lock])

  const unlock = useCallback(
    (w: StoredWallet) => {
      setWallet(w)
      walletRef.current = w
      // bump immediately so the session record is written
      const expiresAt = Date.now() + LOCK_AFTER_MS
      void writeSession({ wallet: w, expiresAt })
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => lock(), LOCK_AFTER_MS)
    },
    [lock]
  )

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
        setWallet(rec.wallet)
        walletRef.current = rec.wallet
        // schedule lock at remaining time
        const remaining = rec.expiresAt - Date.now()
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => lock(), remaining)
      }
      setHydrating(false)
    })()
    return () => {
      cancelled = true
    }
  }, [lock])

  // ─── Activity listeners (mouse, keyboard, scroll, touch) ───────────────
  useEffect(() => {
    if (!wallet) return
    const events: (keyof WindowEventMap)[] = [
      "mousedown",
      "keydown",
      "touchstart",
      "scroll"
    ]
    const handler = () => bumpExpiry()
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }))
    return () => events.forEach((e) => window.removeEventListener(e, handler))
  }, [wallet, bumpExpiry])

  // visibility change: when the user comes back to the tab, bump expiry
  useEffect(() => {
    if (!wallet) return
    const handler = () => {
      if (!document.hidden) bumpExpiry()
    }
    document.addEventListener("visibilitychange", handler)
    return () => document.removeEventListener("visibilitychange", handler)
  }, [wallet, bumpExpiry])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  return (
    <WalletContext.Provider
      value={{
        wallet,
        mode,
        hydrating,
        unlock,
        lock,
        setMode,
        toggleMode
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