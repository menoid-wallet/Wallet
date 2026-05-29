/**
 * popup.tsx  —  Detects pending dapp connection approvals.
 *
 *   - Reads chrome.storage.session for a pending MENOID approval request.
 *   - If found and wallet is unlocked → shows ConnectApprovalModal over WalletHome.
 *   - If found but wallet is locked → shows a banner over LockScreen; once the
 *     user unlocks, the approval modal appears.
 *   - Listens to storage.onChanged so a request that arrives while the popup
 *     is open is surfaced instantly (and cleared when acted upon elsewhere).
 */

import React, { useEffect, useState } from "react"
import "./style.css"
import { PoolProvider } from "./context/PoolContext"
import { WalletProvider, useWallet } from "./context/WalletContext"
import LockScreen from "./components/LockScreen"
import WalletHome from "./components/WalletHome"
import ConnectApprovalModal from "./components/ConnectApprovalModal"
import { startWalletOpenHeartbeat } from "./lib/walletOpenHeartbeat"

type AppState = "loading" | "locked" | "unlocked"

interface PendingApproval {
  host: string
  origin: string
  favicon: string
  tabId: number
}

const PENDING_APPROVAL_KEY = "menoid_pending_approval"

async function readPendingApproval(): Promise<PendingApproval | null> {
  try {
    const store = (chrome.storage as any).session ?? chrome.storage.local
    const r = await store.get(PENDING_APPROVAL_KEY)
    return r?.[PENDING_APPROVAL_KEY] ?? null
  } catch {
    return null
  }
}

const DISMISSED_KEY = "menoid_dismissed_approvals"

async function getDismissedHosts(): Promise<string[]> {
  try {
    const store = (chrome.storage as any).session ?? chrome.storage.local
    const r = await store.get(DISMISSED_KEY)
    return r?.[DISMISSED_KEY] ?? []
  } catch { return [] }
}

async function addDismissedHost(host: string): Promise<void> {
  try {
    const store = (chrome.storage as any).session ?? chrome.storage.local
    const current = await getDismissedHosts()
    if (!current.includes(host)) {
      await store.set({ [DISMISSED_KEY]: [...current, host] })
    }
  } catch {}
}

function AppInner() {
  const { wallet, unlock, hydrating } = useWallet()
  const [appState, setAppState] = useState<AppState>("loading")
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const [showApproval, setShowApproval] = useState(false)

  // Tell background.ts this wallet view is open.
  useEffect(() => startWalletOpenHeartbeat(), [])

  // ── One-shot init ─────────────────────────────────────────────────────
  useEffect(() => {
    if (hydrating) return
    ;(async () => {
      const chromeAvailable =
        typeof chrome !== "undefined" &&
        chrome?.storage?.local !== undefined &&
        chrome?.runtime?.getURL !== undefined

      if (!chromeAvailable) {
        setAppState("locked")
        return
      }

      let onboarding = false
      let hasWallet = false
      try {
        const result = await chrome.storage.local.get([
          "menoid_onboarding",
          "menoid_wallets",
          "menoid_wallet"
        ])
        onboarding = result?.menoid_onboarding ?? false
        hasWallet = !!(result?.menoid_wallets || result?.menoid_wallet)
      } catch {
        /* treat as fresh */
      }

      if (!onboarding || !hasWallet) {
        try {
          chrome.tabs.create({
            url: chrome.runtime.getURL("tabs/welcome.html")
          })
          window.close()
        } catch {
          setAppState("locked")
        }
        return
      }

      const pending = await readPendingApproval()
      if (pending) {
        const dismissed = await getDismissedHosts()
        if (!dismissed.includes(pending.host)) {
          setPendingApproval(pending)
        }
      }

      if (wallet) {
        setAppState("unlocked")
        // Don't auto-open modal — banner will show instead
      } else {
        setAppState("locked")
      }
    })()
  }, [hydrating])

  // ── Show approval once wallet unlocks ──────────────────────────────────
  useEffect(() => {
    // intentionally empty — banner handles the UX
  }, [appState, pendingApproval])

  // ── storage.onChanged — instant detect / clear ────────────────────────
  useEffect(() => {
    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) {
      if (area !== "session" && area !== "local") return
      if (!changes[PENDING_APPROVAL_KEY]) return
      const newVal = changes[PENDING_APPROVAL_KEY].newValue
      if (newVal) {
        // Check dismissed list before showing
        getDismissedHosts().then((dismissed) => {
          if (!dismissed.includes(newVal.host)) {
            setPendingApproval(newVal)
          }
        })
      } else {
        setPendingApproval(null)
        setShowApproval(false)
      }
    }
    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [appState])

  if (appState === "loading" || hydrating) {
    return (
      <div className="w-[360px] h-[600px] bg-cream flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative h-12 w-12">
            <div className="absolute inset-0 rounded-full bg-gold/40 blur-lg animate-shimmer" />
            <div className="relative h-12 w-12 rounded-full border border-goldDeep/30 animate-spin border-t-goldDeep" />
          </div>
          <p className="font-serif italic text-[12px] text-ink/40">
            Loading Menoid…
          </p>
        </div>
      </div>
    )
  }

  if (appState === "locked" || !wallet)
    return (
      <div className="relative w-[360px] h-[600px] isolate">
        <LockScreen
          onUnlock={(payload) => {
            unlock(payload)
            setAppState("unlocked")
          }}
        />
        {pendingApproval && (
          <div
            className="absolute left-3 right-3 z-[2147483647] flex items-center gap-2.5 px-3 py-2.5 rounded-2xl"
            style={{
              top: 64,
              background: "rgba(232,174,58,0.16)",
              border: "1px solid rgba(232,174,58,0.35)",
              backdropFilter: "blur(18px) saturate(160%)",
              WebkitBackdropFilter: "blur(18px) saturate(160%)",
              boxShadow: "0 10px 30px -8px rgba(163,110,20,0.3)",
              animation: "approvalBannerIn 500ms cubic-bezier(0.34,1.56,0.64,1) both",
            }}>
            <span style={{ fontSize: 16 }}>🔗</span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold truncate" style={{ color: "#A36E14" }}>
                {pendingApproval.host} wants to connect
              </p>
              <p className="text-[10px]" style={{ color: "rgba(163,110,20,0.7)" }}>
                Unlock your wallet to review
              </p>
            </div>
          </div>
        )}
        <style>{`
          @keyframes approvalBannerIn {
            0% { opacity: 0; transform: translateY(-10px); }
            100% { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    )

  async function handleDismiss() {
    if (pendingApproval) await addDismissedHost(pendingApproval.host)
    setPendingApproval(null)
    setShowApproval(false)
  }

  return (
    <div className="relative w-[360px] h-[600px]">
      <WalletHome
        pendingApproval={pendingApproval}
        onApprovalBannerClick={() => setShowApproval(true)}
        onApprovalBannerDismiss={handleDismiss}
      />
      {showApproval && pendingApproval && (
        <ConnectApprovalModal
          approval={pendingApproval}
          onDone={() => {
            setShowApproval(false)
            setPendingApproval(null)
          }}
        />
      )}
    </div>
  )
}

function IndexPopup() {
  return (
    <WalletProvider>
      <PoolProvider>
        <AppInner />
      </PoolProvider>
    </WalletProvider>
  )
}

export default IndexPopup