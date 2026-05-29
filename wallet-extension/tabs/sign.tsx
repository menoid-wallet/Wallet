/**
 * tabs/sign.tsx  →  compiles to tabs/sign.html
 *
 * Full-page transaction signing UI — opened when the wallet isn't in popup/sidebar
 * and a dapp calls eth_sendTransaction.
 *
 * Mirrors connect.tsx structure exactly:
 *   Lock phase:  LockScreen card centred
 *   Ready phase: TxApprovalModal centred, max-w-[780px]
 */

import React, { useEffect, useState } from "react"
import "../style.css"
import { WalletProvider, useWallet } from "../context/WalletContext"
import LockScreen from "../components/LockScreen"
import TxApprovalModal from "../components/TxApprovalModal"
import type { PendingTx } from "../components/TxApprovalModal"

const PENDING_TX_KEY = "menoid_pending_tx"

async function readPendingTx(): Promise<PendingTx | null> {
  // URL params first (background puts them there for the fallback tab)
  try {
    const sp = new URLSearchParams(window.location.search)
    const host  = sp.get("host")
    const tabId = sp.get("tabId")
    if (host && tabId) {
      // Full tx params come from storage — URL only carries metadata
      const store = (chrome.storage as any).session ?? chrome.storage.local
      const r = await store.get(PENDING_TX_KEY)
      if (r?.[PENDING_TX_KEY]) return r[PENDING_TX_KEY] as PendingTx
      // Fallback: construct from URL (no txParams — rare)
      return {
        host,
        origin: sp.get("origin") ?? "",
        favicon: sp.get("favicon") ?? "",
        tabId: Number(tabId),
        fromAddress: sp.get("from") ?? "",
        txParams: {},
      }
    }
  } catch {}
  try {
    const store = (chrome.storage as any).session ?? chrome.storage.local
    const r = await store.get(PENDING_TX_KEY)
    return r?.[PENDING_TX_KEY] ?? null
  } catch {
    return null
  }
}

type Phase = "loading" | "locked" | "ready" | "done"

function SignInner() {
  const { wallet, unlock, hydrating } = useWallet()
  const [phase, setPhase]   = useState<Phase>("loading")
  const [pendingTx, setPendingTx] = useState<PendingTx | null>(null)

  useEffect(() => {
    ;(async () => setPendingTx(await readPendingTx()))()
  }, [])

  useEffect(() => {
    if (hydrating) return
    if (!pendingTx) {
      try { window.close() } catch {}
      return
    }
    setPhase(wallet ? "ready" : "locked")
  }, [hydrating, wallet, pendingTx])

  useEffect(() => {
    function onChange(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) {
      if (area !== "session" && area !== "local") return
      if (!changes[PENDING_TX_KEY]) return
      if (!changes[PENDING_TX_KEY].newValue) {
        setTimeout(() => { try { window.close() } catch {} }, 650)
      }
    }
    chrome.storage.onChanged.addListener(onChange)
    return () => chrome.storage.onChanged.removeListener(onChange)
  }, [])

  async function handleDone() {
    setPhase("done")
    // Focus the dapp tab before closing so the user lands back on it
    if (pendingTx?.tabId && pendingTx.tabId >= 0) {
      try {
        await chrome.tabs.update(pendingTx.tabId, { active: true })
        const tab = await chrome.tabs.get(pendingTx.tabId)
        if (tab?.windowId !== undefined) {
          await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {})
        }
      } catch {}
    }
    setTimeout(() => { try { window.close() } catch {} }, 200)
  }

  return (
    <div className="relative min-h-screen w-screen overflow-x-hidden font-body text-ink selection:bg-ink selection:text-cream">
      <PageBackdrop />

      {/* ─── Top chrome ─── */}
      <header className="relative z-30">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-6 md:px-10 py-5">
          <div className="flex items-center gap-2.5">
            <div className="h-2 w-2 rounded-full bg-goldDeep" />
            <span className="font-display text-[13px] font-semibold tracking-[0.32em] text-ink">
              MENOID
            </span>
          </div>
          <nav className="flex items-center gap-6 text-[10px] tracking-[0.4em] uppercase text-ink/55">
            <span className="hidden sm:inline">Secure signing</span>
            <span className="h-1 w-1 rounded-full bg-goldDeep/60" />
            <span>Monad</span>
          </nav>
        </div>
        <div className="mx-auto h-px max-w-[1280px] bg-gradient-to-r from-transparent via-ink/15 to-transparent" />
      </header>

      {/* ─── Loading ─── */}
      {(phase === "loading" || hydrating) && (
        <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-80px)]">
          <PanelLoading />
        </div>
      )}

      {/* ─── Lock phase ─── */}
      {phase === "locked" && pendingTx && (
        <div className="relative z-10 min-h-[calc(100vh-80px)] flex flex-col">
          {/* Tx badge top-right */}
          <div
            className="absolute top-5 right-6 md:right-10 z-20 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl animate-revealUp"
            style={{
              background: "rgba(232,174,58,0.13)",
              border: "1px solid rgba(232,174,58,0.32)",
              backdropFilter: "blur(16px) saturate(160%)",
              WebkitBackdropFilter: "blur(16px) saturate(160%)",
              boxShadow: "0 8px 28px -10px rgba(163,110,20,0.28)",
              animationDelay: "0.2s",
            }}>
            {pendingTx.favicon ? (
              <img src={pendingTx.favicon} alt="" className="h-5 w-5 rounded object-contain" />
            ) : (
              <span style={{ fontSize: 15 }}>⛓</span>
            )}
            <div>
              <p className="text-[12px] font-semibold"
                style={{ color: "#A36E14", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {pendingTx.host} wants to send a transaction
              </p>
              <p className="text-[10px]" style={{ color: "rgba(163,110,20,0.65)" }}>
                Unlock your wallet to review
              </p>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center px-3 py-6">
            <div className="animate-revealUp w-full rounded-[28px] overflow-hidden max-w-[600px]" style={{ animationDelay: "0.1s" }}>
              <LockScreen
                onUnlock={(payload) => {
                  unlock(payload)
                  setPhase("ready")
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ─── Ready phase ─── */}
      {(phase === "ready" || phase === "done") && pendingTx && (
        <div className="relative z-10 flex items-start justify-center px-2 py-10 min-h-[calc(100vh-80px)]">
          <div className="w-full max-w-[780px] animate-revealUp" style={{ animationDelay: "0.05s" }}>
            <TxApprovalModal
              pendingTx={pendingTx}
              onDone={handleDone}
              compact={false}
            />
          </div>
        </div>
      )}

      <style>{`
        @keyframes connOrb1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(24px,-16px) scale(1.08)} }
        @keyframes connOrb2 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-20px,18px) scale(1.05)} }
      `}</style>
    </div>
  )
}

function PanelLoading() {
  return (
    <div className="rounded-[28px] p-10 flex flex-col items-center gap-4"
      style={{
        background: "rgba(255,251,240,0.7)",
        border: "1px solid rgba(23,19,17,0.08)",
        backdropFilter: "blur(20px)",
        boxShadow: "0 30px 70px -28px rgba(92,58,33,0.4)",
      }}>
      <div className="relative h-12 w-12">
        <div className="absolute inset-0 rounded-full bg-gold/40 blur-lg animate-shimmer" />
        <div className="relative h-12 w-12 rounded-full border border-goldDeep/30 animate-spin border-t-goldDeep" />
      </div>
      <p className="font-serif italic text-[13px] text-ink/45">Preparing transaction…</p>
    </div>
  )
}

function PageBackdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-gradient-to-br from-[#FBF1D9] via-cream to-parchment" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_78%_42%,_rgba(232,174,58,0.3)_0%,_rgba(246,233,208,0)_52%)]" />
      <div className="pointer-events-none absolute"
        style={{
          top: "-12%", left: "-10%", width: 380, height: 380, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(244,210,122,0.42) 0%, transparent 65%)",
          filter: "blur(70px)", animation: "connOrb2 14s ease-in-out infinite",
        }} />
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-40" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:linear-gradient(to_right,#171311_1px,transparent_1px),linear-gradient(to_bottom,#171311_1px,transparent_1px)] [background-size:64px_64px]" />
    </>
  )
}

export default function SignTab() {
  return (
    <WalletProvider>
      <SignInner />
    </WalletProvider>
  )
}