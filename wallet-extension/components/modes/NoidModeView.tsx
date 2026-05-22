/**
 * NoidModeView.tsx
 *
 * Completely redesigned "shadow waters" private wallet view.
 *
 * Design language: Dark luxury. Deep ink backgrounds with warm gold
 * accents. Glassmorphism cards. Elegant serif typography. Subtle grain.
 * Every element feels premium and intentional.
 */

import React, { useCallback, useEffect, useRef, useState } from "react"
import { useWallet } from "../../context/WalletContext"
import { usePool } from "../../context/PoolContext"
import { getBalance } from "../../lib/monadRpc"
import ActionTile from "../shared/ActionTile"
import AnimatedNumber from "../shared/AnimatedNumber"
import ComingSoonToast from "../shared/ComingSoonToast"
import MaskModal from "../shared/MaskModal"
import ReceiveModal from "../shared/ReceiveModal"
import NoidSendModal from "~components/shared/NoidSendModal"

const OPEN_BALANCE_POLL_MS = 8_000

export default function NoidModeView() {
  const { wallet } = useWallet()
  const noid = wallet?.noidAccount
  const normal = wallet?.normalAccount

  const { formattedBalance, syncing, lastSyncedAt, allUnspentUTXOs, error: poolError } = usePool()

  const [openBalance, setOpenBalance] = useState<string>("0")
  const [showReceive, setShowReceive] = useState(false)
  const [showMask, setShowMask] = useState(false)
  const [showSend, setShowSend] = useState(false)
  const [toast, setToast] = useState<{ show: boolean; msg?: string }>({ show: false })
  const [copiedNoid, setCopiedNoid] = useState(false)
  const [copiedOpen, setCopiedOpen] = useState(false)
  const mountedRef = useRef(true)

  const refreshOpenBalance = useCallback(async () => {
    if (!normal) return
    try {
      const b = await getBalance(normal.address)
      if (mountedRef.current) setOpenBalance(b)
    } catch {}
  }, [normal])

  useEffect(() => {
    mountedRef.current = true
    void refreshOpenBalance()
    const id = setInterval(() => { if (!document.hidden) void refreshOpenBalance() }, OPEN_BALANCE_POLL_MS)
    return () => { mountedRef.current = false; clearInterval(id) }
  }, [refreshOpenBalance])

  if (!noid) return null

  const joinedKey = `${noid.publicKey}|${noid.zkPublicKey ?? ""}`

  function copyJoined() {
    navigator.clipboard.writeText(joinedKey)
    setCopiedNoid(true)
    setTimeout(() => setCopiedNoid(false), 1500)
  }

  function copyOpenAddress() {
    if (!normal) return
    navigator.clipboard.writeText(normal.address)
    setCopiedOpen(true)
    setTimeout(() => setCopiedOpen(false), 1500)
  }

  function truncKey(k: string): string {
    return k.length > 16 ? `${k.slice(0, 9)}…${k.slice(-5)}` : k
  }

  function syncedLabel(): string {
    if (!lastSyncedAt) return "Awaiting sync"
    const sec = Math.max(1, Math.round((Date.now() - lastSyncedAt) / 1000))
    if (sec < 60) return `${sec}s ago`
    return `${Math.round(sec / 60)}m ago`
  }

  const [, forceTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      {/* ─── HERO TREASURY CARD ─── */}
      <div className="px-4 pt-5">
        <div className="relative rounded-[28px] overflow-hidden"
          style={{
            background: "linear-gradient(145deg, #FBF1D9 0%, #F0E0B6 55%, #EAD5A7 100%)",
            boxShadow: "0 20px 48px -16px rgba(163,110,20,0.3), inset 0 1px 0 rgba(255,255,255,0.7)"
          }}>
          {/* Gold glow top-right */}
          <div className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(ellipse at 88% 8%, rgba(232,174,58,0.45) 0%, transparent 50%)" }} />
          {/* Subtle glow bottom-left */}
          <div className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(ellipse at 5% 90%, rgba(163,110,20,0.2) 0%, transparent 45%)" }} />
          {/* Fine grid texture */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{ backgroundImage: "linear-gradient(to right,#171311 1px,transparent 1px),linear-gradient(to bottom,#171311 1px,transparent 1px)", backgroundSize: "28px 28px" }} />
          {/* Paper grain */}
          <div className="pointer-events-none absolute inset-0 paper-grain opacity-[0.3]" />

          <div className="relative px-5 pt-5 pb-4">
            {/* Top row: key + network badge */}
            <div className="flex items-start justify-between mb-6">
              <div className="min-w-0 flex-1 pr-3">
                <p className="text-[8px] tracking-[0.5em] uppercase text-ink/35 mb-1.5">Noid Key</p>
                <button onClick={copyJoined} title={joinedKey}
                  className="flex items-center gap-2 group/key transition-all">
                  <span className="font-mono text-[11px] text-ink/60 group-hover/key:text-ink/90 transition-colors truncate">
                    {truncKey(joinedKey)}
                  </span>
                  <span className={`shrink-0 transition-colors ${copiedNoid ? "text-goldDeep" : "text-ink/30 group-hover/key:text-ink/55"}`}>
                    {copiedNoid ? (
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
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full shrink-0"
                style={{ background: "rgba(23,19,17,0.06)", border: "1px solid rgba(23,19,17,0.1)" }}>
                <span className={`h-1.5 w-1.5 rounded-full transition-colors ${syncing ? "bg-gold animate-pulse" : "bg-goldDeep"}`} />
                <span className="text-[8px] tracking-[0.35em] uppercase text-ink/50">Private</span>
              </div>
            </div>

            {/* Balance — the centrepiece */}
            <div className="mb-5">
              <p className="text-[8px] tracking-[0.5em] uppercase text-ink/35 mb-2">Treasury</p>
              <div className="flex items-baseline gap-2">
                <div className="font-display font-bold tracking-[-0.03em] leading-none"
                  style={{ color: "#171311", textShadow: "0 0 40px rgba(163,110,20,0.2)" }}>
                  <AnimatedNumber value={formattedBalance} height={40} className="text-[40px]" duration={650} />
                </div>
                <span className="text-[20px] font-display font-semibold text-ink/30">MON</span>
              </div>
              <p className="mt-1.5 text-[10px] text-ink/30">
                {poolError ? "Couldn't reach indexer — retrying…" : (
                  <>
                    <span>{allUnspentUTXOs.length} note{allUnspentUTXOs.length !== 1 ? "s" : ""}</span>
                    <span className="mx-1.5 text-bone/15">·</span>
                    <span>Synced {syncedLabel()}</span>
                  </>
                )}
              </p>
            </div>

            {/* Copy chips */}
            <div className="flex items-center gap-2">
              <button onClick={copyOpenAddress} disabled={!normal}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[9px] tracking-[0.2em] uppercase transition-all disabled:opacity-40 ${
                  copiedOpen
                    ? "text-goldDeep border border-goldDeep/40"
                    : "border border-ink/[0.12] text-ink/45 hover:border-ink/30 hover:text-ink/75"
                }`}
                style={{ background: copiedOpen ? "rgba(163,110,20,0.12)" : "rgba(23,19,17,0.05)" }}>
                {copiedOpen
                  ? <svg width="9" height="9" viewBox="0 0 11 11" fill="none"><path d="M2 6L4.5 8.5L9 3" stroke="#A36E14" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  : <svg width="9" height="9" viewBox="0 0 11 11" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1" /><path d="M1 7.5V1.5a1 1 0 011-1h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" /></svg>
                }
                <span>{copiedOpen ? "Copied" : "Open addr"}</span>
              </button>
              <button onClick={copyJoined}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[9px] tracking-[0.2em] uppercase transition-all ${
                  copiedNoid
                    ? "text-goldDeep border border-goldDeep/40"
                    : "border border-ink/[0.12] text-ink/45 hover:border-ink/30 hover:text-ink/75"
                }`}
                style={{ background: copiedNoid ? "rgba(163,110,20,0.12)" : "rgba(23,19,17,0.05)" }}>
                {copiedNoid
                  ? <svg width="9" height="9" viewBox="0 0 11 11" fill="none"><path d="M2 6L4.5 8.5L9 3" stroke="#A36E14" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  : <svg width="9" height="9" viewBox="0 0 11 11" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1" /><path d="M1 7.5V1.5a1 1 0 011-1h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" /></svg>
                }
                <span>{copiedNoid ? "Copied" : "Noid key"}</span>
              </button>
            </div>
          </div>

          {/* ── Divider ── */}
          <div style={{ height: "1px", background: "linear-gradient(to right, transparent, rgba(23,19,17,0.08) 30%, rgba(163,110,20,0.15) 50%, rgba(23,19,17,0.08) 70%, transparent)" }} />

          {/* ── Open balance row inside card ── */}
          <div className="px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-goldDeep/60" />
              <span className="text-[9px] tracking-[0.4em] uppercase text-ink/40">Open Balance</span>
            </div>
            <span className="font-mono text-[11px] text-ink/55">{Number(openBalance).toFixed(4)} MON</span>
          </div>
        </div>
      </div>

      {/* ─── ZK OPERATIONS ─── */}
      <div className="px-4 mt-4">
        <div className="flex items-center gap-2 mb-2">
          <div style={{ height: "1px", flex: 1, background: "rgba(251,241,217,0.06)" }} />
          <p className="text-[8px] tracking-[0.5em] uppercase text-bone/30 shrink-0">ZK Operations</p>
          <div style={{ height: "1px", flex: 1, background: "rgba(251,241,217,0.06)" }} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NoidActionButton
            icon={<MaskIcon />}
            label="Mask"
            sublabel="Move to shadow"
            onClick={() => { void refreshOpenBalance(); setShowMask(true) }}
          />
          <NoidActionButton
            icon={<UnmaskIcon />}
            label="Unmask"
            sublabel="Emerge from shadow"
            onClick={() => setToast({ show: true, msg: "Unmask flow coming soon." })}
            muted
          />
        </div>
      </div>

      {/* ─── WALLET ACTIONS ─── */}
      <div className="px-4 mt-3">
        <div className="flex items-center gap-2 mb-2">
          <div style={{ height: "1px", flex: 1, background: "rgba(251,241,217,0.06)" }} />
          <p className="text-[8px] tracking-[0.5em] uppercase text-bone/30 shrink-0">Wallet</p>
          <div style={{ height: "1px", flex: 1, background: "rgba(251,241,217,0.06)" }} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <NoidActionButton
            icon={<SendIcon />}
            label="Send"
            sublabel="Transfer MON"
            compact
            onClick={() => setShowSend(true)} 
            muted
          />
          <NoidActionButton
            icon={<ReceiveIcon />}
            label="Receive"
            sublabel="Show address"
            compact
            onClick={() => setShowReceive(true)}
          />
          <NoidActionButton
            icon={<SwapIcon />}
            label="Swap"
            sublabel="Exchange"
            compact
            onClick={() => setToast({ show: true, msg: "Swap on the horizon. Coming soon." })}
            muted
          />
        </div>
      </div>

      {/* ─── PRIVATE WATERS INFO ─── */}
      <div className="px-4 mt-3 mb-6">
        <div className="relative rounded-2xl overflow-hidden px-4 py-3.5"
          style={{
            background: "linear-gradient(135deg, rgba(251,241,217,0.04) 0%, rgba(232,174,58,0.06) 100%)",
            border: "1px solid rgba(251,241,217,0.07)"
          }}>
          <div className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(ellipse at 5% 0%, rgba(232,174,58,0.15) 0%, transparent 50%)" }} />
          <div className="relative flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "rgba(163,110,20,0.2)", border: "1px solid rgba(163,110,20,0.3)" }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 1.5C5 1.5 3 3.5 3 6.2c0 1.7 1 3 1.8 3.6.4.3.7.7.7 1.2v.5c0 .8.7 1.5 1.5 1.5h4c.8 0 1.5-.7 1.5-1.5V11c0-.5.3-.9.7-1.2C13 9.2 14 7.9 14 6.2 14 3.5 11 1.5 8 1.5Z"
                  stroke="#A36E14" strokeWidth="1.2" />
                <circle cx="6" cy="6.5" r="0.8" fill="#A36E14" />
                <circle cx="10" cy="6.5" r="0.8" fill="#A36E14" />
                <path d="M7 9.5l1 1 1-1" stroke="#A36E14" strokeWidth="1" strokeLinecap="round" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-[9px] tracking-[0.35em] uppercase text-goldDeep/80 mb-1">Private Waters</p>
              <p className="text-[11px] leading-relaxed" style={{ color: "rgba(251,241,217,0.5)" }}>
                Mask MON to slip into shadow. Each note is a Poseidon commitment — only you can spend it.
              </p>
            </div>
          </div>
        </div>
      </div>
      
      <NoidSendModal open={showSend} onClose={() => setShowSend(false)} />
      <ReceiveModal open={showReceive} onClose={() => setShowReceive(false)} mode="noid" publicKey={noid.publicKey} zkPublicKey={noid.zkPublicKey} />
      <MaskModal open={showMask} onClose={() => { setShowMask(false); void refreshOpenBalance() }} openBalance={openBalance} />
      <ComingSoonToast show={toast.show} onDone={() => setToast({ show: false })} message={toast.msg} />
    </>
  )
}

/* ─── Elegant Noid action button ─── */

function NoidActionButton({
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
      className="group relative overflow-hidden rounded-2xl text-left transition-all duration-250 hover:-translate-y-[2px]"
      style={{
        padding: compact ? "10px 12px 10px" : "14px 14px 12px",
        background: muted
          ? "rgba(251,241,217,0.03)"
          : "linear-gradient(145deg, rgba(251,241,217,0.07) 0%, rgba(232,174,58,0.05) 100%)",
        border: muted
          ? "1px solid rgba(251,241,217,0.06)"
          : "1px solid rgba(232,174,58,0.18)",
        boxShadow: muted ? "none" : "0 0 0 0 rgba(232,174,58,0)"
      }}
      onMouseEnter={(e) => {
        if (!muted) {
          (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px -8px rgba(232,174,58,0.25)"
          ;(e.currentTarget as HTMLElement).style.borderColor = "rgba(232,174,58,0.35)"
        }
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.boxShadow = "none"
        ;(e.currentTarget as HTMLElement).style.borderColor = muted ? "rgba(251,241,217,0.06)" : "rgba(232,174,58,0.18)"
      }}
    >
      {/* Hover shimmer */}
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(232,174,58,0.12) 0%, transparent 70%)" }} />

      <div className="relative">
        <div className={`flex items-center justify-center rounded-xl mb-2 ${compact ? "h-7 w-7" : "h-9 w-9"}`}
          style={{
            background: muted ? "rgba(251,241,217,0.05)" : "rgba(232,174,58,0.15)",
            border: muted ? "1px solid rgba(251,241,217,0.08)" : "1px solid rgba(232,174,58,0.25)"
          }}>
          <span style={{ color: muted ? "rgba(251,241,217,0.35)" : "#A36E14" }}>{icon}</span>
        </div>
        <p className={`font-display font-bold tracking-[-0.01em] leading-none ${compact ? "text-[11px]" : "text-[13px]"}`}
          style={{ color: muted ? "rgba(251,241,217,0.45)" : "rgba(251,241,217,0.85)" }}>
          {label}
        </p>
        {!compact && (
          <p className="text-[9px] mt-0.5 tracking-[0.1em]" style={{ color: "rgba(251,241,217,0.25)" }}>
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

function MaskIcon() {
  return (
    <svg width="18" height="14" viewBox="0 0 20 14" fill="none">
      <path d="M2 6 Q4 2 7 2 Q9 2 10 4 Q11 2 13 2 Q16 2 18 6 Q17 11 13 11 Q11 11 10 9 Q9 11 7 11 Q3 11 2 6 Z"
        fill="currentColor" opacity="0.9" />
      <circle cx="6.5" cy="6.5" r="1.1" fill="rgba(163,110,20,0.9)" />
      <circle cx="13.5" cy="6.5" r="1.1" fill="rgba(163,110,20,0.9)" />
    </svg>
  )
}

function UnmaskIcon() {
  return (
    <svg width="18" height="14" viewBox="0 0 20 14" fill="none">
      <path d="M2 6 Q4 2 7 2 Q9 2 10 4 Q11 2 13 2 Q16 2 18 6 Q17 11 13 11 Q11 11 10 9 Q9 11 7 11 Q3 11 2 6 Z"
        fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
      <line x1="3" y1="12" x2="17" y2="2" stroke="rgba(163,110,20,0.8)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}