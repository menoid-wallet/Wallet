/**
 * MaskModal.tsx — updated to match NoidSendModal UX patterns
 *
 * Layout:
 *   form/error  → fullscreen, lockDrag, slider fixed at bottom, content scrollable
 *   in-flight   → partial sheet, draggable (no fullscreen snap), night ship floats
 *   success     → partial sheet, draggable (no fullscreen snap), overflow hidden
 *
 * Images (slide left→right between phases):
 *   form/error  → assets/modes/mask_start.png
 *   in-flight   → assets/ship/night_ship.png  (floating)
 *   success     → assets/modes/mask.png
 *
 * Slider: same ship drag-to-send slider from NoidSendModal
 * Voyage: wavy SVG track (not straight line), anchor drops after ship arrives
 * Done button: liquid glass style matching NoidSendModal
 */

import React, { useCallback, useEffect, useRef, useState } from "react"
import { ethers } from "ethers"
import { explorerTxUrl } from "../../lib/rpc"
import { fetchRelayerKeys } from "../../services/api"
import { executeMask } from "../../services/mask"
import { executeSolanaMask } from "../../services/solanaTx"
import { executeSuiMask } from "../../services/suiTx"
import { executeAptosMask } from "../../services/aptosTx"
import { type NetworkId } from "../../lib/networks"
import { useWallet } from "../../context/WalletContext"
import { usePool } from "../../context/PoolContext"
import { useThemeTokens } from "../../lib/useThemeTokens"
import { saveMaskTx } from "../../lib/txStore"
import LiquidSheet from "./LiquidSheet"
import shipImg      from "../../assets/ship/ship.png"
import maskStartImg from "../../assets/modes/mask_start.png"
import nightShipImg from "../../assets/ship/night_ship.png"
import maskDoneImg  from "../../assets/modes/mask.png"

// Preload images
;[maskStartImg, nightShipImg, maskDoneImg].forEach(src => {
  const i = new Image(); i.src = src
})

// Per-network relayer fee for masking (depositing into the ZK pool)
const DECIMALS: Record<string, number> = {
  monad: 18,
  sepolia: 18,
  base_sepolia: 18,
  solana: 9,
  sui: 9,
  aptos: 8,
}

function parseAmount(val: string, decs: number): bigint {
  const parts = val.split(".")
  const main = BigInt(parts[0]) * (10n ** BigInt(decs))
  let frac = 0n
  if (parts[1]) {
    const fStr = parts[1].padEnd(decs, "0").slice(0, decs)
    frac = BigInt(fStr)
  }
  return main + frac
}

function formatAmount(val: bigint, decs: number): string {
  const s = val.toString().padStart(decs + 1, "0")
  const main = s.slice(0, s.length - decs)
  let frac = s.slice(s.length - decs)
  frac = frac.replace(/0+$/, "")
  return frac ? `${main}.${frac}` : main
}

function getMinFeeMon(networkId: string): string {
  return networkId === "monad" ? "0.5" : "0.0001"
}

function getMinFeeWei(networkId: string): bigint {
  const decs = DECIMALS[networkId] || 18
  return parseAmount(getMinFeeMon(networkId), decs)
}

type Phase = "form" | "relayer" | "proving" | "sending" | "success" | "error"
const STEPS = ["Validate", "Prove", "Send", "Done"]

interface Props {
  open: boolean
  onClose: () => void
  openBalance: string
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function isBusy(p: Phase) {
  return p === "relayer" || p === "proving" || p === "sending"
}

function phaseToProgress(p: Phase): number {
  switch (p) {
    case "relayer":  return 0
    case "proving":  return 1 / 3
    case "sending":  return 2 / 3
    case "success":  return 1
    default:         return 0
  }
}

// ─── Wavy voyage track (same as NoidSendModal) ────────────────────────────────
const WAVE_PATH = "M0 5 Q24 1 47 5 Q71 9 95 5 Q118 1 142 5 Q166 9 190 5 Q213 1 237 5 Q261 9 285 5 Q308 1 332 5 Q356 9 380 5"

function ShipVoyage({ phase, compact = false }: { phase: Phase; compact?: boolean }) {
  const progress = phaseToProgress(phase)
  const docked   = phase === "success"
  const SHIP_PX  = 48
  const [showAnchor, setShowAnchor] = useState(false)

  useEffect(() => {
    if (!docked) { setShowAnchor(false); return }
    const t = setTimeout(() => setShowAnchor(true), 950)
    return () => clearTimeout(t)
  }, [docked])

  return (
    <div className="relative pb-1 px-1">
      <div className="relative h-14">
        {/* Background wave track */}
        <svg className="absolute inset-x-3 pointer-events-none"
          style={{ top: "50%", transform: "translateY(-50%)", height: 10, width: "calc(100% - 24px)" }}
          viewBox="0 0 380 10" preserveAspectRatio="none">
          <path d={WAVE_PATH} stroke="rgba(23,19,17,0.15)" strokeWidth="1.5" fill="none" />
        </svg>

        {/* Gold wake */}
        <div className="absolute pointer-events-none overflow-hidden"
          style={{ left: 12, top: "50%", transform: "translateY(-50%)",
            width: `calc((100% - 24px) * ${progress})`, height: 10,
            transition: "width 900ms cubic-bezier(0.22,1,0.36,1)" }}>
          <svg style={{ width: "380px", height: 10, maxWidth: "none" }}
            viewBox="0 0 380 10" preserveAspectRatio="none">
            <defs>
              <linearGradient id="maskWakeGrad" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="rgba(163,110,20,0.5)" />
                <stop offset="100%" stopColor="#DAA21C" />
              </linearGradient>
            </defs>
            <path d={WAVE_PATH} stroke="url(#maskWakeGrad)" strokeWidth="2" fill="none" />
          </svg>
        </div>

        {/* Port dots */}
        {STEPS.map((_, i) => {
          const pp      = i / (STEPS.length - 1)
          const reached = progress >= pp - 0.001
          const isCur   = !docked && Math.abs(progress - pp) < 0.02
          return (
            <div key={i} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `calc(12px + (100% - 24px) * ${pp})` }}>
              <div className={`relative h-3 w-3 rounded-full border transition-all duration-500
                ${reached ? "border-goldDeep bg-goldDeep" : "border-ink/20 bg-cream"}
                ${isCur ? "scale-125" : ""}`}>
                {isCur && <span className="absolute inset-0 rounded-full bg-goldDeep/40 animate-ping" />}
              </div>
            </div>
          )
        })}

        {/* Ship */}
        <div className="absolute top-1/2 -translate-x-1/2"
          style={{ left: `calc(12px + (100% - 24px) * ${progress})`,
            width: SHIP_PX, height: SHIP_PX, marginTop: -SHIP_PX / 2,
            transition: "left 900ms cubic-bezier(0.22,1,0.36,1)", zIndex: 2 }}>
          <div style={{ width: "100%", height: "100%",
            animation: docked ? "none" : "maskShipBob 1.6s ease-in-out infinite" }}>
            <img src={shipImg} alt="ship" draggable={false}
              style={{ width: SHIP_PX, height: SHIP_PX, objectFit: "contain", display: "block",
                filter: docked
                  ? "drop-shadow(0 0 8px rgba(218,162,28,0.8)) drop-shadow(0 0 20px rgba(218,162,28,0.4))"
                  : "drop-shadow(0 1px 3px rgba(0,0,0,0.3))",
                transition: "filter 600ms ease" }}
              className="select-none pointer-events-none"
            />
          </div>
          {showAnchor && (
            <span className="absolute left-1/2 text-[13px] pointer-events-none"
              style={{ bottom: -4, transform: "translateX(-50%)",
                animation: "maskAnchorDrop 0.6s cubic-bezier(0.22,1,0.36,1) forwards" }}>
              ⚓
            </span>
          )}
        </div>
      </div>

      {/* Port labels */}
      <div className="relative mt-1" style={{ height: 14 }}>
        {STEPS.map((label, i) => {
          const pp      = i / (STEPS.length - 1)
          const reached = progress >= pp - 0.001
          return (
            <span key={label} className="absolute -translate-x-1/2 text-[8px] tracking-[0.15em] uppercase transition-colors duration-500"
              style={{ left: `calc(12px + (100% - 24px) * ${pp})`,
                color: reached ? "#A36E14" : "rgba(23,19,17,0.3)" }}>
              {label}
            </span>
          )
        })}
      </div>

      {docked && (
        <p className="text-center text-[9px] tracking-[0.2em] uppercase mt-2"
          style={{ color: "rgba(163,110,20,0.7)" }}>
          Ship docked at port
        </p>
      )}
      {!compact && <div className="h-4" />}

      <style>{`
        @keyframes maskShipBob {
          0%,100% { transform: translateY(-2px) rotate(-2deg); }
          50%      { transform: translateY(2px) rotate(2deg); }
        }
        @keyframes maskAnchorDrop {
          0%   { transform: translateX(-50%) translateY(-8px); opacity: 0; }
          65%  { transform: translateX(-50%) translateY(2px);  opacity: 1; }
          100% { transform: translateX(-50%) translateY(0px);  opacity: 1; }
        }
        @keyframes maskNightFloat {
          0%, 100% { transform: translateY(0px) rotate(-1deg); }
          50%       { transform: translateY(-8px) rotate(1deg); }
        }
        @keyframes maskShipFloat {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-5px); }
        }
        @keyframes maskShipSail {
          0%   { transform: translateY(0px)  rotate(-6deg) scale(1.05); }
          25%  { transform: translateY(-4px) rotate(0deg)  scale(1.08); }
          50%  { transform: translateY(0px)  rotate(6deg)  scale(1.05); }
          75%  { transform: translateY(-4px) rotate(0deg)  scale(1.08); }
          100% { transform: translateY(0px)  rotate(-6deg) scale(1.05); }
        }
        @keyframes maskImgSlideOutLeft {
          from { transform: translateX(0%);    opacity: 1; }
          to   { transform: translateX(-110%); opacity: 0; }
        }
        @keyframes maskImgSlideInRight {
          from { transform: translateX(110%);  opacity: 0; }
          to   { transform: translateX(0%);    opacity: 1; }
        }
        @keyframes maskFlavorFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div className="h-4" />
    </div>
  )
}

// ─── Phase image with slide transition ───────────────────────────────────────
type ImgKey = "form" | "flight" | "success"

function MaskPhaseImage({ phase }: { phase: Phase }) {
  const want: ImgKey = phase === "success" ? "success" : isBusy(phase) ? "flight" : "form"
  const [shown,    setShown]    = useState<ImgKey>(want)
  const [leaving,  setLeaving]  = useState<ImgKey|null>(null)
  const [entering, setEntering] = useState<ImgKey|null>(null)

  useEffect(() => {
    if (want === shown && !leaving) return
    if (want === shown) return
    setLeaving(shown)
    setEntering(want)
    const t = setTimeout(() => {
      setShown(want); setLeaving(null); setEntering(null)
    }, 380)
    return () => clearTimeout(t)
  }, [want]) // eslint-disable-line

  const srcMap: Record<ImgKey, string> = {
    form:    maskStartImg,
    flight:  shipImg,
    success: maskDoneImg,
  }

  return (
    <div className="relative w-full" style={{ height: 220, overflow: "hidden" }}>
      {(["form", "flight", "success"] as ImgKey[]).map(key => {
        const isShown    = key === shown && key !== leaving
        const isLeaving  = key === leaving
        const isEntering = key === entering
        const visible    = isShown || isLeaving || isEntering
        let animation = "none"
        if (isLeaving)  animation = "maskImgSlideOutLeft 380ms cubic-bezier(0.4,0,0.2,1) forwards"
        if (isEntering) animation = "maskImgSlideInRight 380ms cubic-bezier(0.4,0,0.2,1) forwards"
        const floatAnim = key === "flight" && isShown && !isLeaving && !isEntering
          ? "maskNightFloat 3.5s ease-in-out infinite" : "none"
        return (
          <img key={key} src={srcMap[key]} alt=""
            style={{
              position: "absolute", inset: 0, width: "100%", maxWidth: 350,
              margin: "0 auto", height: "100%", 
              objectFit: "cover", // <-- important
              overflow: "hidden", // <-- add this
              borderRadius: "20px",
              opacity: visible ? 1 : 0, pointerEvents: "none",
              animation: (isLeaving || isEntering) ? animation : floatAnim,
              filter: key === "flight" ? "drop-shadow(0 8px 24px rgba(74,108,182,0.35))" : "none",
              transform: visible && !isLeaving && !isEntering ? "translateX(0%)" : undefined,
            }}
          />
        )
      })}
    </div>
  )
}

// ─── Flavor text ──────────────────────────────────────────────────────────────
const FLAVOR: Record<string, string[]> = {
  relayer: ["Hailing the relayer…", "Seeking a trusted port…", "The veil stirs…"],
  proving: ["Forging the zero-knowledge seal…", "No trace shall remain…", "The cryptographic tide rises…"],
  sending: ["The ship crosses the veil…", "Coins vanish into shadow…", "Broadcasting into the deep…"],
}
function FlavorText({ phase }: { phase: Phase }) {
  const lines = FLAVOR[phase] ?? []
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (!lines.length) return
    setIdx(0)
    const t = setInterval(() => setIdx(i => (i + 1) % lines.length), 2800)
    return () => clearInterval(t)
  }, [phase])
  if (!lines.length) return null
  return (
    <p key={`${phase}-${idx}`} className="text-[10px] font-serif italic mt-1 text-center"
      style={{ color: "rgba(23,19,17,0.35)", animation: "maskFlavorFadeIn 0.6s ease" }}>
      "{lines[idx]}"
    </p>
  )
}

// ─── Ship Slider ──────────────────────────────────────────────────────────────
interface SliderProps { canSubmit: boolean; phase: Phase; onCommit: () => void; isNoid: boolean }
function ShipSlider({ canSubmit, phase, onCommit, isNoid }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const dragStartX = useRef(0); const dragStartProgress = useRef(0)
  const committed  = useRef(false)
  const THUMB_W = 52; const COMMIT_THRESHOLD = 0.88
  const isInFlight = isBusy(phase)
  const disabled   = !canSubmit || isInFlight || phase === "success"

  useEffect(() => {
    if (phase === "form") { committed.current = false; setProgress(0); setDragging(false) }
  }, [phase])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled || committed.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true); dragStartX.current = e.clientX; dragStartProgress.current = progress
  }, [disabled, progress])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || disabled || committed.current) return
    const tW = (trackRef.current?.clientWidth ?? 280) - THUMB_W
    const newP = Math.max(0, Math.min(1, dragStartProgress.current + (e.clientX - dragStartX.current) / tW))
    setProgress(newP)
    if (newP >= COMMIT_THRESHOLD && !committed.current) {
      committed.current = true; setProgress(1); setDragging(false); onCommit()
    }
  }, [dragging, disabled, onCommit])

  const onPointerUp = useCallback((e?: React.PointerEvent) => {
    if (!dragging) return; setDragging(false)
    if (!committed.current) setProgress(0)
  }, [dragging])

  const travelW = Math.max(1, (trackRef.current?.clientWidth ?? 280) - THUMB_W)
  const thumbX  = progress * travelW

  let fillColor  = isNoid ? "rgba(251,241,217,0.06)" : "rgba(23,19,17,0.06)"
  let shipFilter = "drop-shadow(0 1px 2px rgba(23,19,17,0.4))"
  if (isInFlight)             { fillColor = "rgba(218,162,28,0.22)"; shipFilter = "drop-shadow(0 0 6px rgba(218,162,28,0.6))" }
  else if (phase==="success") { fillColor = "rgba(5,150,105,0.18)" }
  else if (canSubmit && progress > 0) { fillColor = `rgba(218,162,28,${0.08 + progress * 0.18})` }

  let fillExtra = 0; let trackLabel = ""
  if      (isInFlight)          { trackLabel = "Voyage in progress…"; fillExtra = 9999 }
  else if (phase === "success") { trackLabel = "Voyage complete!";    fillExtra = 9999 }
  else if (!canSubmit)          { trackLabel = "Fill in details to hide" }
  else if (progress > 0.55)     { trackLabel = "Release to hide!" }
  else                          { trackLabel = "Drag ship to hide →" }

  const thumbPos: React.CSSProperties = isInFlight
    ? { left: "50%", right: "auto", transform: "translate(-50%, -50%)", transition: "left 0.6s cubic-bezier(0.22,1,0.36,1), filter 0.3s" }
    : phase === "success"
    ? { right: 2, left: "auto", transform: "translateY(-50%)", transition: "filter 0.3s" }
    : { left: thumbX, right: "auto", transform: "translateY(-50%)", transition: dragging ? "none" : "left 0.4s cubic-bezier(0.22,1,0.36,1), filter 0.3s" }

  const borderColor = phase==="success" ? "1.5px solid rgba(5,150,105,0.35)"
    : canSubmit ? "1.5px solid rgba(232,174,58,0.4)"
    : isNoid ? "1.5px solid rgba(251,241,217,0.15)" : "1.5px solid rgba(23,19,17,0.12)"
  const bgColor = phase==="success" ? "rgba(5,150,105,0.10)"
    : canSubmit ? "rgba(232,174,58,0.07)"
    : isNoid ? "rgba(251,241,217,0.05)" : "rgba(23,19,17,0.05)"
  const labelColor = phase==="success" ? "rgba(5,150,105,0.8)"
    : isInFlight ? "rgba(180,130,10,0.9)"
    : isNoid ? "rgba(251,241,217,0.4)" : "rgba(23,19,17,0.45)"

  return (
    <div ref={trackRef} style={{
      position: "relative", width: "100%", height: 56, borderRadius: 28,
      border: borderColor, background: bgColor,
      overflow: "hidden", cursor: disabled ? "not-allowed" : "default",
      userSelect: "none", transition: "border-color 0.3s, background 0.3s",
    }}>
      <div style={{
        position:"absolute", inset:0, background: fillColor,
        width: `${thumbX + fillExtra + 26 + THUMB_W/2}px`, borderRadius:"inherit",
        transition: dragging ? "none" : "width 0.4s cubic-bezier(0.22,1,0.36,1), background 0.4s", pointerEvents:"none",
      }}/>
      <svg style={{ position:"absolute", bottom:0, left:0, width:"100%", height:18,
        opacity: isInFlight ? 0.45 : canSubmit ? 0.2 : 0.07, pointerEvents:"none",
        overflow:"visible", transition:"opacity 0.5s" }}
        viewBox="0 0 280 18" preserveAspectRatio="none">
        <path d="M0 12 Q35 4 70 12 Q105 20 140 12 Q175 4 210 12 Q245 20 280 12 L280 18 L0 18 Z" fill="#1a6b8a">
          {isInFlight && <animateTransform attributeName="transform" type="translate" from="0 0" to="-70 0" dur="1.2s" repeatCount="indefinite"/>}
        </path>
        {isInFlight && (
          <path d="M280 12 Q315 4 350 12 Q385 20 420 12 Q455 4 490 12 Q525 20 560 12 L560 18 L280 18 Z" fill="#1a6b8a">
            <animateTransform attributeName="transform" type="translate" from="0 0" to="-70 0" dur="1.2s" repeatCount="indefinite"/>
          </path>
        )}
      </svg>
      <div style={{
        position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
        pointerEvents:"none",
        paddingLeft: (isInFlight || phase==="success") ? 16 : thumbX + THUMB_W + 4,
        paddingRight: 16, transition:"padding-left 0.1s",
      }}>
        <span style={{ fontSize:10, letterSpacing:"0.3em", textTransform:"uppercase", fontWeight:600,
          whiteSpace:"nowrap", transition:"color 0.3s", color: labelColor }}>
          {trackLabel}
        </span>
      </div>
      <div onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onLostPointerCapture={() => onPointerUp()}
        style={{ position:"absolute", top:"50%", ...thumbPos,
          width:THUMB_W, height:THUMB_W,
          cursor: disabled ? "not-allowed" : dragging ? "grabbing" : "grab",
          display:"flex", alignItems:"center", justifyContent:"center",
          touchAction:"none", zIndex:2, filter:shipFilter }}>
        <img src={shipImg} alt="Drag to hide" draggable={false}
          style={{ width:46, height:46, objectFit:"contain", pointerEvents:"none",
            opacity: disabled && !isInFlight && phase!=="success" ? 0.35 : 1,
            transition:"opacity 0.3s",
            transform: dragging ? "scale(1.07) translateY(-2px)" : "scale(1)",
            animation: isInFlight ? "maskShipSail 1.4s ease-in-out infinite"
              : dragging ? "none" : "maskShipFloat 3s ease-in-out infinite" }}
        />
      </div>
    </div>
  )
}

// ─── Row helper ───────────────────────────────────────────────────────────────
function Row({ label, value, accent, isNoid }: { label:string; value:string; accent?:boolean; isNoid?:boolean }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className={`text-[10px] tracking-[0.3em] uppercase ${isNoid ? "text-bone/55" : "text-ink/50"}`}>{label}</span>
      <span className={`font-mono text-[12px] ${accent ? isNoid ? "text-gold font-semibold" : "text-goldDeep font-semibold" : isNoid ? "text-bone/85" : "text-ink/80"}`}>{value}</span>
    </div>
  )
}

function MaskGlyph() {
  return (
    <svg width="14" height="10" viewBox="0 0 20 14" fill="none">
      <path d="M2 6 Q4 2 7 2 Q9 2 10 4 Q11 2 13 2 Q16 2 18 6 Q17 11 13 11 Q11 11 10 9 Q9 11 7 11 Q3 11 2 6 Z" fill="currentColor" opacity="0.9"/>
    </svg>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function MaskModal({ open, onClose, openBalance }: Props) {
  const { wallet, activeNetwork, networkConfig } = useWallet()
  const { forceSync }  = usePool()
  const t              = useThemeTokens()

  const MIN_FEE_MON = getMinFeeMon(activeNetwork)
  const MIN_FEE_WEI = getMinFeeWei(activeNetwork)

  const [amount,  setAmount]  = useState("")
  const [fee,     setFee]     = useState(MIN_FEE_MON)
  const [touched, setTouched] = useState(false)
  const [errors,  setErrors]  = useState<{ amount?: string; fee?: string }>({})
  const [phase,   setPhase]   = useState<Phase>("form")
  const [statusMsg, setStatusMsg] = useState("")
  const [txHash,  setTxHash]  = useState<string|null>(null)
  const [fatal,   setFatal]   = useState<string|null>(null)

  // Reset fee to correct default when network changes
  useEffect(() => {
    setFee(getMinFeeMon(activeNetwork))
  }, [activeNetwork])

  useEffect(() => {
    if (open) return
    const id = setTimeout(() => {
      setPhase("form"); setAmount(""); setFee(getMinFeeMon(activeNetwork))
      setErrors({}); setTouched(false); setFatal(null); setTxHash(null); setStatusMsg("")
    }, 320)
    return () => clearTimeout(id)
  }, [open])

  const validate = useCallback(() => {
    const errs: { amount?: string; fee?: string } = {}
    let hideWei: bigint|null = null, feeWei: bigint|null = null, openWei = 0n
    const decs = DECIMALS[activeNetwork] || 18
    try { hideWei = parseAmount(amount || "0", decs) } catch { errs.amount = "Invalid amount" }
    try { feeWei = parseAmount(fee || "0", decs) } catch { errs.fee = "Invalid fee" }
    try { openWei = parseAmount(openBalance || "0", decs) } catch {}
    if (!errs.amount && hideWei !== null && hideWei <= 0n) errs.amount = "Enter an amount greater than 0"
    if (!errs.fee && feeWei !== null && feeWei < MIN_FEE_WEI) errs.fee = `Minimum fee is ${MIN_FEE_MON} ${networkConfig.nativeCurrency}`
    if (!errs.amount && !errs.fee && hideWei !== null && feeWei !== null) {
      const total = hideWei + feeWei
      if (total > openWei) errs.amount = `Deposit (hide + fee) exceeds open balance (${Number(openBalance).toFixed(4)} ${networkConfig.nativeCurrency})`
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }, [amount, fee, openBalance, activeNetwork])

  useEffect(() => { if (touched) validate() }, [amount, fee, touched, validate])

  const youReceive = (() => {
    try {
      const decs = DECIMALS[activeNetwork] || 18
      const h = parseAmount(amount || "0", decs)
      if (h > 0n) return formatAmount(h, decs)
    } catch {}
    return "—"
  })()

  // Total they need in their open wallet = hide amount + relayer fee
  const youDeposit = (() => {
    try {
      const decs = DECIMALS[activeNetwork] || 18
      const h = parseAmount(amount || "0", decs)
      const f = parseAmount(fee || "0", decs)
      if (h > 0n && f > 0n) return formatAmount(h + f, decs)
    } catch {}
    return "—"
  })()

  const canSubmit = (() => {
    if (!amount || !fee) return false
    try {
      const decs = DECIMALS[activeNetwork] || 18
      const h = parseAmount(amount, decs)   // what user wants hidden
      const f = parseAmount(fee, decs)      // relayer fee on top
      const o = parseAmount(openBalance || "0", decs)
      return h > 0n && f >= MIN_FEE_WEI && (h + f) <= o
    } catch { return false }
  })()

  async function handleMask() {
    setTouched(true)
    if (!validate()) return
    if (!wallet) return
    setFatal(null)
    try {
      setPhase("relayer"); setStatusMsg("Hailing the relayer…")
      const relayerKeys = await fetchRelayerKeys(activeNetwork)
      setPhase("proving"); setStatusMsg("Forging zero-knowledge proof — this takes ~20s.")
      
      const decs = DECIMALS[activeNetwork] || 18
      const totalWei = parseAmount(amount, decs) + parseAmount(fee, decs)
      const depositMon = formatAmount(totalWei, decs)

      let resultHash = ""

      if (activeNetwork === "solana") {
        if (!wallet.solanaAccount || !wallet.solanaNoidAccount) throw new Error("Solana account not derived")
        const res = await executeSolanaMask({
          depositAmountSol: depositMon, feeSol: fee,
          solanaPrivateKey: wallet.solanaAccount.privateKey,
          noidPublicKey: wallet.solanaNoidAccount.publicKey,
          noidZkPublicKey: wallet.solanaNoidAccount.zkPublicKey,
          relayerKeys,
          onProofStart: () => {},
          onSendTx: (h) => { setTxHash(h); setPhase("sending"); setStatusMsg(`Broadcasting to ${networkConfig.label}…`) }
        })
        resultHash = res.hash
      } else if (activeNetwork === "sui") {
        if (!wallet.suiAccount || !wallet.suiNoidAccount) throw new Error("Sui account not derived")
        const res = await executeSuiMask({
          depositAmountSui: depositMon, feeSui: fee,
          suiPrivateKey: wallet.suiAccount.privateKey,
          noidPublicKey: wallet.suiNoidAccount.publicKey,
          noidZkPublicKey: wallet.suiNoidAccount.zkPublicKey,
          relayerKeys,
          onProofStart: () => {},
          onSendTx: (h) => { setTxHash(h); setPhase("sending"); setStatusMsg(`Broadcasting to ${networkConfig.label}…`) }
        })
        resultHash = res.hash
      } else if (activeNetwork === "aptos") {
        if (!wallet.aptosAccount || !wallet.aptosNoidAccount) throw new Error("Aptos account not derived")
        const res = await executeAptosMask({
          depositAmountApt: depositMon, feeApt: fee,
          aptosPrivateKey: wallet.aptosAccount.privateKey,
          noidPublicKey: wallet.aptosNoidAccount.publicKey,
          noidZkPublicKey: wallet.aptosNoidAccount.zkPublicKey,
          relayerKeys,
          onProofStart: () => {},
          onSendTx: (h) => { setTxHash(h); setPhase("sending"); setStatusMsg(`Broadcasting to ${networkConfig.label}…`) }
        })
        resultHash = res.hash
      } else {
        if (!wallet.normalAccount || !wallet.noidAccount) throw new Error("EVM account not derived")
        const res = await executeMask({
          depositAmountMon: depositMon, feeMon: fee,
          normalPrivateKey: wallet.normalAccount.privateKey,
          noidPublicKey: wallet.noidAccount.publicKey,
          noidZkPublicKey: wallet.noidAccount.zkPublicKey,
          relayerKeys,
          networkId: activeNetwork,
          onProofStart: () => {},
          onSendTx: (h) => { setTxHash(h); setPhase("sending"); setStatusMsg(`Broadcasting to ${networkConfig.label}…`) }
        })
        resultHash = res.hash
      }

      const activeNoid = (() => {
        if (activeNetwork === "solana") return wallet.solanaNoidAccount
        if (activeNetwork === "sui") return wallet.suiNoidAccount
        if (activeNetwork === "aptos") return wallet.aptosNoidAccount
        return wallet.noidAccount
      })()
      if (!activeNoid) throw new Error("ZK account not derived for active network")

      setTxHash(resultHash); setPhase("success"); setStatusMsg("Funds hidden successfully.")
      saveMaskTx(activeNoid.publicKey, {
        type: "mask",
        txHash: resultHash,
        fromAddress: activeNetwork === "solana" ? wallet.solanaAccount?.address! : activeNetwork === "sui" ? wallet.suiAccount?.address! : activeNetwork === "aptos" ? wallet.aptosAccount?.address! : wallet.normalAccount.address,
        noidPublicKey: activeNoid.publicKey,
        amountMon: amount,
        feeMon: fee,
        timestamp: Date.now(),
      })
      forceSync()
      setTimeout(() => void forceSync(), 1500)
    } catch (e: any) {
      console.error(e)
      setFatal(e?.shortMessage || e?.reason || e?.message || "Hidden failed.")
      setPhase("error")
    }
  }

  const isInFlight    = isBusy(phase)
  const isFormOrError = phase === "form" || phase === "error"
  const isSuccess     = phase === "success"

  // Shared header text
  const eyebrow = isSuccess ? "Veil Drawn" : phase==="error" ? "Storm Rolled In" : "Hide inside the Noid cave"
  const title   = isSuccess ? "Your treasure is hidden. ⚓" : phase==="error" ? "Hidden failed." : `Hide ${networkConfig.nativeCurrency}`
  const subtitle = isSuccess
    ? `Your ${networkConfig.nativeCurrency} is locked in the Noid Pool`
    : `Open balance: ${Number(openBalance).toFixed(4)} ${networkConfig.nativeCurrency}`

  return (
    <LiquidSheet
      open={open}
      onClose={onClose}
      tone={t.isNoid ? "ink" : "cream"}
      accent="rgba(232,174,58,0.24)"
      disableDrag={isInFlight}
      lockDrag={isFormOrError}
      defaultFullscreen={isFormOrError}
    >
      <div className="flex flex-col"
        style={{ height: isFormOrError ? "100%" : "auto",
          overflow: isSuccess ? "hidden" : undefined,
          transition: "height 600ms cubic-bezier(0.22,1,0.36,1)" }}>

        {/* ── Shared header ── */}
        <div className="shrink-0 px-6 pt-2 pb-1 text-center">
          <p className="text-[9px] tracking-[0.45em] uppercase text-goldDeep mb-1">{eyebrow}</p>
          <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]">{title}</h3>
          <p className={`mt-1 text-[11px] leading-snug ${t.isNoid ? "text-bone/65" : "text-ink/55"}`}>{subtitle}</p>
        </div>

        {/* ── Phase image (slides left→right between phases) ── */}
        <div className="shrink-0 px-6 pt-1">
          <MaskPhaseImage phase={phase}/>
        </div>

        {/* ── Voyage tracker (fades in during in-flight + success) ── */}
        <div className="shrink-0 px-6"
          style={{
            opacity: (isInFlight || isSuccess) ? 1 : 0,
            maxHeight: (isInFlight || isSuccess) ? 130 : 0,
            overflow: "hidden",
            transition: "opacity 500ms ease, max-height 600ms cubic-bezier(0.22,1,0.36,1)",
            pointerEvents: (isInFlight || isSuccess) ? "auto" : "none",
          }}>
          <ShipVoyage phase={phase} compact={isSuccess}/>
        </div>

        {/* ── In-flight status + flavor text ── */}
        <div className="shrink-0 px-6"
          style={{
            opacity: isInFlight ? 1 : 0,
            maxHeight: isInFlight ? 130 : 0,
            overflow: "hidden",
            transition: "opacity 500ms ease, max-height 600ms cubic-bezier(0.22,1,0.36,1)",
            pointerEvents: isInFlight ? "auto" : "none",
          }}>
          <div className="flex flex-col items-center gap-2 text-center">
            <p className={`text-[11px] tracking-[0.2em] uppercase text-goldDeep`}>{statusMsg}</p>
            {phase==="proving" && (
              <p className={`text-[10px] max-w-[260px] leading-snug ${t.isNoid ? "text-bone/45" : "text-ink/40"}`}>
                ZK proof runs in your browser. Keep this window open.
              </p>
            )}
            <FlavorText phase={phase}/>
          </div>
        </div>

        {/* ── Success actions ── */}
        {isSuccess && (
          <div className="shrink-0 px-6 pb-4">
            {txHash && (
              <div className="rounded-2xl border p-3 flex items-start gap-3 mb-3 bg-emerald-500/10 border-emerald-500/25">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7L5.5 10.5L12 4" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-emerald-700">Hidden Successfully</p>
                  <p className={`font-mono text-[9px] mt-1 break-all ${t.isNoid ? "text-bone/60" : "text-ink/60"}`}> {txHash?.slice(0, 34)}...{txHash?.slice(-4)}</p>
                </div>
              </div>
            )}
            <button onClick={onClose}
              className="w-full rounded-xl py-3 text-[11px] tracking-[0.25em] uppercase hover:-translate-y-[1px] transition-all"
              style={{
                background: t.isNoid
                  ? "linear-gradient(145deg, rgba(251,241,217,0.07) 0%, rgba(232,174,58,0.06) 100%)"
                  : "linear-gradient(145deg, rgba(23,19,17,0.08) 0%, rgba(232,174,58,0.06) 100%)",
                backdropFilter: "blur(20px) saturate(180%)",
                WebkitBackdropFilter: "blur(20px) saturate(180%)",
                border: "1px solid rgba(232,174,58,0.25)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(232,174,58,0.1)",
                color: t.isNoid ? "rgba(251,241,217,0.88)" : "rgba(23,19,17,0.88)",
              }}>
              Done
            </button>
            {txHash && (
              <div className="flex justify-center mt-2">
                <a href={explorerTxUrl(txHash, activeNetwork)} target="_blank" rel="noreferrer"
                  className="text-[10px] tracking-[0.2em] uppercase hover:opacity-60 transition-opacity"
                  style={{ color: t.isNoid ? "rgba(251,241,217,0.35)" : "rgba(23,19,17,0.4)" }}>
                  View on explorer
                </a>
              </div>
            )}
          </div>
        )}

        {/* ── Scrollable form body ── */}
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-6 pt-1 pb-2 space-y-4"
          style={{
            opacity: isFormOrError ? 1 : 0,
            transition: "opacity 400ms ease",
            pointerEvents: isFormOrError ? "auto" : "none",
            display: isFormOrError ? undefined : "none",
          }}>

          {/* Amount */}
          <div>
            <div className="flex items-end justify-between mb-1.5">
              <label className={`block text-[9px] tracking-[0.3em] uppercase ${t.isNoid ? "text-bone/55" : "text-ink/50"}`}>
                Amount to Hide ({networkConfig.nativeCurrency})
              </label>
              <button onClick={() => {
                try {
                  const decs = DECIMALS[activeNetwork] || 18
                  const o = parseAmount(openBalance || "0", decs)
                  const f = parseAmount(fee || "0", decs)
                  if (o > f) setAmount(formatAmount(o - f, decs))
                } catch {}
              }} className="text-[9px] tracking-[0.3em] uppercase text-goldDeep hover:text-goldDeeper transition-colors">
                Max
              </button>
            </div>
            <input value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.00" inputMode="decimal"
              className={`w-full rounded-xl border px-3 py-2.5 text-[14px] font-mono focus:outline-none transition-colors
                ${t.isNoid ? "bg-bone/[0.06] placeholder-bone/30 text-bone" : "bg-ink/[0.05] placeholder-ink/30 text-ink"}
                ${errors.amount ? "border-red-500/40 focus:border-red-500/60" : t.isNoid ? "border-bone/15 focus:border-gold/60" : "border-ink/12 focus:border-goldDeep/60"}`}
            />
            {errors.amount && <p className="mt-1 text-[10px] text-red-600">{errors.amount}</p>}
          </div>

          {/* Fee */}
          <div>
            <div className="flex items-end justify-between mb-1.5">
              <label className={`block text-[9px] tracking-[0.3em] uppercase ${t.isNoid ? "text-bone/55" : "text-ink/50"}`}>
                Relayer Fee ({networkConfig.nativeCurrency})
              </label>
              <span className={`text-[9px] tracking-[0.2em] uppercase ${t.isNoid ? "text-bone/45" : "text-ink/40"}`}>
                min {MIN_FEE_MON}
              </span>
            </div>
            <input value={fee} onChange={e => setFee(e.target.value)}
              placeholder={MIN_FEE_MON} inputMode="decimal"
              className={`w-full rounded-xl border px-3 py-2.5 text-[14px] font-mono focus:outline-none transition-colors
                ${t.isNoid ? "bg-bone/[0.06] placeholder-bone/30 text-bone" : "bg-ink/[0.05] placeholder-ink/30 text-ink"}
                ${errors.fee ? "border-red-500/40 focus:border-red-500/60" : t.isNoid ? "border-bone/15 focus:border-gold/60" : "border-ink/12 focus:border-goldDeep/60"}`}
            />
            {errors.fee && <p className="mt-1 text-[10px] text-red-600">{errors.fee}</p>}
          </div>

          {/* Breakdown */}
          <div className={`rounded-xl p-3 space-y-1.5 ${t.card}`}>
            <Row label="You Hide" value={youReceive !== "—" ? `${youReceive} ${networkConfig.nativeCurrency}` : "—"} accent isNoid={t.isNoid}/>
            <Row label="Relayer fee" value={fee && !errors.fee ? `+ ${fee} ${networkConfig.nativeCurrency}` : `+ ${MIN_FEE_MON} ${networkConfig.nativeCurrency} (min)`} isNoid={t.isNoid}/>
            <div className={`h-px my-1 ${t.isNoid ? "bg-bone/15" : "bg-ink/10"}`}/>
            <Row label="You Deposit" value={youDeposit !== "—" ? `${youDeposit} ${networkConfig.nativeCurrency}` : "—"} isNoid={t.isNoid}/>
          </div>

          {/* Error */}
          {phase==="error" && fatal && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/25">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                className="text-red-600 mt-0.5 flex-shrink-0">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <p className="text-[11px] text-red-700 leading-relaxed">{fatal}</p>
            </div>
          )}

          <p className={`text-center font-serif italic text-[11px] pt-1 ${t.isNoid ? "text-bone/45" : "text-ink/40"}`}>
            "Hide yer gold in the Noid cave."
          </p>

          <div style={{ height: 8 }}/>
        </div>

        {/* ── Fixed footer slider ── */}
        {isFormOrError && (
          <div className="shrink-0 px-6 pt-3 pb-6"
            style={{ borderTop: t.isNoid ? "1px solid rgba(251,241,217,0.08)" : "1px solid rgba(23,19,17,0.07)" }}>
            <ShipSlider canSubmit={canSubmit} phase={phase} onCommit={handleMask} isNoid={t.isNoid}/>
          </div>
        )}

      </div>
    </LiquidSheet>
  )
}