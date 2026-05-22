/**
 * OpenModeView.tsx
 *
 * "Open Seas" public wallet view — redesigned to match NoidModeView's
 * UI structure: hero treasury card, ruled section headers, bespoke
 * OpenActionButton components, elegant info footer.
 *
 * Palette: cream / parchment / ink / goldDeep — the warm Open mode
 * counterpart to NoidModeView's dark luxury.
 */

import React, { useCallback, useEffect, useRef, useState } from "react"
import { useWallet } from "../../context/WalletContext"
import { getBalance } from "../../lib/monadRpc"
import AnimatedNumber from "../shared/AnimatedNumber"
import ComingSoonToast from "../shared/ComingSoonToast"
import ReceiveModal from "../shared/ReceiveModal"
import SendModal from "../shared/SendModal"

const POLL_MS = 5_000

export default function OpenModeView() {
  const { wallet } = useWallet()
  const account = wallet?.normalAccount
  const noidAccount = wallet?.noidAccount

  const [balance, setBalance] = useState<string>("0")
  const [balanceErr, setBalanceErr] = useState(false)
  const [showReceive, setShowReceive] = useState(false)
  const [showSend, setShowSend] = useState(false)
  const [showSwapToast, setShowSwapToast] = useState(false)
  const [copiedAddr, setCopiedAddr] = useState(false)
  const [copiedNoid, setCopiedNoid] = useState(false)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  const refreshBalance = useCallback(async () => {
    if (!account) return
    try {
      const b = await getBalance(account.address)
      if (!mountedRef.current) return
      setBalance(b)
      setBalanceErr(false)
    } catch (e) {
      console.error("[OpenMode] balance fetch failed:", e)
      if (mountedRef.current) setBalanceErr(true)
    } finally {
    }
  }, [account])

  useEffect(() => {
    mountedRef.current = true
    void refreshBalance()
    intervalRef.current = setInterval(() => {
      if (!document.hidden) void refreshBalance()
    }, POLL_MS)
    const onVis = () => { if (!document.hidden) void refreshBalance() }
    document.addEventListener("visibilitychange", onVis)
    return () => {
      mountedRef.current = false
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [refreshBalance])

  if (!account) return null

  function trunc(s: string, a = 9, b = 5) {
    return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
  }

  function copyAddress() {
    navigator.clipboard.writeText(account.address)
    setCopiedAddr(true)
    setTimeout(() => setCopiedAddr(false), 1500)
  }

  function copyNoidKey() {
    if (!noidAccount) return
    const joined = `${noidAccount.publicKey}|${noidAccount.zkPublicKey}`
    navigator.clipboard.writeText(joined)
    setCopiedNoid(true)
    setTimeout(() => setCopiedNoid(false), 1500)
  }

  const formatted = formatBalance(balance)

  return (
    <>
      {/* ─── HERO TREASURY CARD ─── */}
      <div className="px-4 pt-5">
        <div
          className="relative rounded-[28px] overflow-hidden"
          style={{
            background: "linear-gradient(145deg, #1A1410 0%, #0D0A07 60%, #171311 100%)",
            boxShadow: "0 24px 48px -16px rgba(0,0,0,0.8), inset 0 1px 0 rgba(251,241,217,0.06)"
          }}>
          {/* Gold glow top-right */}
          <div className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(ellipse at 90% 5%, rgba(232,174,58,0.28) 0%, transparent 50%)" }} />
          {/* Warm amber glow bottom-left */}
          <div className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(ellipse at 5% 95%, rgba(163,110,20,0.18) 0%, transparent 45%)" }} />
          {/* Fine grid texture */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage: "linear-gradient(to right,#FBF1D9 1px,transparent 1px),linear-gradient(to bottom,#FBF1D9 1px,transparent 1px)",
              backgroundSize: "28px 28px"
            }} />
          {/* Paper grain */}
          <div className="pointer-events-none absolute inset-0 paper-grain opacity-[0.12]" />

          <div className="relative px-5 pt-5 pb-4">
            {/* Top row: address + network badge */}
            <div className="flex items-start justify-between mb-6">
              <div className="min-w-0 flex-1 pr-3">
                <p className="text-[8px] tracking-[0.5em] uppercase text-bone/30 mb-1.5">
                  Wallet Address
                </p>
                <button
                  onClick={copyAddress}
                  className="flex items-center gap-2 group/addr transition-all">
                  <span className="font-mono text-[11px] text-bone/60 group-hover/addr:text-bone/90 transition-colors truncate">
                    {trunc(account.address)}
                  </span>
                  <span className={`shrink-0 transition-colors ${copiedAddr ? "text-goldDeep" : "text-bone/30 group-hover/addr:text-bone/60"}`}>
                    {copiedAddr ? (
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                        <path d="M2 6L4.5 8.5L9 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                        <rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1" />
                        <path d="M1 7.5V1.5a1 1 0 011-1h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                      </svg>
                    )}
                  </span>
                </button>
              </div>
              {/* Network badge */}
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full shrink-0"
                style={{ background: "rgba(251,241,217,0.07)", border: "1px solid rgba(251,241,217,0.1)" }}>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="text-[8px] tracking-[0.35em] uppercase text-bone/50">Monad</span>
              </div>
            </div>

            {/* Balance — the centrepiece */}
            <div className="mb-5">
              <p className="text-[8px] tracking-[0.5em] uppercase text-bone/30 mb-2">Treasure</p>
              <div className="flex items-baseline gap-2">
                <div
                  className="font-display font-bold tracking-[-0.03em] leading-none"
                  style={{ color: "#FBF1D9", textShadow: "0 0 40px rgba(232,174,58,0.15)" }}>
                  <AnimatedNumber value={formatted} height={40} className="text-[40px]" duration={650} />
                </div>
                <span className="text-[20px] font-display font-semibold text-bone/30">MON</span>
              </div>
              <p className="mt-1.5 text-[10px] text-bone/25">
                {balanceErr ? "Couldn't reach Monad RPC — retrying…" : "≈ $0.00 USD"}
              </p>
            </div>

            {/* Copy chips */}
            <div className="flex items-center gap-2">
              <button
                onClick={copyAddress}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[9px] tracking-[0.2em] uppercase transition-all ${
                  copiedAddr ? "text-goldDeep border border-goldDeep/40" : "border border-bone/[0.12] text-bone/45 hover:border-bone/25 hover:text-bone/70"
                }`}
                style={{
                  background: copiedAddr ? "rgba(232,174,58,0.1)" : "rgba(251,241,217,0.04)"
                }}>
                {copiedAddr
                  ? <svg width="9" height="9" viewBox="0 0 11 11" fill="none"><path d="M2 6L4.5 8.5L9 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  : <svg width="9" height="9" viewBox="0 0 11 11" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1" /><path d="M1 7.5V1.5a1 1 0 011-1h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" /></svg>
                }
                <span>{copiedAddr ? "Copied" : "Open addr"}</span>
              </button>

              <button
                onClick={copyNoidKey}
                disabled={!noidAccount}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[9px] tracking-[0.2em] uppercase transition-all disabled:opacity-40 ${
                  copiedNoid ? "text-goldDeep border border-goldDeep/40" : "border border-bone/[0.12] text-bone/45 hover:border-bone/25 hover:text-bone/70"
                }`}
                style={{
                  background: copiedNoid ? "rgba(232,174,58,0.1)" : "rgba(251,241,217,0.04)"
                }}>
                {copiedNoid
                  ? <svg width="9" height="9" viewBox="0 0 11 11" fill="none"><path d="M2 6L4.5 8.5L9 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  : <svg width="9" height="9" viewBox="0 0 11 11" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1" /><path d="M1 7.5V1.5a1 1 0 011-1h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" /></svg>
                }
                <span>{copiedNoid ? "Copied" : "Noid key"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── WALLET ACTIONS ─── */}
      <div className="px-4 mt-4">
        {/* Ruled section header */}
        <div className="flex items-center gap-2 mb-2">
          <div style={{ height: "1px", flex: 1, background: "rgba(23,19,17,0.08)" }} />
          <p className="text-[8px] tracking-[0.5em] uppercase text-ink/35 shrink-0">Wallet</p>
          <div style={{ height: "1px", flex: 1, background: "rgba(23,19,17,0.08)" }} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <OpenActionButton
            icon={<SendIcon />}
            label="Send"
            sublabel="Transfer MON"
            compact
            onClick={() => setShowSend(true)}
          />
          <OpenActionButton
            icon={<ReceiveIcon />}
            label="Receive"
            sublabel="Show address"
            compact
            onClick={() => setShowReceive(true)}
          />
          <OpenActionButton
            icon={<SwapIcon />}
            label="Swap"
            sublabel="Exchange"
            compact
            muted
            onClick={() => setShowSwapToast(true)}
          />
        </div>
      </div>

      {/* ─── SHIP'S LOG ─── */}
      <div className="px-4 mt-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <div style={{ height: "1px", flex: 1, background: "rgba(23,19,17,0.08)" }} />
          <p className="text-[8px] tracking-[0.5em] uppercase text-ink/35 shrink-0">Ship's Log</p>
          <div style={{ height: "1px", flex: 1, background: "rgba(23,19,17,0.08)" }} />
        </div>

        {/* Info footer card */}
        <div
          className="relative rounded-2xl overflow-hidden px-4 py-3.5"
          style={{
            background: "linear-gradient(135deg, rgba(23,19,17,0.03) 0%, rgba(163,110,20,0.05) 100%)",
            border: "1px solid rgba(23,19,17,0.07)"
          }}>
          <div className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(ellipse at 5% 0%, rgba(232,174,58,0.18) 0%, transparent 50%)" }} />
          <div className="relative flex items-start gap-3">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "rgba(163,110,20,0.12)", border: "1px solid rgba(163,110,20,0.2)" }}>
              <span className="text-base">📜</span>
            </div>
            <div className="min-w-0">
              <p className="text-[9px] tracking-[0.35em] uppercase text-goldDeep/70 mb-1">
                Open Seas
              </p>
              <p className="text-[11px] leading-relaxed text-ink/50">
                Transaction history is coming soon. Activity will appear here once the Monad indexer is wired up.
              </p>
            </div>
          </div>
        </div>
      </div>

      <ReceiveModal
        open={showReceive}
        onClose={() => setShowReceive(false)}
        mode="open"
        address={account.address}
      />
      <SendModal
        open={showSend}
        onClose={() => setShowSend(false)}
        fromAddress={account.address}
        privateKey={account.privateKey}
        balance={balance}
        onSent={() => { void refreshBalance() }}
      />
      <ComingSoonToast
        show={showSwapToast}
        onDone={() => setShowSwapToast(false)}
      />
    </>
  )
}

/* ─── Open mode action button — cream/parchment counterpart of NoidActionButton ─── */

function OpenActionButton({
  icon, label, sublabel, onClick, muted, compact
}: {
  icon: React.ReactNode
  label: string
  sublabel: string
  onClick: () => void
  muted?: boolean
  compact?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-2xl text-left transition-all duration-200 hover:-translate-y-[2px]"
      style={{
        padding: compact ? "10px 12px 10px" : "14px 14px 12px",
        background: muted
          ? "rgba(23,19,17,0.03)"
          : "linear-gradient(145deg, rgba(23,19,17,0.06) 0%, rgba(163,110,20,0.05) 100%)",
        border: muted
          ? "1px solid rgba(23,19,17,0.06)"
          : "1px solid rgba(163,110,20,0.18)",
        boxShadow: "none"
      }}
      onMouseEnter={(e) => {
        if (!muted) {
          (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px -8px rgba(163,110,20,0.2)"
          ;(e.currentTarget as HTMLElement).style.borderColor = "rgba(163,110,20,0.35)"
        }
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.boxShadow = "none"
        ;(e.currentTarget as HTMLElement).style.borderColor = muted ? "rgba(23,19,17,0.06)" : "rgba(163,110,20,0.18)"
      }}>
      {/* Hover shimmer */}
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(163,110,20,0.1) 0%, transparent 70%)" }} />

      <div className="relative">
        <div
          className={`flex items-center justify-center rounded-xl mb-2 ${compact ? "h-7 w-7" : "h-9 w-9"}`}
          style={{
            background: muted ? "rgba(23,19,17,0.04)" : "rgba(163,110,20,0.12)",
            border: muted ? "1px solid rgba(23,19,17,0.07)" : "1px solid rgba(163,110,20,0.22)"
          }}>
          <span style={{ color: muted ? "rgba(23,19,17,0.3)" : "#A36E14" }}>
            {icon}
          </span>
        </div>
        <p
          className={`font-display font-bold tracking-[-0.01em] leading-none ${compact ? "text-[11px]" : "text-[13px]"}`}
          style={{ color: muted ? "rgba(23,19,17,0.35)" : "rgba(23,19,17,0.8)" }}>
          {label}
        </p>
        {!compact && (
          <p className="text-[9px] mt-0.5 tracking-[0.1em]" style={{ color: "rgba(23,19,17,0.3)" }}>
            {sublabel}
          </p>
        )}
      </div>
    </button>
  )
}

/* ─── SVG icons ─── */

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
      <path d="M4 14L14 4M14 4H7M14 4V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ReceiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
      <path d="M14 4L4 14M4 14H11M4 14V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SwapIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 18" fill="none">
      <path d="M3 6H15M15 6L12 3M15 6L12 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 12H5M5 12L8 9M5 12L8 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Format a wei-as-decimal-string into a stable digit-count UI string. */
function formatBalance(b: string): string {
  const n = Number(b)
  if (!Number.isFinite(n) || n === 0) return "0.0000"
  if (n < 0.0001) return n.toFixed(6)
  return n.toFixed(4)
}