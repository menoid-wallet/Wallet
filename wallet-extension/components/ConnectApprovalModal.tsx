/**
 * ConnectApprovalModal.tsx — Noid-Aligned Edition
 *
 * Color system now mirrors NoidModeView exactly:
 *   - Open mode: dark luxury (#171311 base, bone/cream text on dark cards)
 *   - Noid mode: cream treasury (FBF1D9 → EAD5A7 gradient, ink text)
 *   - Accent: goldDeep (#A36E14) not bright yellow — same as NoidModeView icons
 *   - Account cards: NoidModeView glass morphism style
 *   - Accounts section: scrollable when > 2 accounts (max-height + overflow-y)
 *   - Transitions: smoother, spring-based, matching NoidModeView
 */

import React, { useCallback, useEffect, useRef, useState } from "react"
import { useWallet } from "../context/WalletContext"
import { usePool } from "../context/PoolContext"
import { readNoidAccountNames } from "../lib/noidAccountNames"
import type { NoidSmartAccount } from "../context/PoolContext"

import shipImg from "../assets/ship/ship.png"

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)"
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)"
const COLOR_TRANSITION =
  "color 500ms cubic-bezier(0.65, 0, 0.35, 1), background 500ms cubic-bezier(0.65, 0, 0.35, 1), border-color 500ms cubic-bezier(0.65, 0, 0.35, 1), box-shadow 500ms cubic-bezier(0.65, 0, 0.35, 1)"

// NoidModeView palette
const GOLD_DEEP = "#A36E14"   // icon color in NoidModeView
const GOLD      = "#E8AE3A"   // subtle highlights only
const INK       = "#171311"
const BONE      = "#FBF1D9"
const CREAM_MID = "#F0E0B6"
const CREAM_LOW = "#EAD5A7"

interface PendingApproval {
  host: string
  origin: string
  favicon: string
  tabId: number
}

interface Props {
  approval: PendingApproval
  onDone: () => void
  compact?: boolean
}

// ── Liquid Press wrapper ───────────────────────────────────────────────────
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

/* ── Liquid Morph ── */
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

/* ── Crossfading Backdrop ── */
function Backdrop({ isNoid }: { isNoid: boolean }) {
  return (
    <>
      <div className="absolute inset-0" style={{
        background: isNoid ? INK : BONE,
        transition: `background 700ms ${EASE}`,
      }} />
      <div className="absolute inset-0" style={{
        opacity: isNoid ? 0 : 1,
        backgroundImage: `linear-gradient(160deg, ${BONE} 0%, #F4E7CC 55%, ${CREAM_LOW} 100%)`,
        transition: `opacity 700ms ${EASE}`,
      }} />
      <div className="absolute inset-0" style={{
        opacity: isNoid ? 1 : 0,
        backgroundImage: "linear-gradient(160deg, #1A1410 0%, #0D0A07 60%, #171311 100%)",
        transition: `opacity 700ms ${EASE}`,
      }} />
      {/* Floating orbs — same as NoidModeView */}
      <div className="pointer-events-none absolute" style={{
        top: "-18%", right: "-12%", width: 240, height: 240, borderRadius: "50%",
        background: isNoid
          ? `radial-gradient(circle, rgba(232,174,58,0.22) 0%, transparent 60%)`
          : `radial-gradient(circle, rgba(232,174,58,0.28) 0%, transparent 60%)`,
        filter: "blur(42px)",
        animation: "approvalOrb1 12s ease-in-out infinite",
        transition: `background 700ms ${EASE}`,
      }} />
      <div className="pointer-events-none absolute" style={{
        bottom: "-15%", left: "-12%", width: 220, height: 220, borderRadius: "50%",
        background: isNoid
          ? `radial-gradient(circle, rgba(163,110,20,0.22) 0%, transparent 60%)`
          : `radial-gradient(circle, rgba(163,110,20,0.16) 0%, transparent 60%)`,
        filter: "blur(50px)",
        animation: "approvalOrb2 10s ease-in-out infinite 2s",
        transition: `background 700ms ${EASE}`,
      }} />
      <div className="pointer-events-none absolute inset-0" style={{
        opacity: isNoid ? 0.03 : 0.04,
        backgroundImage: isNoid
          ? `linear-gradient(to right,${BONE} 1px,transparent 1px),linear-gradient(to bottom,${BONE} 1px,transparent 1px)`
          : `linear-gradient(to right,${INK} 1px,transparent 1px),linear-gradient(to bottom,${INK} 1px,transparent 1px)`,
        backgroundSize: "28px 28px",
        transition: `opacity 700ms ${EASE}`,
      }} />
      <div className="pointer-events-none absolute inset-0" style={{
        opacity: 0.22,
        background: "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.12) 50%, transparent 70%)",
        animation: "approvalSheen 7s ease-in-out infinite",
      }} />
      <div className="pointer-events-none absolute inset-0 paper-grain"
        style={{ opacity: isNoid ? 0.08 : 0.2, transition: `opacity 700ms ${EASE}` }} />
    </>
  )
}

// ── ShipSlider ──────────────────────────────────────────────────────────────
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

  // NoidModeView-style fill colors — no bright yellow, use goldDeep tones
  let fillColor = isNoid ? "rgba(251,241,217,0.06)" : "rgba(23,19,17,0.06)"
  let shipFilter = "none"
  if (phase === "submitting") {
    fillColor = "rgba(163,110,20,0.22)"
    shipFilter = `drop-shadow(0 0 6px rgba(163,110,20,0.5))`
  } else if (phase === "success") {
    fillColor = "rgba(5,150,105,0.18)"
  } else if (canSubmit && progress > 0) {
    fillColor = `rgba(163,110,20,${0.08 + progress * 0.16})`
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
    ? `rgba(163,110,20,0.9)`
    : isNoid ? "rgba(251,241,217,0.4)" : "rgba(23,19,17,0.4)"

  // Border/bg: NoidModeView chip style
  const trackBorder = phase === "success"
    ? "1.5px solid rgba(5,150,105,0.35)"
    : canSubmit && !disabled
    ? `1.5px solid rgba(163,110,20,0.4)`
    : isNoid ? "1.5px solid rgba(251,241,217,0.12)" : "1.5px solid rgba(23,19,17,0.1)"

  const trackBg = phase === "success"
    ? "rgba(5,150,105,0.08)"
    : canSubmit && !disabled
    ? "rgba(163,110,20,0.06)"
    : isNoid ? "rgba(251,241,217,0.04)" : "rgba(23,19,17,0.04)"

  return (
    <div ref={trackRef} style={{
      position: "relative", width: "100%", height: 56, borderRadius: 28,
      border: trackBorder,
      background: trackBg,
      overflow: "hidden",
      cursor: isDisabled ? "not-allowed" : "default",
      userSelect: "none",
      transition: `border-color 500ms ${EASE}, background 500ms ${EASE}`,
    }}>
      {/* Wave fill */}
      <div style={{
        position: "absolute", inset: 0,
        background: fillColor,
        width: `${thumbX + fillExtra + 26 + THUMB_W / 2}px`,
        borderRadius: "inherit",
        transition: dragging ? "none" : "width 0.4s cubic-bezier(0.22,1,0.36,1), background 0.4s",
        pointerEvents: "none",
      }} />

      {/* Wave SVG */}
      <svg style={{
        position: "absolute", bottom: 0, left: 0, width: "100%", height: 18,
        opacity: phase === "submitting" ? 0.45 : (canSubmit && !disabled) ? 0.15 : 0.06,
        pointerEvents: "none", transition: "opacity 0.5s",
      }} viewBox="0 0 280 18" preserveAspectRatio="none">
        <path d="M0 12 Q35 4 70 12 Q105 20 140 12 Q175 4 210 12 Q245 20 280 12 L280 18 L0 18 Z" fill="#A36E14">
          {phase === "submitting" && (
            <animateTransform attributeName="transform" type="translate"
              from="0 0" to="-70 0" dur="1.2s" repeatCount="indefinite" />
          )}
        </path>
      </svg>

      {/* Label */}
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

// ── Noid Account Item (NoidModeView-style) ──────────────────────────────────
function NoidAccountItem({
  acc, name, index, selected, isNoid, onClick
}: {
  acc: NoidSmartAccount
  name: string
  index: number
  selected: boolean
  isNoid: boolean
  onClick: () => void
}) {
  const [pressed, setPressed] = useState(false)
  const [hovering, setHovering] = useState(false)

  function trunc(s: string, a = 8, b = 6) {
    if (!s) return "—"
    return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
  }

  // Mirror NoidModeView's smart account button style
  const bg = isNoid
    ? selected
      ? "linear-gradient(145deg, rgba(232,174,58,0.10) 0%, rgba(163,110,20,0.08) 100%)"
      : "rgba(251,241,217,0.03)"
    : selected
      ? "linear-gradient(145deg, rgba(163,110,20,0.12) 0%, rgba(232,174,58,0.08) 100%)"
      : "rgba(23,19,17,0.03)"

  const border = isNoid
    ? selected ? "1px solid rgba(232,174,58,0.28)" : "1px solid rgba(251,241,217,0.07)"
    : selected ? "1px solid rgba(163,110,20,0.28)" : "1px solid rgba(23,19,17,0.08)"

  const boxShadow = selected
    ? isNoid
      ? "inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 16px rgba(232,174,58,0.1)"
      : "inset 0 1px 0 rgba(255,255,255,0.5), 0 4px 16px rgba(163,110,20,0.1)"
    : "inset 0 1px 0 rgba(255,255,255,0.04)"

  // Icon bg — mirrors NoidModeView's 4-square grid icon container
  const iconBg = isNoid
    ? selected ? "rgba(163,110,20,0.18)" : "rgba(251,241,217,0.05)"
    : selected ? "rgba(163,110,20,0.14)" : "rgba(23,19,17,0.05)"

  const iconBorder = isNoid
    ? selected ? "1px solid rgba(163,110,20,0.3)" : "1px solid rgba(251,241,217,0.08)"
    : selected ? "1px solid rgba(163,110,20,0.25)" : "1px solid rgba(23,19,17,0.08)"

  const nameColor = isNoid
    ? selected ? "rgba(232,174,58,0.9)" : "rgba(251,241,217,0.75)"
    : selected ? GOLD_DEEP : "rgba(23,19,17,0.65)"

  const addrColor = isNoid ? "rgba(251,241,217,0.35)" : "rgba(23,19,17,0.38)"
  const cmxColor  = isNoid ? "rgba(251,241,217,0.25)" : "rgba(23,19,17,0.28)"

  return (
    <button
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => { setPressed(false); setHovering(false) }}
      onPointerEnter={() => setHovering(true)}
      className="w-full text-left relative overflow-hidden rounded-2xl"
      style={{
        padding: "10px 12px",
        background: bg,
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border,
        boxShadow: hovering && !selected
          ? isNoid
            ? "inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 16px rgba(163,110,20,0.08)"
            : "inset 0 1px 0 rgba(255,255,255,0.5), 0 4px 16px rgba(23,19,17,0.06)"
          : boxShadow,
        transform: pressed ? "scale(0.97)" : hovering ? "scale(1.01)" : "scale(1)",
        transition: `all 400ms ${SPRING}`,
      }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Label above */}
          <p className="text-[8px] tracking-[0.4em] uppercase mb-1"
            style={{ color: isNoid ? "rgba(232,174,58,0.55)" : `rgba(163,110,20,0.6)` }}>
            {selected ? "Active" : `Shield #${index + 1}`}
          </p>
          {/* Name */}
          {name ? (
            <p className="font-display font-semibold text-[12px] truncate" style={{ color: nameColor }}>
              {name}
            </p>
          ) : null}
          {/* Address */}
          <p className="font-mono text-[10px] truncate"
            style={{ color: name ? addrColor : nameColor }}>
            {acc.account ? trunc(acc.account, 10, 8) : "Pending…"}
          </p>
          {/* Commitment */}
          <p className="font-mono text-[9px] mt-0.5 truncate" style={{ color: cmxColor }}>
            cmx {acc.commitment?.slice(0, 12) ?? ""}…
          </p>
        </div>

        {/* Right icon — NoidModeView 4-square or tick */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
          style={{ background: iconBg, border: iconBorder, flexShrink: 0 }}>
          {selected ? (
            // Checkmark, goldDeep stroke
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6.5L5 9L9.5 3.5" stroke={GOLD_DEEP} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            // 4-square grid like NoidModeView
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="5.5" height="5.5" rx="1.5"
                stroke={isNoid ? "rgba(251,241,217,0.3)" : "rgba(23,19,17,0.3)"} strokeWidth="1.2" />
              <rect x="8.5" y="2" width="5.5" height="5.5" rx="1.5"
                stroke={isNoid ? "rgba(251,241,217,0.3)" : "rgba(23,19,17,0.3)"} strokeWidth="1.2" />
              <rect x="2" y="8.5" width="5.5" height="5.5" rx="1.5"
                stroke={isNoid ? "rgba(251,241,217,0.3)" : "rgba(23,19,17,0.3)"} strokeWidth="1.2" />
              <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.5"
                stroke={isNoid ? "rgba(251,241,217,0.3)" : "rgba(23,19,17,0.3)"} strokeWidth="1.2" />
            </svg>
          )}
        </div>
      </div>
    </button>
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

  // ── NoidModeView-derived theme tokens ──────────────────────────────────
  // Open mode: dark card on a light cream backdrop — ink text
  // Noid mode: cream card on a dark backdrop — bone text
  const txtPrimary = isNoid ? BONE : INK
  const txtMuted   = isNoid ? "rgba(251,241,217,0.55)" : "rgba(23,19,17,0.55)"
  const txtFaint   = isNoid ? "rgba(251,241,217,0.35)" : "rgba(23,19,17,0.38)"

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
              border: isNoid ? "1px solid rgba(163,110,20,0.3)" : "1px solid rgba(23,19,17,0.14)",
              boxShadow: isNoid ? "0 4px 16px rgba(0,0,0,0.3)" : "0 4px 16px rgba(23,19,17,0.1)",
              transition: COLOR_TRANSITION,
            }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl text-xl"
            style={{
              background: isNoid ? "rgba(163,110,20,0.15)" : "rgba(163,110,20,0.08)",
              border: isNoid ? "1px solid rgba(163,110,20,0.3)" : "1px solid rgba(163,110,20,0.18)",
              transition: COLOR_TRANSITION,
            }}>🌐</div>
        )}
        <div className="text-center">
          <p className="text-[9px] tracking-[0.45em] uppercase mb-0.5"
            style={{ color: isNoid ? `rgba(163,110,20,0.75)` : `rgba(163,110,20,0.65)`, transition: COLOR_TRANSITION }}>
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

      {/* ── Mode toggle — NoidModeView divider style ── */}
      <div className="shrink-0 px-5 pb-3 relative z-10">
        <div className="relative flex rounded-2xl p-1"
          style={{
            background: isNoid ? "rgba(251,241,217,0.05)" : "rgba(23,19,17,0.04)",
            border: isNoid ? "1px solid rgba(251,241,217,0.09)" : "1px solid rgba(23,19,17,0.07)",
            boxShadow: isNoid ? "inset 0 1px 0 rgba(255,255,255,0.04)" : "inset 0 1px 0 rgba(255,255,255,0.6)",
            transition: COLOR_TRANSITION,
          }}>
          {/* sliding blob — ink on open, cream on noid */}
          <span style={{
            position: "absolute",
            top: 4, bottom: 4,
            left: mode === "open" ? 4 : "calc(50% + 2px)",
            width: "calc(50% - 6px)",
            borderRadius: 12,
            background: isNoid
              ? `linear-gradient(135deg, ${BONE} 0%, ${CREAM_MID} 100%)`
              : `linear-gradient(135deg, ${INK} 0%, #2A211C 100%)`,
            boxShadow: isNoid
              ? "0 2px 8px rgba(251,241,217,0.15), inset 0 1px 0 rgba(255,255,255,0.6)"
              : "0 2px 8px rgba(23,19,17,0.4), inset 0 1px 0 rgba(255,255,255,0.1)",
            transition: `left 600ms ${SPRING}, background 500ms ${EASE}, box-shadow 500ms ${EASE}`,
          }} />
          {(["open", "noid"] as const).map((m) => {
            const active = mode === m
            const noidDisabled = m === "noid" && accounts.length === 0
            // Active label: contrast against the blob
            // open blob = ink → white label; noid blob = cream → ink label
            const activeColor = m === "open"
              ? BONE         // ink blob → bone label
              : INK          // cream blob → ink label
            return (
              <button key={m}
                onClick={() => { if (!noidDisabled) setMode(m) }}
                disabled={noidDisabled}
                className="relative z-10 flex-1 py-2 rounded-xl text-[11px] tracking-[0.2em] uppercase font-semibold disabled:opacity-35"
                style={{
                  color: active ? activeColor : txtMuted,
                  transition: `color 400ms ${EASE}`,
                }}>
                {m === "open" ? "◈ Open" : "◉ Noid"}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-3 relative z-10"
        style={{ WebkitOverflowScrolling: "touch" }}>

        {/* Wallet selector */}
        <div>
          <p className="text-[9px] tracking-[0.4em] uppercase mb-2"
            style={{ color: txtFaint, transition: COLOR_TRANSITION }}>
            Account
          </p>
          <div style={{
              display: "flex",
              flexDirection: "row",
              gap: "8px",
              overflowX: "auto",
              scrollSnapType: "x mandatory",
              WebkitOverflowScrolling: "touch",
              paddingBottom: "2px",
              msOverflowStyle: "none",
              scrollbarWidth: "none",
              WebkitMaskImage: entries.length > 2
                ? "linear-gradient(to right, black 80%, transparent 100%)"
                : "none",
              maskImage: entries.length > 2
                ? "linear-gradient(to right, black 80%, transparent 100%)"
                : "none",
            }}>
            {entries.map((e, i) => {
              const w = wallets[i]
              if (!w) return null
              const sel = i === selectedWalletIdx
              return (
                <button
                  key={e.id}
                  onClick={() => setSelectedWalletIdx(i)}
                  style={{
                    flexShrink: 0,
                    width: "calc(50% - 4px)",
                    scrollSnapAlign: "start",
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: "16px",
                    background: sel
                      ? isNoid
                        ? "linear-gradient(145deg, rgba(163,110,20,0.14) 0%, rgba(232,174,58,0.08) 100%)"
                        : "rgba(23,19,17,0.07)"
                      : isNoid ? "rgba(251,241,217,0.03)" : "rgba(23,19,17,0.03)",
                    border: sel
                      ? isNoid ? "1px solid rgba(163,110,20,0.32)" : "1px solid rgba(23,19,17,0.18)"
                      : isNoid ? "1px solid rgba(251,241,217,0.07)" : "1px solid rgba(23,19,17,0.07)",
                    boxShadow: sel
                      ? isNoid
                        ? "inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 12px rgba(163,110,20,0.08)"
                        : "inset 0 1px 0 rgba(255,255,255,0.5)"
                      : "none",
                  }}>
                  {/* Top row: number badge + tick */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      height: "22px", width: "22px", borderRadius: "8px",
                      fontSize: "10px", fontWeight: 700,
                      background: sel ? GOLD_DEEP : isNoid ? "rgba(251,241,217,0.07)" : "rgba(23,19,17,0.06)",
                      color: sel ? BONE : txtMuted,
                      border: sel ? "none" : isNoid ? "1px solid rgba(251,241,217,0.1)" : "1px solid rgba(23,19,17,0.1)",
                    }}>{i + 1}</div>
                    {sel && (
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        height: "20px", width: "20px", borderRadius: "8px",
                        background: "rgba(163,110,20,0.14)",
                        border: "1px solid rgba(163,110,20,0.3)",
                      }}>
                        <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 6.5L5 9L9.5 3.5" stroke={GOLD_DEEP} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <p style={{
                    fontSize: "12px", fontWeight: 600,
                    color: txtPrimary,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    marginBottom: "2px",
                  }}>{e.name}</p>
                  <p style={{
                    fontSize: "9px", fontFamily: "monospace",
                    color: txtFaint,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{trunc(w.normalAccount.address)}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Mode-specific content */}
        <LiquidMorph keyId={mode}>
          {mode === "open" && wallet ? (
            <div>
              <p className="text-[9px] tracking-[0.4em] uppercase mb-2"
                style={{ color: txtFaint }}>
                Open Account
              </p>
              {/* Dark treasury card — same gradient as NoidModeView context (dark on light bg) */}
              <div className="relative rounded-2xl overflow-hidden p-4"
                style={{
                  background: "linear-gradient(145deg, #1A1410 0%, #0D0A07 60%, #171311 100%)",
                  boxShadow: "0 16px 40px -12px rgba(0,0,0,0.6), 0 4px 16px rgba(163,110,20,0.08), inset 0 1px 0 rgba(251,241,217,0.07)",
                }}>
                <div className="pointer-events-none absolute" style={{
                  top: "-30%", right: "-10%", width: 120, height: 120, borderRadius: "50%",
                  background: `radial-gradient(circle, rgba(163,110,20,0.4) 0%, transparent 65%)`,
                  filter: "blur(28px)", animation: "treasureOrb1 12s ease-in-out infinite",
                }} />
                <div className="pointer-events-none absolute inset-0 opacity-[0.025]" style={{
                  backgroundImage: `linear-gradient(to right,${BONE} 1px,transparent 1px),linear-gradient(to bottom,${BONE} 1px,transparent 1px)`,
                  backgroundSize: "24px 24px",
                }} />
                <div className="pointer-events-none absolute inset-0 paper-grain opacity-[0.1]" />
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


              {/* Noid account list — SCROLLABLE when > 2 items */}
              {accounts.length > 0 && (
                <div className="mt-3">
                  <p className="text-[9px] tracking-[0.4em] uppercase mb-2" style={{ color: txtFaint }}>
                    Select Smart Account
                  </p>
                  <div
                    className="space-y-1.5"
                    style={{
                      maxHeight: accounts.length > 2 ? "172px" : "auto",
                      overflowY: accounts.length > 2 ? "auto" : "visible",
                      paddingRight: accounts.length > 2 ? "2px" : 0,
                      // Subtle fade at bottom when scrollable
                      ...(accounts.length > 2 ? {
                        WebkitMaskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
                        maskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
                      } : {}),
                    }}>
                    {accounts.map((acc, i) => (
                      <NoidAccountItem
                        key={acc.commitment}
                        acc={acc}
                        name={noidNames[acc.commitment] || ""}
                        index={i}
                        selected={i === selectedNoidIdx}
                        isNoid={isNoid}
                        onClick={() => setSelectedNoidIdx(i)}
                      />
                    ))}
                  </div>
                  {accounts.length > 2 && (
                    <p className="text-[8px] text-center mt-1.5 tracking-[0.2em] uppercase"
                      style={{ color: txtFaint }}>
                      scroll to see all
                    </p>
                  )}
                </div>
              )}

                            {/* Cream treasury card — NoidModeView hero gradient */}
              <div>
                <p className="text-[9px] tracking-[0.4em] uppercase mb-2" style={{ color: txtFaint }}>
                  Noid Smart Account
                </p>
                <div className="relative rounded-2xl overflow-hidden p-4"
                  style={{
                    background: `linear-gradient(145deg, ${BONE} 0%, ${CREAM_MID} 55%, ${CREAM_LOW} 100%)`,
                    boxShadow: `0 16px 40px -12px rgba(163,110,20,0.35), 0 4px 16px rgba(232,174,58,0.18), inset 0 1px 0 rgba(255,255,255,0.7)`,
                  }}>
                  <div className="pointer-events-none absolute" style={{
                    top: "-25%", right: "-15%", width: 120, height: 120, borderRadius: "50%",
                    background: "radial-gradient(circle,rgba(232,174,58,0.55) 0%,transparent 65%)", filter: "blur(28px)",
                  }} />
                  <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{
                    backgroundImage: `linear-gradient(to right,${INK} 1px,transparent 1px),linear-gradient(to bottom,${INK} 1px,transparent 1px)`,
                    backgroundSize: "24px 24px",
                  }} />
                  <div className="relative">
                    {accounts[selectedNoidIdx] ? (
                      <>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="h-1.5 w-1.5 rounded-full"
                            style={{ background: GOLD_DEEP, boxShadow: "0 0 6px rgba(163,110,20,0.5)", animation: "noidPulseDot 2.4s ease-in-out infinite" }} />
                          <span className="text-[8px] tracking-[0.45em] uppercase" style={{ color: "rgba(23,19,17,0.38)" }}>Private · Noid Mode</span>
                        </div>
                        <p className="text-[8px] tracking-[0.4em] uppercase mt-3 mb-1"
                          style={{ color: `rgba(163,110,20,0.65)` }}>
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
          <span className="font-mono text-[11px] flex-1 truncate" style={{ color: GOLD_DEEP }}>
            {exposedAddress || "—"}
          </span>
        </div>
      </div>

      {/* ── Footer ── */}
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
          <p className="mt-2 text-center text-[10px] tracking-[0.18em]"
            style={{ color: txtFaint, transition: COLOR_TRANSITION }}>
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