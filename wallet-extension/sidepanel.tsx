import React, { useEffect, useState } from "react"
import "./style.css"
import { PoolProvider } from "./context/PoolContext"
import { WalletProvider, useWallet } from "./context/WalletContext"
import LockScreen from "./components/LockScreen"
import WalletHome from "./components/WalletHome"
import ConnectApprovalModal from "./components/ConnectApprovalModal"
import TxApprovalModal from "./components/TxApprovalModal"
import type { PendingTx } from "./components/TxApprovalModal"
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
  const [pendingTx, setPendingTx] = useState<PendingTx | null>(null)
  const [showTxApproval, setShowTxApproval] = useState(false)

  // Tell background.ts this wallet view is open (so connection requests show
  // here instead of opening the connect.html fallback tab).
  useEffect(() => startWalletOpenHeartbeat(), [])

  // ── One-shot init ─────────────────────────────────────────────────────
  useEffect(() => {
    if (hydrating) return
    ;(async () => {
      const chromeAvailable =
        typeof chrome !== "undefined" &&
        chrome?.storage?.local !== undefined &&
        chrome?.runtime?.getURL !== undefined

      if (!chromeAvailable) { setAppState("locked"); return }

      let onboarding = false, hasWallet = false
      try {
        const result = await chrome.storage.local.get([
          "menoid_onboarding", "menoid_wallets", "menoid_wallet"
        ])
        onboarding = result?.menoid_onboarding ?? false
        hasWallet  = !!(result?.menoid_wallets || result?.menoid_wallet)
      } catch {}

      if (!onboarding || !hasWallet) {
        try {
          chrome.tabs.create({ url: chrome.runtime.getURL("tabs/welcome.html") })
          window.close()
        } catch { setAppState("locked") }
        return
      }

      const pending = await readPendingApproval()
      if (pending) {
        const dismissed = await getDismissedHosts()
        if (!dismissed.includes(pending.host)) {
          setPendingApproval(pending)
        }
      }

      const txStore = (chrome.storage as any).session ?? chrome.storage.local
      const txRes = await txStore.get("menoid_pending_tx").catch(() => null)
      if (txRes?.menoid_pending_tx) {
        setPendingTx(txRes.menoid_pending_tx)
        if (wallet) setShowTxApproval(true)
      }

      if (wallet) {
        setAppState("unlocked")
        // Don't auto-open modal — banner will show instead
      } else {
        setAppState("locked")
      }
    })()
  }, [hydrating])

  // ── Show approval once wallet unlocks ─────────────────────────────────
  // NOTE: we do NOT auto-open the modal — pendingApproval being set is
  // enough for the banner to appear. Modal opens only when user taps it.
  useEffect(() => {
    // intentionally empty — banner handles the UX
  }, [appState, pendingApproval])

  // ── storage.onChanged — instant detection, no polling needed ─────────
  useEffect(() => {
    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) {
      if (area !== "session" && area !== "local") return

      if (changes[PENDING_APPROVAL_KEY]) {
        const newVal = changes[PENDING_APPROVAL_KEY].newValue
        if (newVal) {
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

      if (changes["menoid_pending_tx"]) {
        const newTx = changes["menoid_pending_tx"].newValue
        if (newTx) {
          setPendingTx(newTx)
          setShowTxApproval(true)
        } else {
          setPendingTx(null)
          setShowTxApproval(false)
        }
      }
    }
    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [appState])

  // Boot: the sky, and nothing on it. <LockScreen /> mounts with the liquid
  // wordmark loader already covering it, so this is only ever the frame or two
  // before storage answers.
  if (appState === "loading" || hydrating) {
    return <div className="bg-menoid h-full w-full" />
  }

  if (appState === "locked" || !wallet) {
    return (
      // `isolate` creates a fresh stacking context on this wrapper so the
      // banner's z-index is judged against the LockScreen as a sibling unit
      // (not against LockScreen's internal z-20 header).
      <div className="relative w-full h-full isolate">
        <LockScreen onUnlock={(payload) => { unlock(payload); setAppState("unlocked") }} />

        {/* Pending-approval banner — must float ABOVE everything in the
            LockScreen (its mark chip sits at z-30 within its own context).
            We push it down below the chip and give it the top layer. */}
        {pendingApproval && (
          <div
            className="absolute left-3 right-3 z-[2147483647] flex items-center gap-2.5 px-3 py-2.5 rounded-2xl"
            style={{
              top: 52, // clears the mark chip in the top-left corner
              background: "rgba(255,255,255,0.20)",
              border: "1px solid rgba(255,255,255,0.34)",
              backdropFilter: "blur(18px) saturate(160%)",
              WebkitBackdropFilter: "blur(18px) saturate(160%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.35), 0 10px 30px -8px rgba(48,26,96,0.45)",
              animation: "approvalBannerIn 500ms cubic-bezier(0.34,1.56,0.64,1) both",
            }}>
            <span style={{ fontSize: 16 }}>🔗</span>
            <div className="min-w-0">
              <p className="font-round text-[11px] font-semibold truncate text-white">
                {pendingApproval.host} wants to connect
              </p>
              <p className="font-round text-[10px] text-white/70">
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
  }

  async function handleDismiss() {
    if (pendingApproval) await addDismissedHost(pendingApproval.host)
    setPendingApproval(null)
    setShowApproval(false)
  }

  return (
    <div className="relative w-full h-full">
      <WalletHome
        pendingApproval={pendingApproval}
        onApprovalBannerClick={() => setShowApproval(true)}
        onApprovalBannerDismiss={handleDismiss}
      />
      {showApproval && pendingApproval && (
        <ConnectApprovalModal
          approval={pendingApproval}
          onDone={() => { setShowApproval(false); setPendingApproval(null) }}
        />
      )}
      {showTxApproval && pendingTx && (
        <TxApprovalModal
          pendingTx={pendingTx}
          onDone={() => { setShowTxApproval(false); setPendingTx(null) }}
        />
      )}
    </div>
  )
}

function SidePanel() {
  return (
    <WalletProvider>
      <PoolProvider>
        <AppInner />
      </PoolProvider>
    </WalletProvider>
  )
}

export default SidePanel