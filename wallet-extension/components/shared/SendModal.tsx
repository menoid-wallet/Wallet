/**
 * SendModal.tsx (Open mode only)
 *
 * Slides up from the bottom. Portalled to <body> so it covers the
 * popup's nav bars rather than being clipped by the wallet root.
 *
 * Live validation:
 *   While the user types in the amount field we compute a status:
 *     - "" → no input yet
 *     - "ok" → numeric, positive, within balance
 *     - "over" → numeric, exceeds balance (Send disabled, inline warning)
 *     - "bad" → non-numeric or non-positive
 *   The recipient field is validated the same way (isAddress).
 *   Both inline messages appear under their respective input — no need
 *   to hit Send to find out something is wrong.
 *
 * On success we call `onSent(hash)` so the parent can refresh balance.
 *
 * The send button has been replaced with a ship drag-to-send slider.
 * Users drag the ship from left to right to trigger the send action.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { isAddress } from "ethers"
import { explorerTxUrl, sendNative } from "../../lib/monadRpc"
import { useThemeTokens } from "../../lib/useThemeTokens"
import ModalPortal from "./ModalPortal"
import shipImg from "../../assets/ship/ship.png";
interface Props {
  open: boolean
  onClose: () => void
  fromAddress: string
  privateKey: string
  balance: string
  onSent?: (hash: string) => void
}

type Phase = "form" | "submitting" | "success" | "error"
type AmountStatus = "" | "ok" | "over" | "bad"
type AddrStatus = "" | "ok" | "bad"

// ─── Ship Slider ──────────────────────────────────────────────────────────────
interface ShipSliderProps {
  canSubmit: boolean
  phase: Phase
  onCommit: () => void
}

function ShipSlider({ canSubmit, phase, onCommit }: ShipSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1
  const dragStartX = useRef(0)
  const dragStartProgress = useRef(0)
  const committed = useRef(false)

  const THUMB_W = 52
  const COMMIT_THRESHOLD = 0.88

  const disabled = !canSubmit || phase === "submitting" || phase === "success"

  // Reset slider when phase returns to form
  useEffect(() => {
    if (phase === "form") {
      committed.current = false
      setProgress(0)
      setDragging(false)
    }
  }, [phase])

  function getTrackWidth() {
    return trackRef.current?.clientWidth ?? 280
  }

  function clampProgress(raw: number) {
    return Math.max(0, Math.min(1, raw))
  }

  // ── pointer events (works on touch + mouse) ──
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || committed.current) return
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(true)
      dragStartX.current = e.clientX
      dragStartProgress.current = progress
    },
    [disabled, progress]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || disabled || committed.current) return
      const trackW = getTrackWidth()
      const travelW = trackW - THUMB_W
      const delta = e.clientX - dragStartX.current
      const newProgress = clampProgress(dragStartProgress.current + delta / travelW)
      setProgress(newProgress)

      if (newProgress >= COMMIT_THRESHOLD && !committed.current) {
        committed.current = true
        setProgress(1)
        setDragging(false)
        onCommit()
      }
    },
    [dragging, disabled, onCommit]
  )

  const onPointerUp = useCallback(() => {
    if (!dragging) return
    setDragging(false)
    if (!committed.current) {
      // snap back
      setProgress(0)
    }
  }, [dragging])

  // Derived display
  const trackW = typeof window !== "undefined" ? (trackRef.current?.clientWidth ?? 280) : 280
  const travelW = Math.max(1, trackW - THUMB_W)
  const thumbX = progress * travelW

  // Wave fill color based on phase/progress
  let fillColor = "rgba(23,19,17,0.08)"
  let shipFilter = "none"
  if (phase === "submitting") {
    fillColor = "rgba(218,162,28,0.22)"
    shipFilter = "drop-shadow(0 0 6px rgba(218,162,28,0.6))"
  } else if (phase === "success") {
    fillColor = "rgba(5,150,105,0.18)"
  } else if (canSubmit && progress > 0) {
    fillColor = `rgba(218,162,28,${0.08 + progress * 0.18})`
  }

  let addional = 0;
  // Label inside track
  let trackLabel = ""
  if (phase === "submitting") trackLabel = "Hoisting sails…"
  else if (phase === "success"){
    trackLabel = "Ship has reached port!";
    addional = 270
  } 
  else if (!canSubmit) trackLabel = "Fill in details to sail"
  else if (progress > 0.55) trackLabel = "Release to send!"
  else trackLabel = "Drag ship to send →"

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: 56,
        borderRadius: 28,
        border: phase === "success"
          ? "1.5px solid rgba(5,150,105,0.35)"
          : canSubmit
          ? "1.5px solid rgba(218,162,28,0.4)"
          : "1.5px solid rgba(23,19,17,0.12)",
        background: phase === "success"
          ? "rgba(5,150,105,0.10)"
          : canSubmit
          ? "rgba(218,162,28,0.07)"
          : "rgba(23,19,17,0.05)",
        overflow: "hidden",
        cursor: disabled ? "not-allowed" : "default",
        userSelect: "none",
        transition: "border-color 0.3s ease, background 0.3s ease",
      }}
      ref={trackRef}
    >
      {/* Wave fill that grows with progress */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: fillColor,
          width: `${thumbX + addional + 26 + THUMB_W / 2}px`,
          borderRadius: "inherit",
          transition: dragging ? "none" : "width 0.4s cubic-bezier(0.22,1,0.36,1), background 0.4s ease",
          pointerEvents: "none",
        }}
      />

      {/* Ocean wave SVG decoration */}
      <svg
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "100%",
          height: 18,
          opacity: canSubmit ? 0.18 : 0.07,
          pointerEvents: "none",
          transition: "opacity 0.3s",
        }}
        viewBox="0 0 280 18"
        preserveAspectRatio="none"
      >
        <path
          d="M0 12 Q35 4 70 12 Q105 20 140 12 Q175 4 210 12 Q245 20 280 12 L280 18 L0 18 Z"
          fill="#1a6b8a"
        />
      </svg>

      {/* Track label */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          paddingLeft: phase === "success" ? 16 : thumbX + THUMB_W + 4,
          paddingRight: phase === "success" ? THUMB_W + 8 : 16,
          transition: "padding-left 0.1s",
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: phase === "success"
              ? "rgba(5,150,105,0.8)"
              : phase === "submitting"
              ? "rgba(180,130,10,0.9)"
              : "rgba(23,19,17,0.45)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            transition: "color 0.3s",
          }}
        >
          {trackLabel}
        </span>
      </div>

      {/* Ship thumb */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: "absolute",
          top: "50%",
          ...(phase === "success"
            ? { right: 2, left: "auto" }
            : { left: thumbX, right: "auto" }),
          width: THUMB_W,
          height: THUMB_W,
          transform: "translateY(-50%)",
          cursor: disabled
            ? "not-allowed"
            : phase === "submitting"
            ? "wait"
            : dragging
            ? "grabbing"
            : "grab",
          transition: dragging
            ? "none"
            : "left 0.4s cubic-bezier(0.22,1,0.36,1), filter 0.3s",
          filter: shipFilter,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          touchAction: "none",
          zIndex: 2,
        }}
      >
        {/* Ship image */}
        <img
          src={shipImg}
          alt="Drag to send"
          draggable={false}
          style={{
            width: 46,
            height: 46,
            objectFit: "contain",
            pointerEvents: "none",
            opacity: disabled && phase !== "submitting" && phase !== "success" ? 0.35 : 1,
            transition: "opacity 0.3s, transform 0.2s",
            transform: phase === "submitting"
              ? "scale(1.08)"
              : dragging
              ? "scale(1.05) translateY(-1px)"
              : "scale(1)",
            animation: phase === "submitting" ? "shipBob 1.2s ease-in-out infinite" : "none",
          }}
        />
      </div>

      <style>{`
        @keyframes shipBob {
          0%, 100% { transform: translateY(0px) scale(1.08); }
          50% { transform: translateY(-2px) scale(1.08); }
        }
      `}</style>
    </div>
  )
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export default function SendModal({
  open,
  onClose,
  fromAddress,
  privateKey,
  balance,
  onSent,
}: Props) {
  const tokens = useThemeTokens()
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<Phase>("form")
  const [to, setTo] = useState("")
  const [amount, setAmount] = useState("")
  const [submitErr, setSubmitErr] = useState("")
  const [txHash, setTxHash] = useState("")

  useEffect(() => {
    if (open) {
      setMounted(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    } else if (mounted) {
      setVisible(false)
      const t = setTimeout(() => {
        setMounted(false)
        setPhase("form")
        setTo("")
        setAmount("")
        setSubmitErr("")
        setTxHash("")
      }, 320)
      return () => clearTimeout(t)
    }
  }, [open, mounted])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  // ─── live validation ──────────────────────────────────────────────────────
  const addrStatus: AddrStatus = useMemo(() => {
    const v = to.trim()
    if (!v) return ""
    return isAddress(v) ? "ok" : "bad"
  }, [to])

  const amountStatus: AmountStatus = useMemo(() => {
    const v = amount.trim()
    if (!v) return ""
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return "bad"
    const bal = Number(balance)
    if (Number.isFinite(bal) && n > bal) return "over"
    return "ok"
  }, [amount, balance])

  const canSubmit = addrStatus === "ok" && amountStatus === "ok"

  if (!mounted) return null

  async function handleSend() {
    if (!canSubmit) return
    setSubmitErr("")
    setPhase("submitting")
    try {
      const r = await sendNative(privateKey, to.trim(), amount.trim())
      setTxHash(r.hash)
      setPhase("success")
      onSent?.(r.hash)
      r.wait().catch(() => {})
    } catch (e: any) {
      console.error("[SendModal] send failed:", e)
      setSubmitErr(
        e?.shortMessage ?? e?.message ?? "Transaction failed. Try again."
      )
      setPhase("error")
    }
  }

  function setMax() {
    const num = Number(balance)
    if (!Number.isFinite(num) || num <= 0) {
      setAmount("0")
      return
    }
    const max = Math.max(0, num - 0.001)
    setAmount(max.toFixed(6).replace(/\.?0+$/, ""))
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[2147483000] flex items-end justify-center overflow-hidden">
        <button
          aria-label="Close"
          onClick={onClose}
          className={`absolute inset-0 bg-ink/45 backdrop-blur-sm transition-opacity duration-300 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          className={`relative w-full max-w-[420px] mx-auto transition-all duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            visible
              ? "translate-y-0 opacity-100"
              : "translate-y-full opacity-0"
          }`}
        >
          <div
            className={`relative rounded-t-[28px] border border-b-0 overflow-hidden shadow-[0_-30px_60px_-20px_rgba(23,19,17,0.4)] ${
              tokens.isNoid
                ? "bg-inkSoft text-bone border-bone/15"
                : "bg-cream text-ink border-ink/15"
            }`}>
            <div className="pointer-events-none absolute inset-0 paper-grain opacity-30" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-10%,_rgba(232,174,58,0.32)_0%,_rgba(246,233,208,0)_55%)]" />

            <div className="relative flex justify-center pt-3">
              <span
                className={`h-1 w-10 rounded-full ${
                  tokens.isNoid ? "bg-bone/25" : "bg-ink/20"
                }`}
              />
            </div>

            <button
              onClick={onClose}
              aria-label="Close"
              className={`absolute top-3 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                tokens.isNoid
                  ? "bg-bone/[0.08] hover:bg-bone/[0.18] border-bone/15"
                  : "bg-ink/[0.07] hover:bg-ink/[0.14] border-ink/10"
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2 2L10 10M10 2L2 10"
                  className="ink-stroke"
                  strokeOpacity="0.7"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            <div className="relative px-6 pt-4 pb-2 text-center">
              <p className="text-[9px] tracking-[0.45em] uppercase text-goldDeep mb-1">
                Send Treasure
              </p>
              <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]">
                {phase === "success"
                  ? "Ship has docked! ⚓"
                  : phase === "error"
                  ? "Storm rolled in."
                  : "Send MON"}
              </h3>
              <p
                className={`mt-1 text-[11px] leading-snug ${
                  tokens.isNoid ? "text-bone/65" : "text-ink/55"
                }`}>
                {phase === "success"
                  ? "Your treasure was delivered to the port."
                  : `Balance: ${Number(balance).toFixed(4)} MON`}
              </p>
            </div>

            {phase === "success" ? (
              <div className="relative px-6 pt-4 pb-6">
                {/* Success ship slider (locked at full) */}
                <div className="mb-4">
                  <ShipSlider canSubmit={true} phase="success" onCommit={() => {}} />
                </div>

                <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-4 flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M2 7L5.5 10.5L12 4"
                        stroke="#059669"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-emerald-700">
                      Transaction broadcast
                    </p>
                    <p className="font-mono text-[10px] text-ink/60 mt-1 break-all">
                      {txHash}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <a
                    href={explorerTxUrl(txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className={`rounded-xl border py-3 text-[11px] tracking-[0.25em] uppercase text-center transition-colors ${
                      tokens.isNoid
                        ? "bg-bone/[0.05] border-bone/15 hover:bg-bone/[0.1] text-bone/80"
                        : "bg-ink/[0.05] border-ink/10 hover:bg-ink/[0.1] text-ink/70"
                    }`}
                  >
                    View in Explorer
                  </a>
                  <button
                    onClick={onClose}
                    className={`rounded-xl py-3 text-[11px] tracking-[0.25em] uppercase hover:-translate-y-[1px] transition ${
                      tokens.isNoid ? "bg-bone text-ink" : "bg-ink text-bone"
                    }`}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="relative px-6 pt-4 pb-6 space-y-4">
                {/* Recipient */}
                <div>
                  <label className={`block text-[9px] tracking-[0.3em] uppercase mb-1.5 ${tokens.isNoid ? "text-bone/55" : "text-ink/50"}`}>
                    Recipient address
                  </label>
                  <input
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    disabled={phase === "submitting"}
                    placeholder="0x…"
                    className={`w-full rounded-xl border px-3 py-2.5 text-[12px] font-mono focus:outline-none transition-colors disabled:opacity-50 ${
                      tokens.isNoid
                        ? "bg-bone/[0.06] placeholder-bone/30 text-bone"
                        : "bg-ink/[0.05] placeholder-ink/30 text-ink"
                    } ${
                      addrStatus === "bad"
                        ? "border-red-500/40 focus:border-red-500/60"
                        : addrStatus === "ok"
                        ? "border-emerald-500/30 focus:border-emerald-500/60"
                        : tokens.isNoid
                          ? "border-bone/15 focus:border-gold/60"
                          : "border-ink/12 focus:border-goldDeep/60"
                    }`}
                  />
                  {addrStatus === "bad" && (
                    <p className="mt-1 text-[10px] text-red-600">
                      Not a valid address.
                    </p>
                  )}
                </div>

                {/* Amount */}
                <div>
                  <div className="flex items-end justify-between mb-1.5">
                    <label className="block text-[9px] tracking-[0.3em] uppercase text-ink/50">
                      Amount (MON)
                    </label>
                    <button
                      onClick={setMax}
                      disabled={phase === "submitting"}
                      className="text-[9px] tracking-[0.3em] uppercase text-goldDeep hover:text-goldDeeper transition-colors disabled:opacity-50"
                    >
                      Max
                    </button>
                  </div>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={phase === "submitting"}
                    placeholder="0.00"
                    inputMode="decimal"
                    className={`w-full rounded-xl border px-3 py-2.5 text-[14px] font-mono focus:outline-none transition-colors disabled:opacity-50 ${
                      tokens.isNoid
                        ? "bg-bone/[0.06] placeholder-bone/30 text-bone"
                        : "bg-ink/[0.05] placeholder-ink/30 text-ink"
                    } ${
                      amountStatus === "bad" || amountStatus === "over"
                        ? "border-red-500/40 focus:border-red-500/60"
                        : amountStatus === "ok"
                        ? "border-emerald-500/30 focus:border-emerald-500/60"
                        : tokens.isNoid
                          ? "border-bone/15 focus:border-gold/60"
                          : "border-ink/12 focus:border-goldDeep/60"
                    }`}
                  />
                  {amountStatus === "bad" && (
                    <p className="mt-1 text-[10px] text-red-600">
                      Enter a positive number.
                    </p>
                  )}
                  {amountStatus === "over" && (
                    <p className="mt-1 text-[10px] text-red-600 flex items-center gap-1.5">
                      <span className="inline-block h-1 w-1 rounded-full bg-red-500" />
                      Exceeds balance ({Number(balance).toFixed(4)} MON available).
                    </p>
                  )}
                </div>

                <div
                  className={`flex items-center justify-between p-2.5 rounded-xl ${tokens.card}`}>
                  <span
                    className={`text-[10px] tracking-[0.3em] uppercase ${
                      tokens.isNoid ? "text-bone/55" : "text-ink/50"
                    }`}>
                    From
                  </span>
                  <span
                    className={`font-mono text-[11px] ${
                      tokens.isNoid ? "text-bone/75" : "text-ink/70"
                    }`}>
                    {fromAddress.slice(0, 6)}…{fromAddress.slice(-4)}
                  </span>
                </div>

                {submitErr && (
                  <p className="text-[11px] text-red-600 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
                    {submitErr}
                  </p>
                )}

                {/* ── Ship Drag-to-Send Slider ── */}
                <ShipSlider
                  canSubmit={canSubmit}
                  phase={phase}
                  onCommit={handleSend}
                />

                {/* Subtle hint below slider */}
                {phase === "submitting" && (
                  <p className="text-center text-[10px] tracking-[0.2em] uppercase text-goldDeep/70 animate-pulse">
                    Voyage in progress…
                  </p>
                )}
                {phase === "error" && !submitErr && (
                  <p className="text-center text-[10px] text-red-600">
                    The seas were rough. Try again.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}