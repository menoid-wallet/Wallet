/**
 * tabs/connect.tsx  →  compiles to tabs/connect.html
 *
 * Full-page WEBSITE for handling a dapp connection request when the wallet
 * popup/sidebar can't be opened. This is intentionally a website layout — a
 * branded two-column page (hero + request panel), responsive down to mobile —
 * NOT the 360px wallet chrome dropped onto a page.
 *
 * Flow:
 *   1. background.ts opens this tab (with the approval in the URL) only when
 *      the wallet view is closed AND the popup/sidebar couldn't be opened.
 *   2. If the session is alive → show the request panel.
 *      If locked → show an unlock panel, then the request.
 *   3. On approve/reject → background notifies the dapp tab and this tab
 *      closes itself.
 */

import React, { useEffect, useState } from "react"
import "../style.css"
import menoImg from "data-base64:~assets/meno/meno_hi_text.png"
import { PoolProvider } from "../context/PoolContext"
import { WalletProvider, useWallet } from "../context/WalletContext"
import LockScreen from "../components/LockScreen"
import ConnectApprovalModal from "../components/ConnectApprovalModal"

interface PendingApproval {
  host: string
  origin: string
  favicon: string
  tabId: number
}

const PENDING_APPROVAL_KEY = "menoid_pending_approval"

async function readPendingApproval(): Promise<PendingApproval | null> {
  try {
    const sp = new URLSearchParams(window.location.search)
    const host = sp.get("host")
    const tabId = sp.get("tabId")
    if (host && tabId) {
      return {
        host,
        origin: sp.get("origin") ?? "",
        favicon: sp.get("favicon") ?? "",
        tabId: Number(tabId),
      }
    }
  } catch {}
  try {
    const store = (chrome.storage as any).session ?? chrome.storage.local
    const r = await store.get(PENDING_APPROVAL_KEY)
    return r?.[PENDING_APPROVAL_KEY] ?? null
  } catch {
    return null
  }
}

type Phase = "loading" | "locked" | "ready" | "done"

function ConnectInner() {
  const { wallet, unlock, hydrating } = useWallet()
  const [phase, setPhase] = useState<Phase>("loading")
  const [approval, setApproval] = useState<PendingApproval | null>(null)

  useEffect(() => {
    ;(async () => setApproval(await readPendingApproval()))()
  }, [])

  useEffect(() => {
    if (hydrating) return
    if (!approval) {
      try { window.close() } catch {}
      return
    }
    setPhase(wallet ? "ready" : "locked")
  }, [hydrating, wallet, approval])

  // If the request is cleared elsewhere (acted on in the popup), close.
  useEffect(() => {
    function onChange(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) {
      if (area !== "session" && area !== "local") return
      if (!changes[PENDING_APPROVAL_KEY]) return
      if (!changes[PENDING_APPROVAL_KEY].newValue) {
        setTimeout(() => { try { window.close() } catch {} }, 650)
      }
    }
    chrome.storage.onChanged.addListener(onChange)
    return () => chrome.storage.onChanged.removeListener(onChange)
  }, [])

  function handleDone() {
    setPhase("done")
    setTimeout(() => { try { window.close() } catch {} }, 600)
  }

  return (
    <div className="relative min-h-screen w-screen overflow-x-hidden bg-cream font-body text-ink selection:bg-ink selection:text-cream">
      <PageBackdrop />

      {/* ─── top chrome ─── */}
      <header className="relative z-30">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-6 md:px-10 py-5">
          <div className="flex items-center gap-2.5">
            <div className="h-2 w-2 rounded-full bg-goldDeep" />
            <span className="font-display text-[13px] font-semibold tracking-[0.32em] text-ink">
              MENOID
            </span>
          </div>
          <nav className="flex items-center gap-6 text-[10px] tracking-[0.4em] uppercase text-ink/55">
            <span className="hidden sm:inline">Secure connection</span>
            <span className="h-1 w-1 rounded-full bg-goldDeep/60" />
            <span>Monad</span>
          </nav>
        </div>
        <div className="mx-auto h-px max-w-[1280px] bg-gradient-to-r from-transparent via-ink/15 to-transparent" />
      </header>

      {/* ─── main: two columns on desktop, stacked on mobile ─── */}
      <main className="relative z-10 mx-auto grid max-w-[1280px] grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 px-6 md:px-10 pt-10 lg:pt-16 pb-24 items-center min-h-[calc(100vh-140px)]">

        {/* ── left: hero / context ── */}
        <section className="lg:col-span-6 xl:col-span-7 flex flex-col justify-center">
          <div className="flex items-center gap-3 animate-revealRight" style={{ animationDelay: "0.05s" }}>
            <span className="font-serif italic text-base text-goldDeep">↩</span>
            <span className="h-px w-10 bg-ink/25" />
            <span className="text-[10px] tracking-[0.4em] uppercase text-ink/55">Connection Request</span>
          </div>

          <h1
            className="mt-5 font-display font-bold text-ink tracking-[-0.035em] leading-[0.98] text-[clamp(34px,4.6vw,68px)] animate-revealUp"
            style={{ animationDelay: "0.15s" }}>
            Approve access for{" "}
            <span className="font-serif italic font-medium text-goldDeep break-all">
              {approval?.host ?? "this site"}
            </span>
            <span className="text-ink">.</span>
          </h1>

          <p
            className="mt-5 max-w-[540px] text-[15px] leading-[1.7] text-ink/60 animate-revealUp"
            style={{ animationDelay: "0.28s" }}>
            This site wants to connect to your Menoid wallet on Monad. Choose the
            account it can see, then drag the ship to approve. You stay in
            control — nothing is shared until you say so.
          </p>

          {/* trust strip */}
          <div
            className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3 text-[10px] tracking-[0.35em] uppercase text-ink/45 animate-revealUp"
            style={{ animationDelay: "0.4s" }}>
            <Badge>Non-custodial</Badge>
            <Badge>You pick the account</Badge>
            <Badge>Revoke anytime</Badge>
          </div>

          {/* meno mascot — desktop only, decorative */}
          <div className="mt-12 hidden lg:flex items-center gap-5 animate-revealUp" style={{ animationDelay: "0.5s" }}>
            <img
              src={menoImg}
              alt="Meno"
              style={{ mixBlendMode: "multiply" }}
              className="w-[140px] drop-shadow-[0_18px_18px_rgba(28,20,12,0.22)] animate-float"
            />
            <div className="flex items-center gap-3">
              <span className="h-px w-6 bg-goldDeep/60" />
              <p className="font-serif italic text-[13px] leading-none text-ink/55">
                Yer keys, yer kingdom.
              </p>
            </div>
          </div>
        </section>

        {/* ── hairline divider (desktop) ── */}
        <div className="hidden lg:block lg:col-span-1 h-[70%] mx-auto w-px bg-gradient-to-b from-transparent via-ink/15 to-transparent" />

        {/* ── right: the live request / unlock panel ── */}
        <section className="lg:col-span-5 xl:col-span-4 w-full max-w-[480px] mx-auto lg:mx-0">
          {(phase === "loading" || hydrating) && <PanelLoading />}

          {phase === "locked" && approval && (
            <UnlockPanel host={approval.host}>
              <LockScreen
                onUnlock={(payload) => {
                  unlock(payload)
                  setPhase("ready")
                }}
              />
            </UnlockPanel>
          )}

          {(phase === "ready" || phase === "done") && approval && (
            <ConnectApprovalModal
              approval={approval}
              onDone={handleDone}
              compact={false}
            />
          )}
        </section>
      </main>

      {/* ─── footer ─── */}
      <footer className="absolute inset-x-0 bottom-0 z-20">
        <div className="mx-auto h-px max-w-[1280px] bg-gradient-to-r from-transparent via-ink/10 to-transparent" />
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-6 md:px-10 py-4 text-[10px] tracking-[0.35em] uppercase text-ink/40">
          <span>© Menoid · AI-native smart wallet</span>
          <span className="hidden md:inline">This window closes automatically</span>
        </div>
      </footer>

      <style>{`
        @keyframes connOrb1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(24px,-16px) scale(1.08)} }
        @keyframes connOrb2 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-20px,18px) scale(1.05)} }
      `}</style>
    </div>
  )
}

/* ─── pieces ─── */

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
      <p className="font-serif italic text-[13px] text-ink/45">Preparing your wallet…</p>
    </div>
  )
}

function UnlockPanel({ host, children }: { host: string; children: React.ReactNode }) {
  return (
    <div className="animate-revealUp" style={{ animationDelay: "0.2s" }}>
      <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-2xl"
        style={{
          background: "rgba(232,174,58,0.12)",
          border: "1px solid rgba(232,174,58,0.3)",
          backdropFilter: "blur(16px)",
          boxShadow: "0 8px 28px -10px rgba(163,110,20,0.3)",
        }}>
        <span style={{ fontSize: 18 }}>🔒</span>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold truncate" style={{ color: "#A36E14" }}>
            Unlock to review {host}
          </p>
          <p className="text-[11px]" style={{ color: "rgba(163,110,20,0.7)" }}>
            Your wallet is locked
          </p>
        </div>
      </div>
      {/* The LockScreen is fixed-width (360px) wallet chrome; we frame it as a
          rounded glass panel so it sits cleanly inside the web column. */}
      <div className="rounded-[28px] overflow-hidden mx-auto w-[360px] max-w-full"
        style={{
          border: "1px solid rgba(23,19,17,0.08)",
          boxShadow: "0 30px 70px -28px rgba(92,58,33,0.4)",
        }}>
        {children}
      </div>
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1 w-1 rounded-full bg-goldDeep/70" />
      <span>{children}</span>
    </span>
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

export default function ConnectTab() {
  return (
    <WalletProvider>
      <PoolProvider>
        <ConnectInner />
      </PoolProvider>
    </WalletProvider>
  )
}