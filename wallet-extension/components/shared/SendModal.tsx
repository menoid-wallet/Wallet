/**
 * SendModal.tsx (Open mode only)
 *
 * Layout (form phase):
 *   ┌─────────────────────────────┐  ← fullscreen sheet, no drag
 *   │  drag bar (decorative only) │
 *   │  header                     │
 *   │  ┌─ scrollable area ──────┐ │
 *   │  │  ship_send.png         │ │
 *   │  │  Menoid contacts       │ │
 *   │  │  recipient input       │ │
 *   │  │  amount input          │ │
 *   │  │  from row              │ │
 *   │  │  error message         │ │
 *   │  └────────────────────────┘ │
 *   │  ─── fixed footer ───────── │
 *   │  ship slider                │
 *   │  voyage hint                │
 *   └─────────────────────────────┘
 *
 * Success phase: normal partial sheet, ship_reached.png, full Done button,
 *   small "View on explorer" text link below.
 *
 * Images are preloaded at module level — no loading state needed.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { isAddress } from "ethers"
import { explorerTxUrl, sendNative } from "../../lib/monadRpc"
import { useThemeTokens } from "../../lib/useThemeTokens"
import { listOpenUsers, type OpenUser } from "../../services/users"
import LiquidSheet from "./LiquidSheet"
import shipImg      from "../../assets/ship/ship.png"
import shipSendImg  from "../../assets/ship/ship_send.png"
import shipReachedImg from "../../assets/ship/reached_ship.png"

// ── Preload images so they're in cache before the modal opens ──────────────
;[shipSendImg, shipReachedImg].forEach((src) => {
  const img = new Image()
  img.src = src
})

interface Props {
  open: boolean
  onClose: () => void
  fromAddress: string
  privateKey: string
  balance: string
  onSent?: (hash: string) => void
}

type Phase       = "form" | "submitting" | "success" | "error"
type AmountStatus = "" | "ok" | "over" | "bad"
type AddrStatus   = "" | "ok" | "bad"

// ─── Ship Slider ──────────────────────────────────────────────────────────────
interface ShipSliderProps {
  canSubmit: boolean
  phase: Phase
  onCommit: () => void
  isNoid: boolean
}

function ShipSlider({ canSubmit, phase, onCommit, isNoid }: ShipSliderProps) {
  const trackRef          = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const dragStartX        = useRef(0)
  const dragStartProgress = useRef(0)
  const committed         = useRef(false)

  const THUMB_W          = 52
  const COMMIT_THRESHOLD = 0.88

  const disabled = !canSubmit || phase === "submitting" || phase === "success"

  useEffect(() => {
    if (phase === "form") {
      committed.current = false
      setProgress(0)
      setDragging(false)
    }
  }, [phase])

  function getTrackWidth() { return trackRef.current?.clientWidth ?? 280 }
  function clampP(raw: number) { return Math.max(0, Math.min(1, raw)) }

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled || committed.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    dragStartX.current       = e.clientX
    dragStartProgress.current = progress
  }, [disabled, progress])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || disabled || committed.current) return
    const travelW   = getTrackWidth() - THUMB_W
    const delta     = e.clientX - dragStartX.current
    const newProgress = clampP(dragStartProgress.current + delta / travelW)
    setProgress(newProgress)
    if (newProgress >= COMMIT_THRESHOLD && !committed.current) {
      committed.current = true
      setProgress(1)
      setDragging(false)
      onCommit()
    }
  }, [dragging, disabled, onCommit])

  const onPointerUp = useCallback(() => {
    if (!dragging) return
    setDragging(false)
    if (!committed.current) setProgress(0)
  }, [dragging])

  const travelW  = Math.max(1, (trackRef.current?.clientWidth ?? 280) - THUMB_W)
  const thumbX   = progress * travelW

  let fillColor  = isNoid ? "rgba(251,241,217,0.08)" : "rgba(23,19,17,0.08)"
  let shipFilter = "none"
  if (phase === "submitting") {
    fillColor  = "rgba(218,162,28,0.22)"
    shipFilter = "drop-shadow(0 0 6px rgba(218,162,28,0.6))"
  } else if (phase === "success") {
    fillColor = "rgba(5,150,105,0.18)"
  } else if (canSubmit && progress > 0) {
    fillColor = `rgba(218,162,28,${0.08 + progress * 0.18})`
  }

  let fillExtra = 0
  let trackLabel = ""
  if      (phase === "submitting") { trackLabel = "Voyage in progress…"; fillExtra = 9999 }
  else if (phase === "success")    { trackLabel = "Ship has reached port!"; fillExtra = 9999 }
  else if (!canSubmit)             { trackLabel = "Fill in details to sail" }
  else if (progress > 0.55)        { trackLabel = "Release to send!" }
  else                             { trackLabel = "Drag ship to send →" }

  const labelColor = phase === "success"
    ? "rgba(5,150,105,0.8)"
    : phase === "submitting"
    ? "rgba(180,130,10,0.9)"
    : isNoid
    ? "rgba(251,241,217,0.45)"
    : "rgba(23,19,17,0.45)"

  return (
    <div
      ref={trackRef}
      style={{
        position: "relative",
        width: "100%",
        height: 56,
        borderRadius: 28,
        border: phase === "success"
          ? "1.5px solid rgba(5,150,105,0.35)"
          : canSubmit
          ? "1.5px solid rgba(218,162,28,0.4)"
          : isNoid
          ? "1.5px solid rgba(251,241,217,0.15)"
          : "1.5px solid rgba(23,19,17,0.12)",
        background: phase === "success"
          ? "rgba(5,150,105,0.10)"
          : canSubmit
          ? "rgba(218,162,28,0.07)"
          : isNoid
          ? "rgba(251,241,217,0.05)"
          : "rgba(23,19,17,0.05)",
        overflow: "hidden",
        cursor: disabled ? "not-allowed" : "default",
        userSelect: "none",
        transition: "border-color 0.3s ease, background 0.3s ease",
      }}
    >
      {/* Wave fill */}
      <div style={{
        position: "absolute", inset: 0,
        background: fillColor,
        width: `${thumbX + fillExtra + 26 + THUMB_W / 2}px`,
        borderRadius: "inherit",
        transition: dragging ? "none" : "width 0.4s cubic-bezier(0.22,1,0.36,1), background 0.4s ease",
        pointerEvents: "none",
      }} />

      {/* Ocean wave SVG */}
      <svg
        style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 18,
          opacity: phase === "submitting" ? 0.45 : canSubmit ? 0.18 : 0.07,
          pointerEvents: "none", transition: "opacity 0.5s" }}
        viewBox="0 0 280 18" preserveAspectRatio="none"
      >
        <path d="M0 12 Q35 4 70 12 Q105 20 140 12 Q175 4 210 12 Q245 20 280 12 L280 18 L0 18 Z" fill="#1a6b8a">
          {phase === "submitting" && (
            <animateTransform
              attributeName="transform"
              type="translate"
              from="0 0"
              to="-70 0"
              dur="1.2s"
              repeatCount="indefinite"
            />
          )}
        </path>
        {/* second wave tile for seamless scroll */}
        {phase === "submitting" && (
          <path d="M280 12 Q315 4 350 12 Q385 20 420 12 Q455 4 490 12 Q525 20 560 12 L560 18 L280 18 Z" fill="#1a6b8a">
            <animateTransform
              attributeName="transform"
              type="translate"
              from="0 0"
              to="-70 0"
              dur="1.2s"
              repeatCount="indefinite"
            />
          </path>
        )}
      </svg>

      {/* Track label */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        pointerEvents: "none",
        paddingLeft:  (phase === "success" || phase === "submitting") ? 16 : thumbX + THUMB_W + 4,
        paddingRight: (phase === "success" || phase === "submitting") ? 16 : 16,
        transition: "padding-left 0.1s",
      }}>
        <span style={{
          fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase",
          color: labelColor, fontWeight: 600, whiteSpace: "nowrap", transition: "color 0.3s",
        }}>
          {trackLabel}
        </span>
      </div>

      {/* Ship thumb — floats when idle, sails to center when submitting */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: "absolute", top: "50%",
          ...(phase === "success"
            ? { right: 2, left: "auto", transform: "translateY(-50%)" }
            : phase === "submitting"
            ? { left: "50%", transform: "translate(-50%, -50%)" }
            : { left: thumbX, right: "auto", transform: "translateY(-50%)" }),
          width: THUMB_W, height: THUMB_W,
          cursor: disabled ? "not-allowed" : phase === "submitting" ? "wait" : dragging ? "grabbing" : "grab",
          transition: phase === "submitting"
            ? "left 0.6s cubic-bezier(0.22,1,0.36,1), transform 0.6s cubic-bezier(0.22,1,0.36,1), filter 0.3s"
            : dragging ? "none" : "left 0.4s cubic-bezier(0.22,1,0.36,1), filter 0.3s",
          filter: shipFilter,
          display: "flex", alignItems: "center", justifyContent: "center",
          touchAction: "none", zIndex: 2,
        }}
      >
        <img
          src={shipImg}
          alt="Drag to send"
          draggable={false}
          style={{
            width: 46, height: 46,
            objectFit: "contain", pointerEvents: "none",
            opacity: disabled && phase !== "submitting" && phase !== "success" ? 0.35 : 1,
            transition: "opacity 0.3s",
            transform: dragging ? "scale(1.07) translateY(-2px)" : "scale(1)",
            animation: phase === "submitting"
              ? "shipSail 1.4s ease-in-out infinite"
              : dragging
              ? "none"
              : "shipFloat 3s ease-in-out infinite",
          }}
        />
      </div>

      <style>{`
        @keyframes shipFloat {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-5px); }
        }
        @keyframes shipSail {
          0%   { transform: translateY(0px)   rotate(-6deg) scale(1.05); }
          25%  { transform: translateY(-4px)  rotate(0deg)  scale(1.08); }
          50%  { transform: translateY(0px)   rotate(6deg)  scale(1.05); }
          75%  { transform: translateY(-4px)  rotate(0deg)  scale(1.08); }
          100% { transform: translateY(0px)   rotate(-6deg) scale(1.05); }
        }
      `}</style>
    </div>
  )
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export default function SendModal({ open, onClose, fromAddress, privateKey, balance, onSent }: Props) {
  const tokens = useThemeTokens()

  const [phase,     setPhase]     = useState<Phase>("form")
  const [to,        setTo]        = useState("")
  const [amount,    setAmount]    = useState("")
  const [submitErr, setSubmitErr] = useState("")
  const [txHash,    setTxHash]    = useState("")

  const [users,        setUsers]        = useState<OpenUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersErr,     setUsersErr]     = useState<string | null>(null)
  const [pickedUser,   setPickedUser]   = useState<string | null>(null)

  // Load contacts when modal opens
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setUsersLoading(true)
    setUsersErr(null)
    listOpenUsers()
      .then((list) => {
        if (cancelled) return
        const lower = (fromAddress ?? "").toLowerCase()
        setUsers(list.filter((u) => (u.realAddress ?? "").toLowerCase() !== lower))
      })
      .catch((e) => { if (!cancelled) setUsersErr(e?.message ?? "Failed to load users") })
      .finally(() => { if (!cancelled) setUsersLoading(false) })
    return () => { cancelled = true }
  }, [open, fromAddress])

  // Reset form after LiquidSheet exit animation
  useEffect(() => {
    if (open) return
    const t = setTimeout(() => {
      setPhase("form"); setTo(""); setAmount("")
      setSubmitErr(""); setTxHash(""); setPickedUser(null)
    }, 320)
    return () => clearTimeout(t)
  }, [open])

  // Live validation
  const addrStatus: AddrStatus = useMemo(() => {
    const v = to.trim(); if (!v) return ""
    return isAddress(v) ? "ok" : "bad"
  }, [to])

  const amountStatus: AmountStatus = useMemo(() => {
    const v = amount.trim(); if (!v) return ""
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return "bad"
    const bal = Number(balance)
    if (Number.isFinite(bal) && n > bal) return "over"
    return "ok"
  }, [amount, balance])

  const canSubmit = addrStatus === "ok" && amountStatus === "ok"

  async function handleSend() {
    if (!canSubmit) return
    setSubmitErr(""); setPhase("submitting")
    try {
      const r = await sendNative(privateKey, to.trim(), amount.trim())
      setTxHash(r.hash); setPhase("success")
      onSent?.(r.hash)
      r.wait().catch(() => {})
    } catch (e: any) {
      console.error("[SendModal] send failed:", e)
      setSubmitErr(e?.shortMessage ?? e?.message ?? "Transaction failed. Try again.")
      setPhase("error")
    }
  }

  function setMax() {
    const num = Number(balance)
    if (!Number.isFinite(num) || num <= 0) { setAmount("0"); return }
    const max = Math.max(0, num - 0.001)
    setAmount(max.toFixed(6).replace(/\.?0+$/, ""))
  }

  const isSuccess = phase === "success"
  const tone      = tokens.isNoid ? "ink" : "cream"

  return (
    <LiquidSheet
      open={open}
      onClose={onClose}
      tone={tone}
      disableDrag={phase === "submitting"}   // hides X + blocks backdrop during tx
      lockDrag={!isSuccess}                  // grab handle completely dead during form
      defaultFullscreen={!isSuccess}         // fullscreen for form, partial for success
    >
      {isSuccess ? (
        /* ════════════════════════ SUCCESS (partial sheet) ════════════════════ */
        <div className="relative">
          {/* Header */}
          <div className="px-6 pt-2 pb-2 text-center">
            <p className="text-[9px] tracking-[0.45em] uppercase text-goldDeep mb-1">Send Treasure</p>
            <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]">Ship has docked! ⚓</h3>
            <p className={`mt-1 text-[11px] leading-snug ${tokens.isNoid ? "text-bone/65" : "text-ink/55"}`}>
              Your treasure was delivered to the port.
            </p>
          </div>

          <div className="px-6 pt-4 pb-6 flex flex-col items-center">
            {/* ship_reached.png */}
            <img
              src={shipReachedImg}
              alt="Ship reached port"
              style={{ width: "100%", maxWidth: 350, objectFit: "contain", marginBottom: 20 , borderRadius: "15px",overflow: "hidden"}}
            />

            {/* Tx card */}
            <div className="w-full rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-4 flex items-start gap-3 mb-5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 7L5.5 10.5L12 4" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-emerald-700">Transaction broadcast</p>
                <p className={`font-mono text-[10px] mt-1 break-all ${tokens.isNoid ? "text-bone/60" : "text-ink/60"}`}>
                  {txHash}
                </p>
              </div>
            </div>

            {/* Full-width Done button */}
            <button
              onClick={onClose}
              className={`w-full rounded-xl py-3 text-[11px] tracking-[0.25em] uppercase hover:-translate-y-[1px] transition
                ${tokens.isNoid ? "bg-bone text-ink" : "bg-ink text-bone"}`}
            >
              Done
            </button>

            {/* Small text link */}
            <a
              href={explorerTxUrl(txHash)}
              target="_blank"
              rel="noreferrer"
              className={`mt-3 text-[10px] tracking-[0.2em] uppercase transition-opacity hover:opacity-60
                ${tokens.isNoid ? "text-bone/45" : "text-ink/45"}`}
            >
              View on explorer
            </a>
          </div>
        </div>

      ) : (
        /* ══════════════════════════ FORM (fullscreen) ════════════════════════ */
        <div className="flex flex-col h-full">

          {/* Header — fixed, never scrolls */}
          <div className="shrink-0 px-6 pt-2 pb-2 text-center">
            <p className="text-[9px] tracking-[0.45em] uppercase text-goldDeep mb-1">Send Treasure</p>
            <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]">
              {phase === "error" ? "Storm rolled in." : "Send MON"}
            </h3>
            <p className={`mt-1 text-[11px] leading-snug ${tokens.isNoid ? "text-bone/65" : "text-ink/55"}`}>
              Balance: {Number(balance).toFixed(4)} MON
            </p>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto no-scrollbar px-6 pt-2 pb-2 space-y-4">

            {/* ship_send.png — always shown immediately (preloaded), no spinner */}
            <div className="w-full flex justify-center py-2">
              <img
                src={shipSendImg}
                alt="Send"
                style={{ width: "85%", maxWidth: 280, objectFit: "contain" }}
              />
            </div>

            {/* Menoid contacts */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={`block text-[9px] tracking-[0.3em] uppercase ${tokens.isNoid ? "text-bone/55" : "text-ink/50"}`}>
                  Menoid contacts
                </label>
              </div>
              {usersErr ? (
                <p className={`text-[10px] p-2 rounded-lg ${tokens.isNoid
                  ? "bg-bone/[0.04] border border-bone/15 text-bone/55"
                  : "bg-ink/[0.04] border border-ink/10 text-ink/55"}`}>
                  Couldn&apos;t load contacts — paste an address manually.
                </p>
              ) : users.length === 0 && !usersLoading ? (
                <p className={`text-[10px] p-2 rounded-lg ${tokens.isNoid
                  ? "bg-bone/[0.04] border border-bone/15 text-bone/55"
                  : "bg-ink/[0.04] border border-ink/10 text-ink/55"}`}>
                  No other Menoid users yet. Paste an address below.
                </p>
              ) : usersLoading ? (
                /* Contacts loading — small inline skeleton, doesn't expand the UI much */
                <div className="flex gap-2 pb-1">
                  {[1,2,3].map((i) => (
                    <div key={i} className={`shrink-0 w-20 h-[44px] rounded-xl animate-pulse
                      ${tokens.isNoid ? "bg-bone/[0.08]" : "bg-ink/[0.06]"}`} />
                  ))}
                </div>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "thin" }}>
                  {users.map((u) => {
                    const picked = pickedUser === u._id
                    return (
                      <button
                        key={u._id}
                        onClick={() => { setTo(u.realAddress); setPickedUser(u._id) }}
                        disabled={phase === "submitting"}
                        className={`shrink-0 text-left px-3 py-2 rounded-xl border transition-colors disabled:opacity-50 ${
                          picked
                            ? "bg-goldDeep/[0.18] border-goldDeep/45 text-goldDeep"
                            : tokens.isNoid
                              ? "bg-bone/[0.05] border-bone/15 text-bone/75 hover:border-bone/30"
                              : "bg-ink/[0.04] border-ink/10 text-ink/70 hover:border-ink/25"
                        }`}
                      >
                        <p className="font-display text-[11px] font-semibold leading-tight">{u.name}</p>
                        <p className="font-mono text-[9px] mt-0.5 opacity-70">
                          {u.realAddress.slice(0, 6)}…{u.realAddress.slice(-4)}
                        </p>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Recipient */}
            <div>
              <label className={`block text-[9px] tracking-[0.3em] uppercase mb-1.5 ${tokens.isNoid ? "text-bone/55" : "text-ink/50"}`}>
                Recipient address
              </label>
              <input
                value={to}
                onChange={(e) => { setTo(e.target.value); setPickedUser(null) }}
                disabled={phase === "submitting"}
                placeholder="0x…"
                className={`w-full rounded-xl border px-3 py-2.5 text-[12px] font-mono focus:outline-none transition-colors disabled:opacity-50
                  ${tokens.isNoid ? "bg-bone/[0.06] placeholder-bone/30 text-bone" : "bg-ink/[0.05] placeholder-ink/30 text-ink"}
                  ${addrStatus === "bad"   ? "border-red-500/40 focus:border-red-500/60"
                  : addrStatus === "ok"    ? "border-emerald-500/30 focus:border-emerald-500/60"
                  : tokens.isNoid          ? "border-bone/15 focus:border-gold/60"
                  :                          "border-ink/12 focus:border-goldDeep/60"}`}
              />
              {addrStatus === "bad" && <p className="mt-1 text-[10px] text-red-600">Not a valid address.</p>}
            </div>

            {/* Amount */}
            <div>
              <div className="flex items-end justify-between mb-1.5">
                <label className={`block text-[9px] tracking-[0.3em] uppercase ${tokens.isNoid ? "text-bone/55" : "text-ink/50"}`}>
                  Amount (MON)
                </label>
                <button onClick={setMax} disabled={phase === "submitting"}
                  className="text-[9px] tracking-[0.3em] uppercase text-goldDeep hover:text-goldDeeper transition-colors disabled:opacity-50">
                  Max
                </button>
              </div>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={phase === "submitting"}
                placeholder="0.00"
                inputMode="decimal"
                className={`w-full rounded-xl border px-3 py-2.5 text-[14px] font-mono focus:outline-none transition-colors disabled:opacity-50
                  ${tokens.isNoid ? "bg-bone/[0.06] placeholder-bone/30 text-bone" : "bg-ink/[0.05] placeholder-ink/30 text-ink"}
                  ${amountStatus === "bad" || amountStatus === "over" ? "border-red-500/40 focus:border-red-500/60"
                  : amountStatus === "ok" ? "border-emerald-500/30 focus:border-emerald-500/60"
                  : tokens.isNoid         ? "border-bone/15 focus:border-gold/60"
                  :                         "border-ink/12 focus:border-goldDeep/60"}`}
              />
              {amountStatus === "bad" && <p className="mt-1 text-[10px] text-red-600">Enter a positive number.</p>}
              {amountStatus === "over" && (
                <p className="mt-1 text-[10px] text-red-600 flex items-center gap-1.5">
                  <span className="inline-block h-1 w-1 rounded-full bg-red-500" />
                  Exceeds balance ({Number(balance).toFixed(4)} MON available).
                </p>
              )}
            </div>

            {/* From row */}
            <div className={`flex items-center justify-between p-2.5 rounded-xl ${tokens.card}`}>
              <span className={`text-[10px] tracking-[0.3em] uppercase ${tokens.isNoid ? "text-bone/55" : "text-ink/50"}`}>From</span>
              <span className={`font-mono text-[11px] ${tokens.isNoid ? "text-bone/75" : "text-ink/70"}`}>
                {fromAddress.slice(0, 6)}…{fromAddress.slice(-4)}
              </span>
            </div>

            {submitErr && (
              <p className="text-[11px] text-red-600 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
                {submitErr}
              </p>
            )}

            {/* Bottom padding so last item isn't hidden behind footer */}
            <div style={{ height: 8 }} />
          </div>

          {/* ── Fixed footer: slider + hint ── */}
          <div className="shrink-0 px-6 pt-3 pb-6"
            style={{
              borderTop: tokens.isNoid ? "1px solid rgba(251,241,217,0.08)" : "1px solid rgba(23,19,17,0.07)",
            }}
          >
            <ShipSlider
              canSubmit={canSubmit}
              phase={phase}
              onCommit={handleSend}
              isNoid={tokens.isNoid}
            />
            {phase === "error" && !submitErr && (
              <p className="mt-2 text-center text-[10px] text-red-600">The seas were rough. Try again.</p>
            )}
          </div>

        </div>
      )}
    </LiquidSheet>
  )
}