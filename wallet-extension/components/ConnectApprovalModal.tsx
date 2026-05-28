/**
 * ConnectApprovalModal.tsx — Liquid iOS Edition v3
 *
 * Rebuilt to match WalletHome's design language 1:1:
 *   - Full crossfading Backdrop (open ⇄ noid) using 700ms opacity layers,
 *     floating gold orbs, paper grain, and a diagonal sheen — identical to
 *     WalletHome's <Backdrop>.
 *   - Unified COLOR_TRANSITION (500ms) on EVERY coloured element, so
 *     switching modes glides instead of snapping.
 *   - The body content morphs between Open/Noid via <LiquidMorph> (same
 *     spring + blur + scale used by WalletHome's tab/mode morph) so the
 *     cards don't pop in statically.
 *   - The Open-mode "preview card" now uses the SAME dark treasury gradient
 *     as OpenModeView, and the Noid card uses the same cream gradient as
 *     NoidModeView — and BOTH are driven by the active theme so the colours
 *     always suit the background.
 *   - ShipSlider preserved (exact behaviour from SendModal) but recoloured
 *     through theme tokens.
 *
 * New `compact` prop:
 *   - compact = true  (default) → fills its parent (the 360px popup / sidebar)
 *   - compact = false           → centred glass "card" sized for the website
 *                                 tab (connect.html). Fully responsive.
 *
 * Wiring is unchanged: MENOID_APPROVE / MENOID_REJECT messages, selected
 * noid account piped into WalletContext.
 */

import React, { useCallback, useEffect, useRef, useState } from "react"
import { useWallet } from "../context/WalletContext"
import { usePool } from "../context/PoolContext"
import { readNoidAccountNames } from "../lib/noidAccountNames"
import type { NoidSmartAccount } from "../context/PoolContext"

import shipImg from "../assets/ship/ship.png"

// ─── Unified animation tokens (copied from WalletHome) ────────────────────
const COLOR_TRANSITION =
  "color 500ms cubic-bezier(0.65, 0, 0.35, 1), background 500ms cubic-bezier(0.65, 0, 0.35, 1), border-color 500ms cubic-bezier(0.65, 0, 0.35, 1), box-shadow 500ms cubic-bezier(0.65, 0, 0.35, 1)"
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)"
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)"

interface PendingApproval {
  host: string
  origin: string
  favicon: string
  tabId: number
}

interface Props {
  approval: PendingApproval
  onDone: () => void
  /**
   * compact = true  → fills parent (popup / sidebar, 360px).
   * compact = false → centred responsive card for the website tab.
   */
  compact?: boolean
}

// ── Liquid Press wrapper ──────────────────────────────────────────────────
function LiquidPress({
  children, onClick, disabled = false, className = "", style = {},
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const [pressed, setPressed] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      className={className}
      style={{
        transform: pressed ? "scale(0.94)" : "scale(1)",
        transition: `transform 400ms ${SPRING}`,
        ...style,
      }}>
      {children}
    </button>
  )
}

/* ───────────────────────── Liquid Morph ─────────────────────────
   Identical behaviour to WalletHome's LiquidMorph: exits the old
   content (blur + scale down + fade) then springs the new content in. */
function LiquidMorph({ keyId, children }: { keyId: string; children: React.ReactNode }) {
  const [current, setCurrent] = useState({ key: keyId, content: children })
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    if (keyId !== current.key) {
      setExiting(true)
      const t = setTimeout(() => {
        setCurrent({ key: keyId, content: children })
        setExiting(false)
      }, 240)
      return () => clearTimeout(t)
    } else {
      setCurrent({ key: keyId, content: children })
    }
  }, [keyId, children, current.key])

  return (
    <div
      style={{
        opacity: exiting ? 0 : 1,
        transform: exiting ? "scale(0.96) translateY(8px)" : "scale(1) translateY(0)",
        filter: exiting ? "blur(8px)" : "blur(0)",
        transition: exiting ? `all 240ms ${EASE}` : `all 520ms ${SPRING}`,
      }}>
      {current.content}
    </div>
  )
}

/* ───────────────────────── Crossfading Backdrop ─────────────────────────
   Same construction as WalletHome's <Backdrop>: two full-bleed gradient
   layers that crossfade on `isNoid`, plus floating orbs, sheen, grain. */
function Backdrop({ isNoid }: { isNoid: boolean }) {
  return (
    <>
      {/* Always-opaque solid base. The two gradient layers below crossfade on
          mode switch; mid-crossfade their combined opacity can dip, so this
          solid layer guarantees nothing behind (e.g. WalletHome) shows
          through. Its colour itself transitions, matching the active mode. */}
      <div
        className="absolute inset-0"
        style={{
          background: isNoid ? "#0D0A07" : "#FBF1D9",
          transition: `background 700ms ${EASE}`,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          opacity: isNoid ? 0 : 1,
          backgroundImage: "linear-gradient(160deg, #FBF1D9 0%, #F4E7CC 55%, #EAD5A7 100%)",
          transition: `opacity 700ms ${EASE}`,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          opacity: isNoid ? 1 : 0,
          backgroundImage: "linear-gradient(160deg, #1A1410 0%, #0D0A07 60%, #171311 100%)",
          transition: `opacity 700ms ${EASE}`,
        }}
      />
      {/* Floating orbs */}
      <div
        className="pointer-events-none absolute"
        style={{
          top: "-18%", right: "-12%", width: 240, height: 240, borderRadius: "50%",
          background: isNoid
            ? "radial-gradient(circle, rgba(232,174,58,0.22) 0%, transparent 60%)"
            : "radial-gradient(circle, rgba(232,174,58,0.28) 0%, transparent 60%)",
          filter: "blur(42px)",
          animation: "approvalOrb1 12s ease-in-out infinite",
          transition: `background 700ms ${EASE}`,
        }}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          bottom: "-15%", left: "-12%", width: 220, height: 220, borderRadius: "50%",
          background: isNoid
            ? "radial-gradient(circle, rgba(163,110,20,0.22) 0%, transparent 60%)"
            : "radial-gradient(circle, rgba(163,110,20,0.16) 0%, transparent 60%)",
          filter: "blur(50px)",
          animation: "approvalOrb2 10s ease-in-out infinite 2s",
          transition: `background 700ms ${EASE}`,
        }}
      />
      {/* Grid texture */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: isNoid ? 0.03 : 0.04,
          backgroundImage: isNoid
            ? "linear-gradient(to right,#FBF1D9 1px,transparent 1px),linear-gradient(to bottom,#FBF1D9 1px,transparent 1px)"
            : "linear-gradient(to right,#171311 1px,transparent 1px),linear-gradient(to bottom,#171311 1px,transparent 1px)",
          backgroundSize: "28px 28px",
          transition: `opacity 700ms ${EASE}`,
        }}
      />
      {/* Sheen */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: 0.22,
          background: "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.12) 50%, transparent 70%)",
          animation: "approvalSheen 7s ease-in-out infinite",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 paper-grain"
        style={{ opacity: isNoid ? 0.08 : 0.2, transition: `opacity 700ms ${EASE}` }}
      />
    </>
  )
}

// ── ShipSlider (exact behaviour from SendModal, theme-aware colours) ──────
function ShipSlider({
  canSubmit, disabled, isNoid, onCommit,
}: {
  canSubmit: boolean
  disabled: boolean
  isNoid: boolean
  onCommit: () => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const dragStartX = useRef(0)
  const dragStartProgress = useRef(0)
  const committed = useRef(false)
  const [phase, setPhase] = useState<"idle" | "submitting" | "success">("idle")

  const THUMB_W = 52
  const COMMIT_THRESHOLD = 0.88

  const isDisabled = disabled || !canSubmit || phase === "submitting" || phase === "success"

  useEffect(() => {
    if (!disabled) {
      committed.current = false
      setProgress(0)
      setDragging(false)
      setPhase("idle")
    }
  }, [disabled])

  function getTrackWidth() { return trackRef.current?.clientWidth ?? 280 }
  function clampP(raw: number) { return Math.max(0, Math.min(1, raw)) }

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (isDisabled || committed.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    dragStartX.current = e.clientX
    dragStartProgress.current = progress
  }, [isDisabled, progress])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || isDisabled || committed.current) return
    const travelW = getTrackWidth() - THUMB_W
    const delta = e.clientX - dragStartX.current
    const newP = clampP(dragStartProgress.current + delta / travelW)
    setProgress(newP)
    if (newP >= COMMIT_THRESHOLD && !committed.current) {
      committed.current = true
      setProgress(1)
      setDragging(false)
      setPhase("submitting")
      onCommit()
    }
  }, [dragging, isDisabled, onCommit])

  const onPointerUp = useCallback(() => {
    if (!dragging) return
    setDragging(false)
    if (!committed.current) setProgress(0)
  }, [dragging])

  const travelW = Math.max(1, (trackRef.current?.clientWidth ?? 280) - THUMB_W)
  const thumbX = progress * travelW

  let fillColor = isNoid ? "rgba(251,241,217,0.08)" : "rgba(23,19,17,0.08)"
  let shipFilter = "none"
  if (phase === "submitting") {
    fillColor = "rgba(218,162,28,0.22)"
    shipFilter = "drop-shadow(0 0 6px rgba(218,162,28,0.6))"
  } else if (phase === "success") {
    fillColor = "rgba(5,150,105,0.18)"
  } else if (canSubmit && progress > 0) {
    fillColor = `rgba(218,162,28,${0.08 + progress * 0.18})`
  }

  let fillExtra = 0
  let trackLabel = ""
  if (disabled)                    { trackLabel = isNoid ? "Coming soon · Noid mode" : "Select a wallet" }
  else if (phase === "submitting") { trackLabel = "Connecting…"; fillExtra = 9999 }
  else if (phase === "success")    { trackLabel = "Connected! ⚓"; fillExtra = 9999 }
  else if (!canSubmit)             { trackLabel = "Fill in details" }
  else if (progress > 0.55)        { trackLabel = "Release to connect!" }
  else                             { trackLabel = "Drag ship to connect →" }

  const labelColor = phase === "success"
    ? "rgba(5,150,105,0.8)"
    : phase === "submitting"
    ? "rgba(180,130,10,0.9)"
    : isNoid ? "rgba(251,241,217,0.45)" : "rgba(23,19,17,0.45)"

  return (
    <div
      ref={trackRef}
      style={{
        position: "relative", width: "100%", height: 56, borderRadius: 28,
        border: phase === "success"
          ? "1.5px solid rgba(5,150,105,0.35)"
          : canSubmit && !disabled
          ? "1.5px solid rgba(218,162,28,0.4)"
          : isNoid ? "1.5px solid rgba(251,241,217,0.15)" : "1.5px solid rgba(23,19,17,0.12)",
        background: phase === "success"
          ? "rgba(5,150,105,0.10)"
          : canSubmit && !disabled
          ? "rgba(218,162,28,0.07)"
          : isNoid ? "rgba(251,241,217,0.05)" : "rgba(23,19,17,0.05)",
        overflow: "hidden",
        cursor: isDisabled ? "not-allowed" : "default",
        userSelect: "none",
        transition: `border-color 500ms ${EASE}, background 500ms ${EASE}`,
      }}
    >
      {/* Wave fill */}
      <div style={{
        position: "absolute", inset: 0,
        background: fillColor,
        width: `${thumbX + fillExtra + 26 + THUMB_W / 2}px`,
        borderRadius: "inherit",
        transition: dragging ? "none" : "width 0.4s cubic-bezier(0.22,1,0.36,1), background 0.4s",
        pointerEvents: "none",
      }} />

      {/* Ocean wave SVG */}
      <svg style={{
        position: "absolute", bottom: 0, left: 0, width: "100%", height: 18,
        opacity: phase === "submitting" ? 0.45 : (canSubmit && !disabled) ? 0.18 : 0.07,
        pointerEvents: "none", transition: "opacity 0.5s",
      }} viewBox="0 0 280 18" preserveAspectRatio="none">
        <path d="M0 12 Q35 4 70 12 Q105 20 140 12 Q175 4 210 12 Q245 20 280 12 L280 18 L0 18 Z" fill="#1a6b8a">
          {phase === "submitting" && (
            <animateTransform attributeName="transform" type="translate"
              from="0 0" to="-70 0" dur="1.2s" repeatCount="indefinite" />
          )}
        </path>
      </svg>

      {/* Track label */}
      <div style={{
        position: "absolute", inset: 0, display: "flex",
        alignItems: "center", justifyContent: "center",
        pointerEvents: "none",
        paddingLeft: (phase === "success" || phase === "submitting") ? 16 : thumbX + THUMB_W + 4,
        paddingRight: 16,
        transition: "padding-left 0.1s",
      }}>
        <span style={{
          fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase",
          color: labelColor, fontWeight: 600, whiteSpace: "nowrap", transition: "color 0.3s",
        }}>{trackLabel}</span>
      </div>

      {/* Ship thumb */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: "absolute", top: "50%",
          left: phase === "submitting" ? "50%" : thumbX,
          transform: phase === "submitting" ? "translate(-50%,-50%)" : "translateY(-50%)",
          width: THUMB_W, height: THUMB_W,
          cursor: isDisabled ? "not-allowed" : dragging ? "grabbing" : "grab",
          transition: phase === "submitting"
            ? "left 0.6s cubic-bezier(0.22,1,0.36,1), transform 0.6s cubic-bezier(0.22,1,0.36,1)"
            : dragging ? "none" : "left 0.4s cubic-bezier(0.22,1,0.36,1)",
          filter: shipFilter,
          display: "flex", alignItems: "center", justifyContent: "center",
          touchAction: "none", zIndex: 2,
        }}>
        <img
          src={shipImg}
          alt="Drag to connect"
          draggable={false}
          style={{
            width: 46, height: 46,
            objectFit: "contain", pointerEvents: "none",
            opacity: isDisabled && phase === "idle" ? 0.3 : 1,
            transition: "opacity 0.3s",
            transform: dragging ? "scale(1.07) translateY(-2px)" : "scale(1)",
            animation: phase === "submitting"
              ? "shipSail 1.4s ease-in-out infinite"
              : dragging ? "none" : "shipFloat 3s ease-in-out infinite",
          }}
        />
      </div>
    </div>
  )
}

// ── Main Modal ─────────────────────────────────────────────────────────────
export default function ConnectApprovalModal({ approval, onDone, compact = true }: Props) {
  const { wallets, entries, activeIndex, setSelectedNoidAccount, pendingNoidAccount } = useWallet()
  const { myNoidSmartAccounts } = usePool()

  const [selectedWalletIdx, setSelectedWalletIdx] = useState(activeIndex)
  const [mode, setMode] = useState<"open" | "noid">("open")
  const [selectedNoidIdx, setSelectedNoidIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [noidNames, setNoidNames] = useState<Record<string, string>>({})

  useEffect(() => { requestAnimationFrame(() => setMounted(true)) }, [])
  useEffect(() => { readNoidAccountNames().then(setNoidNames).catch(() => {}) }, [])

  const accounts: NoidSmartAccount[] = (() => {
    const confirmed = new Set(myNoidSmartAccounts.map((a) => a.commitment))
    const pending = pendingNoidAccount && !confirmed.has(pendingNoidAccount.commitment)
      ? pendingNoidAccount : null
    return pending ? [pending, ...myNoidSmartAccounts] : myNoidSmartAccounts
  })()

  const wallet = wallets[selectedWalletIdx]
  const entry = entries[selectedWalletIdx]

  const exposedAddress = mode === "open"
    ? wallet?.normalAccount?.address ?? ""
    : accounts[selectedNoidIdx]?.account ?? wallet?.normalAccount?.address ?? ""

  const isNoid = mode === "noid"

  function trunc(s: string, a = 6, b = 4) {
    if (!s) return "—"
    return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
  }

  async function handleApprove() {
    if (!wallet || !entry || loading) return
    setLoading(true)
    try {
      const selectedNoid = mode === "noid" ? accounts[selectedNoidIdx] : null
      if (selectedNoid) setSelectedNoidAccount(selectedNoid)
      await chrome.runtime.sendMessage({
        type: "MENOID_APPROVE",
        tabId: approval.tabId,
        walletId: entry.id,
        walletName: entry.name,
        mode,
        exposedAddress,
        noidAccountCommitment: selectedNoid?.commitment ?? null,
        noidAccountName: noidNames[selectedNoid?.commitment ?? ""] ?? null,
        host: approval.host,
      })
      onDone()
    } catch (e) {
      console.error("Approval failed", e)
      setLoading(false)
    }
  }

  async function handleReject() {
    setLoading(true)
    try {
      await chrome.runtime.sendMessage({ type: "MENOID_REJECT", tabId: approval.tabId })
    } catch {}
    setLoading(false)
    onDone()
  }

  // ── Theme tokens (mirrors WalletHome) ──────────────────────────────────
  const txtPrimary  = isNoid ? "#FAF5E9" : "#171311"
  const txtMuted    = isNoid ? "rgba(250,245,233,0.55)" : "rgba(23,19,17,0.55)"
  const txtFaint    = isNoid ? "rgba(250,245,233,0.35)" : "rgba(23,19,17,0.38)"
  const goldAccent  = isNoid ? "#E8AE3A" : "#A36E14"

  // Container shell.
  //  compact      → fills the 360px popup/sidebar (own full backdrop).
  //  non-compact  → a glass "request panel" that lives inside connect.html's
  //                 web layout. The PAGE supplies the ambient backdrop; this
  //                 panel only paints its own surface so it reads as part of
  //                 a website, not a phone wallet floating on a page.
  const shellClass = compact
    ? "fixed inset-0 z-[100] flex flex-col overflow-hidden font-body"
    : "relative w-full flex flex-col overflow-hidden font-body rounded-[28px]"

  const panelSurface = isNoid
    ? "linear-gradient(165deg, rgba(26,20,16,0.92) 0%, rgba(13,10,7,0.96) 100%)"
    : "linear-gradient(165deg, rgba(255,251,240,0.86) 0%, rgba(244,231,204,0.9) 100%)"

  const shellStyle: React.CSSProperties = compact
    ? {
        color: txtPrimary,
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(24px)",
        transition: `opacity 350ms ${EASE}, transform 400ms ${SPRING}, ${COLOR_TRANSITION}`,
      }
    : {
        color: txtPrimary,
        background: panelSurface,
        backdropFilter: "blur(28px) saturate(160%)",
        WebkitBackdropFilter: "blur(28px) saturate(160%)",
        maxHeight: "min(760px, 88vh)",
        border: isNoid ? "1px solid rgba(250,245,233,0.1)" : "1px solid rgba(23,19,17,0.08)",
        boxShadow: isNoid
          ? "0 40px 90px -28px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.05)"
          : "0 40px 90px -28px rgba(92,58,33,0.45), inset 0 1px 0 rgba(255,255,255,0.7)",
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0) scale(1)" : "translateY(24px) scale(0.97)",
        transition: `opacity 450ms ${EASE}, transform 550ms ${SPRING}, ${COLOR_TRANSITION}`,
      }

  return (
    <div className={shellClass} style={shellStyle}>
      {/* Full crossfading backdrop only in compact mode. In web (non-compact)
          mode the page owns the ambient backdrop; the panel keeps just its
          glass surface so it blends into the website. We still render a slim
          decorative orb layer for life. */}
      {compact ? (
        <Backdrop isNoid={isNoid} />
      ) : (
        <>
          <div className="pointer-events-none absolute" style={{
            top: "-30%", right: "-12%", width: 220, height: 220, borderRadius: "50%",
            background: isNoid
              ? "radial-gradient(circle, rgba(232,174,58,0.18) 0%, transparent 62%)"
              : "radial-gradient(circle, rgba(232,174,58,0.22) 0%, transparent 62%)",
            filter: "blur(42px)", animation: "approvalOrb1 12s ease-in-out infinite",
            transition: `background 700ms ${EASE}`,
          }} />
          <div className="pointer-events-none absolute inset-0 paper-grain"
            style={{ opacity: isNoid ? 0.06 : 0.14, transition: `opacity 700ms ${EASE}` }} />
        </>
      )}

      {/* ── Header ── */}
      <div className="shrink-0 px-5 pt-5 pb-3 relative z-10 flex flex-col items-center gap-2">
        {approval.favicon ? (
          <img src={approval.favicon} alt="" className="h-11 w-11 rounded-2xl"
            style={{
              border: isNoid ? "1px solid rgba(232,174,58,0.3)" : "1px solid rgba(23,19,17,0.14)",
              boxShadow: isNoid ? "0 4px 16px rgba(0,0,0,0.3)" : "0 4px 16px rgba(23,19,17,0.1)",
              transition: COLOR_TRANSITION,
            }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl text-xl"
            style={{
              background: isNoid ? "rgba(232,174,58,0.1)" : "rgba(163,110,20,0.1)",
              border: isNoid ? "1px solid rgba(232,174,58,0.25)" : "1px solid rgba(163,110,20,0.2)",
              transition: COLOR_TRANSITION,
            }}>🌐</div>
        )}
        <div className="text-center">
          <p className="text-[9px] tracking-[0.45em] uppercase mb-0.5"
            style={{ color: isNoid ? "rgba(232,174,58,0.6)" : "rgba(163,110,20,0.7)", transition: COLOR_TRANSITION }}>
            Connection Request
          </p>
          <p className="font-display font-bold text-[18px] tracking-tight"
            style={{ color: txtPrimary, transition: COLOR_TRANSITION }}>
            {approval.host}
          </p>
          <p className="text-[11px] mt-0.5"
            style={{ color: txtFaint, transition: COLOR_TRANSITION }}>
            wants to connect to your wallet
          </p>
        </div>
      </div>

      {/* ── Mode toggle (sliding pill, like WalletHome's LiquidModePill) ── */}
      <div className="shrink-0 px-5 pb-3 relative z-10">
        <div
          className="relative flex rounded-2xl p-1"
          style={{
            background: isNoid ? "rgba(250,245,233,0.06)" : "rgba(23,19,17,0.05)",
            border: isNoid ? "1px solid rgba(250,245,233,0.1)" : "1px solid rgba(23,19,17,0.08)",
            boxShadow: isNoid ? "inset 0 1px 0 rgba(255,255,255,0.05)" : "inset 0 1px 0 rgba(255,255,255,0.6)",
            transition: COLOR_TRANSITION,
          }}>
          {/* sliding blob */}
          <span
            style={{
              position: "absolute",
              top: 4, bottom: 4,
              left: mode === "open" ? 4 : "calc(50% + 2px)",
              width: "calc(50% - 6px)",
              borderRadius: 12,
              background: isNoid
                ? "linear-gradient(135deg, #E8AE3A 0%, #DAA21C 100%)"
                : "linear-gradient(135deg, #171311 0%, #2A211C 100%)",
              boxShadow: isNoid
                ? "0 2px 8px rgba(232,174,58,0.35), inset 0 1px 0 rgba(255,255,255,0.4)"
                : "0 2px 8px rgba(23,19,17,0.4), inset 0 1px 0 rgba(255,255,255,0.1)",
              transition: `left 600ms ${SPRING}, background 500ms ${EASE}, box-shadow 500ms ${EASE}`,
            }}
          />
          {(["open", "noid"] as const).map((m) => {
            const active = mode === m
            const noidDisabled = m === "noid" && accounts.length === 0
            return (
              <button key={m}
                onClick={() => { if (!noidDisabled) setMode(m) }}
                disabled={noidDisabled}
                className="relative z-10 flex-1 py-2 rounded-xl text-[11px] tracking-[0.2em] uppercase font-semibold disabled:opacity-35"
                style={{
                  color: active
                    ? (m === "open" ? "#FAF5E9" : "#171311")
                    : txtMuted,
                  transition: `color 400ms ${EASE}`,
                }}>
                {m === "open" ? "◈ Open" : "◉ Noid"}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Scrollable body (morphs on mode switch) ── */}
      <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-3 relative z-10"
        style={{ WebkitOverflowScrolling: "touch" }}>

        {/* Wallet selector (shared across modes — colours transition) */}
        <div>
          <p className="text-[9px] tracking-[0.4em] uppercase mb-2"
            style={{ color: txtFaint, transition: COLOR_TRANSITION }}>
            Account
          </p>
          <div className="space-y-1.5">
            {entries.map((e, i) => {
              const w = wallets[i]
              if (!w) return null
              const sel = i === selectedWalletIdx
              return (
                <LiquidPress key={e.id} onClick={() => setSelectedWalletIdx(i)}
                  className="w-full text-left flex items-center gap-3 p-3 rounded-2xl"
                  style={{
                    background: sel
                      ? isNoid ? "rgba(232,174,58,0.12)" : "rgba(23,19,17,0.08)"
                      : isNoid ? "rgba(251,241,217,0.03)" : "rgba(23,19,17,0.03)",
                    border: sel
                      ? isNoid ? "1px solid rgba(232,174,58,0.35)" : "1px solid rgba(23,19,17,0.18)"
                      : isNoid ? "1px solid rgba(251,241,217,0.07)" : "1px solid rgba(23,19,17,0.07)",
                    boxShadow: sel
                      ? isNoid ? "inset 0 1px 0 rgba(255,255,255,0.05)" : "inset 0 1px 0 rgba(255,255,255,0.5)"
                      : "none",
                    transition: COLOR_TRANSITION,
                  }}>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl font-bold text-[12px]"
                    style={{
                      background: sel ? "#E8AE3A" : isNoid ? "rgba(251,241,217,0.08)" : "rgba(23,19,17,0.07)",
                      color: sel ? "#171311" : txtMuted,
                      border: sel ? "none" : isNoid ? "1px solid rgba(251,241,217,0.1)" : "1px solid rgba(23,19,17,0.1)",
                      transition: COLOR_TRANSITION,
                    }}>{i + 1}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold truncate"
                      style={{ color: txtPrimary, transition: COLOR_TRANSITION }}>
                      {e.name}
                    </p>
                    <p className="text-[10px] font-mono"
                      style={{ color: txtFaint, transition: COLOR_TRANSITION }}>
                      {trunc(w.normalAccount.address)}
                    </p>
                  </div>
                  {sel && (
                    <div className="h-5 w-5 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "#E8AE3A" }}>
                      <svg width="9" height="9" viewBox="0 0 8 8" fill="none">
                        <path d="M1.5 4L3.5 6L6.5 2.5" stroke="#171311" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </LiquidPress>
              )
            })}
          </div>
        </div>

        {/* Mode-specific content morphs in/out */}
        <LiquidMorph keyId={mode}>
          {mode === "open" && wallet ? (
            <div>
              <p className="text-[9px] tracking-[0.4em] uppercase mb-2"
                style={{ color: txtFaint }}>
                Open Account
              </p>
              {/* Dark treasury card — same gradient as OpenModeView hero */}
              <div className="relative rounded-2xl overflow-hidden p-4"
                style={{
                  background: "linear-gradient(145deg, #1A1410 0%, #0D0A07 60%, #171311 100%)",
                  boxShadow: "0 16px 40px -12px rgba(0,0,0,0.6), 0 4px 16px rgba(232,174,58,0.08), inset 0 1px 0 rgba(251,241,217,0.08)",
                }}>
                <div className="pointer-events-none absolute" style={{
                  top: "-30%", right: "-10%", width: 120, height: 120, borderRadius: "50%",
                  background: "radial-gradient(circle,rgba(232,174,58,0.4) 0%,transparent 65%)",
                  filter: "blur(28px)", animation: "treasureOrb1 12s ease-in-out infinite",
                }} />
                <div className="pointer-events-none absolute inset-0 opacity-[0.025]" style={{
                  backgroundImage: "linear-gradient(to right,#FBF1D9 1px,transparent 1px),linear-gradient(to bottom,#FBF1D9 1px,transparent 1px)",
                  backgroundSize: "24px 24px",
                }} />
                <div className="pointer-events-none absolute inset-0 paper-grain opacity-[0.12]" />
                <div className="relative">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                      style={{ boxShadow: "0 0 8px rgba(16,185,129,0.6)", animation: "liquidPulseDot 2.4s ease-in-out infinite" }} />
                    <span className="text-[8px] tracking-[0.45em] uppercase" style={{ color: "rgba(251,241,217,0.3)" }}>Monad · Open Mode</span>
                  </div>
                  <p className="text-[8px] tracking-[0.45em] uppercase mb-1.5 mt-3" style={{ color: "rgba(251,241,217,0.3)" }}>Wallet Address</p>
                  <p className="font-mono text-[13px] font-semibold" style={{ color: "rgba(251,241,217,0.85)" }}>
                    {trunc(wallet.normalAccount.address, 10, 8)}
                  </p>
                  <p className="text-[10px] mt-2" style={{ color: "rgba(251,241,217,0.35)" }}>
                    This address will be visible to {approval.host}
                  </p>
                </div>
              </div>
            </div>
          ) : mode === "noid" ? (
            <>
              {/* Cream treasury card — same gradient as NoidModeView */}
              <div>
                <p className="text-[9px] tracking-[0.4em] uppercase mb-2" style={{ color: txtFaint }}>
                  Noid Smart Account
                </p>
                <div className="relative rounded-2xl overflow-hidden p-4"
                  style={{
                    background: "linear-gradient(145deg,#FBF1D9 0%,#F0E0B6 55%,#EAD5A7 100%)",
                    boxShadow: "0 16px 40px -12px rgba(163,110,20,0.35), 0 4px 16px rgba(232,174,58,0.18), inset 0 1px 0 rgba(255,255,255,0.7)",
                  }}>
                  <div className="pointer-events-none absolute" style={{
                    top: "-25%", right: "-15%", width: 120, height: 120, borderRadius: "50%",
                    background: "radial-gradient(circle,rgba(232,174,58,0.55) 0%,transparent 65%)", filter: "blur(28px)",
                  }} />
                  <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{
                    backgroundImage: "linear-gradient(to right,#171311 1px,transparent 1px),linear-gradient(to bottom,#171311 1px,transparent 1px)",
                    backgroundSize: "24px 24px",
                  }} />
                  <div className="relative">
                    {accounts[selectedNoidIdx] ? (
                      <>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="h-1.5 w-1.5 rounded-full"
                            style={{ background: "#A36E14", boxShadow: "0 0 6px rgba(163,110,20,0.5)", animation: "noidPulseDot 2.4s ease-in-out infinite" }} />
                          <span className="text-[8px] tracking-[0.45em] uppercase" style={{ color: "rgba(23,19,17,0.38)" }}>Private · Noid Mode</span>
                        </div>
                        <p className="text-[8px] tracking-[0.4em] uppercase mt-3 mb-1" style={{ color: "rgba(163,110,20,0.65)" }}>
                          {noidNames[accounts[selectedNoidIdx].commitment] || `Shield #${selectedNoidIdx + 1}`}
                        </p>
                        <p className="font-mono text-[13px] font-semibold" style={{ color: "rgba(23,19,17,0.82)" }}>
                          {trunc(accounts[selectedNoidIdx].account, 10, 8)}
                        </p>
                        <p className="font-mono text-[9px] mt-1" style={{ color: "rgba(23,19,17,0.38)" }}>
                          cmx {accounts[selectedNoidIdx].commitment?.slice(0, 14)}…
                        </p>
                        <p className="text-[10px] mt-2" style={{ color: "rgba(23,19,17,0.42)" }}>
                          ZK-shielded — address is private to {approval.host}
                        </p>
                      </>
                    ) : (
                      <p className="text-[11px]" style={{ color: "rgba(23,19,17,0.45)" }}>No smart account selected</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Noid account list */}
              {accounts.length > 0 && (
                <div className="mt-3">
                  <p className="text-[9px] tracking-[0.4em] uppercase mb-2" style={{ color: txtFaint }}>
                    Select Smart Account
                  </p>
                  <div className="space-y-1.5">
                    {accounts.map((acc, i) => {
                      const sel = i === selectedNoidIdx
                      const accName = noidNames[acc.commitment] || `Shield #${i + 1}`
                      return (
                        <LiquidPress key={acc.commitment} onClick={() => setSelectedNoidIdx(i)}
                          className="w-full text-left flex items-center gap-3 p-3 rounded-2xl"
                          style={{
                            background: sel ? "rgba(232,174,58,0.1)" : "rgba(251,241,217,0.03)",
                            border: sel ? "1px solid rgba(232,174,58,0.3)" : "1px solid rgba(251,241,217,0.07)",
                            boxShadow: sel ? "inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 16px rgba(232,174,58,0.08)" : "none",
                          }}>
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-[11px]"
                            style={{
                              background: sel ? "rgba(232,174,58,0.2)" : "rgba(251,241,217,0.05)",
                              border: sel ? "1px solid rgba(232,174,58,0.35)" : "1px solid rgba(251,241,217,0.08)",
                              color: "#E8AE3A",
                            }}>◉</div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-semibold" style={{ color: sel ? "rgba(232,174,58,0.9)" : "rgba(251,241,217,0.75)" }}>
                              {accName}
                            </p>
                            <p className="text-[10px] font-mono" style={{ color: "rgba(251,241,217,0.32)" }}>
                              {trunc(acc.account, 8, 6)}
                            </p>
                          </div>
                          {sel && (
                            <div className="h-4 w-4 rounded-full flex items-center justify-center shrink-0" style={{ background: "#E8AE3A" }}>
                              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                                <path d="M1.5 4L3.5 6L6.5 2.5" stroke="#171311" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                          )}
                        </LiquidPress>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          ) : <div />}
        </LiquidMorph>

        {/* Exposed address row */}
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl"
          style={{
            background: isNoid ? "rgba(251,241,217,0.03)" : "rgba(23,19,17,0.04)",
            border: isNoid ? "1px solid rgba(251,241,217,0.07)" : "1px solid rgba(23,19,17,0.07)",
            transition: COLOR_TRANSITION,
          }}>
          <span className="text-[9px] tracking-[0.3em] uppercase shrink-0"
            style={{ color: txtFaint, transition: COLOR_TRANSITION }}>
            Expose
          </span>
          <span className="font-mono text-[11px] flex-1 truncate" style={{ color: "#E8AE3A" }}>
            {exposedAddress || "—"}
          </span>
        </div>
      </div>

      {/* ── Footer: ship slider + cancel ── */}
      <div className="shrink-0 px-5 pt-3 pb-6 relative z-10"
        style={{
          borderTop: isNoid ? "1px solid rgba(251,241,217,0.07)" : "1px solid rgba(23,19,17,0.08)",
          transition: COLOR_TRANSITION,
        }}>
        <ShipSlider
          canSubmit={!!wallet && !!entry && !loading}
          disabled={loading || !wallet || !entry || isNoid}
          isNoid={isNoid}
          onCommit={handleApprove}
        />

        {isNoid && (
          <p className="mt-2 text-center text-[10px] tracking-[0.18em]" style={{ color: txtFaint, transition: COLOR_TRANSITION }}>
            ⚓ Noid mode dapp connect · coming soon
          </p>
        )}

        <LiquidPress onClick={handleReject} disabled={loading}
          className="w-full mt-3 py-2 text-[11px] tracking-[0.25em] uppercase font-semibold disabled:opacity-30"
          style={{ color: "rgba(220,50,50,0.72)" }}>
          Cancel
        </LiquidPress>
      </div>

      <style>{`
        @keyframes approvalOrb1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-22px,15px) scale(1.1)} }
        @keyframes approvalOrb2 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(28px,-20px) scale(1.12)} }
        @keyframes approvalSheen { 0%,100%{transform:translateX(-30%)} 50%{transform:translateX(30%)} }
        @keyframes treasureOrb1 { 0%,100%{transform:translate(0,0) scale(1);opacity:1} 50%{transform:translate(-30px,20px) scale(1.15);opacity:0.7} }
        @keyframes liquidPulseDot { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.4);opacity:0.6} }
        @keyframes noidPulseDot   { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.4);opacity:0.6} }
        @keyframes shipFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes shipSail {
          0%{transform:translateY(0) rotate(-6deg) scale(1.05)}
          25%{transform:translateY(-4px) rotate(0deg) scale(1.08)}
          50%{transform:translateY(0) rotate(6deg) scale(1.05)}
          75%{transform:translateY(-4px) rotate(0deg) scale(1.08)}
          100%{transform:translateY(0) rotate(-6deg) scale(1.05)}
        }
      `}</style>
    </div>
  )
}