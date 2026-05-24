/**
 * UnMaskModal.tsx — updated to match MaskModal UX patterns exactly
 *
 * Layout:
 *   form/error  → fullscreen, lockDrag, slider fixed at bottom, content scrollable
 *   in-flight   → partial sheet, draggable (no fullscreen snap), night ship floats
 *   success     → partial sheet, draggable (no fullscreen snap), overflow hidden
 *
 * Images (slide left→right between phases):
 *   form/error  → assets/modes/unmask_meno.png
 *   in-flight   → assets/ship/night_ship.png  (floating)
 *   success     → assets/ship/reached_ship.png
 *
 * Slider: same ship drag-to-send slider (floating ship idle animation)
 * Voyage: wavy SVG track, anchor drops after ship arrives
 * Done button: liquid glass style matching MaskModal / NoidSendModal
 */

import React, {
  useCallback, useEffect, useMemo, useRef, useState
} from "react"
import { ethers } from "ethers"
import { useWallet } from "~context/WalletContext"
import { usePool } from "~context/PoolContext"
import { fetchRelayerKeys } from "~services/api"
import { executeUnmask } from "~services/unmask"
import LiquidSheet from "./LiquidSheet"
import shipImg       from "../../assets/ship/ship.png"
import unmaskFormImg from "../../assets/modes/unmask_meno.png"
import nightShipImg  from "../../assets/ship/night_ship.png"
import unmaskDoneImg from "../../assets/ship/reached_ship.png"

// Preload images
;[unmaskFormImg, nightShipImg, unmaskDoneImg].forEach(src => {
  const i = new Image(); i.src = src
})

// ─── Constants ────────────────────────────────────────────────────────────────
const RELAYER_FEE = ethers.parseEther("0.5")
const ZERO_BIG    = BigInt(0)

// ─── Types ────────────────────────────────────────────────────────────────────
type Phase = "form" | "relayer" | "building" | "proving" | "sending" | "success" | "error"
const STEPS = ["Relayer", "Build", "Prove", "Send", "Done"]

interface Props { open: boolean; onClose: () => void }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isBusy(p: Phase): boolean {
  return ["relayer", "building", "proving", "sending"].includes(p)
}
function phaseToProgress(p: Phase): number {
  switch (p) {
    case "relayer":  return 0
    case "building": return 1 / 4
    case "proving":  return 2 / 4
    case "sending":  return 3 / 4
    case "success":  return 1
    default:         return 0
  }
}

// ─── Wavy voyage track ────────────────────────────────────────────────────────
const WAVE_PATH = "M0 5 Q24 1 47 5 Q71 9 95 5 Q118 1 142 5 Q166 9 190 5 Q213 1 237 5 Q261 9 285 5 Q308 1 332 5 Q356 9 380 5"

function ShipVoyage({ phase, compact = false }: { phase: Phase; compact?: boolean }) {
  const progress   = phaseToProgress(phase)
  const docked     = phase === "success"
  const SHIP_PX    = 48
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
          <path d={WAVE_PATH} stroke="rgba(251,241,217,0.12)" strokeWidth="1.5" fill="none" />
        </svg>

        {/* Gold wake */}
        <div className="absolute pointer-events-none overflow-hidden"
          style={{ left: 12, top: "50%", transform: "translateY(-50%)",
            width: `calc((100% - 24px) * ${progress})`, height: 10,
            transition: "width 900ms cubic-bezier(0.22,1,0.36,1)" }}>
          <svg style={{ width: "380px", height: 10, maxWidth: "none" }}
            viewBox="0 0 380 10" preserveAspectRatio="none">
            <defs>
              <linearGradient id="unmaskWakeGrad" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="rgba(163,110,20,0.5)" />
                <stop offset="100%" stopColor="#DAA21C" />
              </linearGradient>
            </defs>
            <path d={WAVE_PATH} stroke="url(#unmaskWakeGrad)" strokeWidth="2" fill="none" />
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
                ${reached ? "border-goldDeep bg-goldDeep" : "border-bone/20 bg-inkSoft"}
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
            animation: docked ? "none" : "unmaskShipBob 1.6s ease-in-out infinite" }}>
            <img src={shipImg} alt="ship" draggable={false}
              style={{ width: SHIP_PX, height: SHIP_PX, objectFit: "contain", display: "block",
                filter: docked
                  ? "drop-shadow(0 0 8px rgba(218,162,28,0.8)) drop-shadow(0 0 20px rgba(218,162,28,0.4))"
                  : "drop-shadow(0 1px 3px rgba(0,0,0,0.5))",
                transition: "filter 600ms ease" }}
              className="select-none pointer-events-none"
            />
          </div>
          {showAnchor && (
            <span className="absolute left-1/2 text-[13px] pointer-events-none"
              style={{ bottom: -4, transform: "translateX(-50%)",
                animation: "unmaskAnchorDrop 0.6s cubic-bezier(0.22,1,0.36,1) forwards" }}>
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
            <span key={label}
              className="absolute -translate-x-1/2 text-[8px] tracking-[0.15em] uppercase transition-colors duration-500"
              style={{ left: `calc(12px + (100% - 24px) * ${pp})`,
                color: reached ? "#A36E14" : "rgba(251,241,217,0.25)" }}>
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
        @keyframes unmaskShipBob {
          0%,100% { transform: translateY(-2px) rotate(-2deg); }
          50%      { transform: translateY(2px) rotate(2deg); }
        }
        @keyframes unmaskAnchorDrop {
          0%   { transform: translateX(-50%) translateY(-8px); opacity: 0; }
          65%  { transform: translateX(-50%) translateY(2px);  opacity: 1; }
          100% { transform: translateX(-50%) translateY(0px);  opacity: 1; }
        }
        @keyframes unmaskNightFloat {
          0%, 100% { transform: translateY(0px) rotate(-1deg); }
          50%       { transform: translateY(-8px) rotate(1deg); }
        }
        @keyframes unmaskShipFloat {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-5px); }
        }
        @keyframes unmaskShipSail {
          0%   { transform: translateY(0px)  rotate(-6deg) scale(1.05); }
          25%  { transform: translateY(-4px) rotate(0deg)  scale(1.08); }
          50%  { transform: translateY(0px)  rotate(6deg)  scale(1.05); }
          75%  { transform: translateY(-4px) rotate(0deg)  scale(1.08); }
          100% { transform: translateY(0px)  rotate(-6deg) scale(1.05); }
        }
        @keyframes unmaskImgSlideOutLeft {
          from { transform: translateX(0%);    opacity: 1; }
          to   { transform: translateX(-110%); opacity: 0; }
        }
        @keyframes unmaskImgSlideInRight {
          from { transform: translateX(110%);  opacity: 0; }
          to   { transform: translateX(0%);    opacity: 1; }
        }
        @keyframes unmaskFlavorFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

// ─── Phase image with slide transition ───────────────────────────────────────
type ImgKey = "form" | "flight" | "success"

function UnmaskPhaseImage({ phase }: { phase: Phase }) {
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
    form:    unmaskFormImg,
    flight:  nightShipImg,
    success: unmaskDoneImg,
  }

  return (
    <div className="relative w-full" style={{ height: 220, overflow: "hidden" }}>
      {(["form", "flight", "success"] as ImgKey[]).map(key => {
        const isShown    = key === shown && key !== leaving
        const isLeaving  = key === leaving
        const isEntering = key === entering
        const visible    = isShown || isLeaving || isEntering
        let animation = "none"
        if (isLeaving)  animation = "unmaskImgSlideOutLeft 380ms cubic-bezier(0.4,0,0.2,1) forwards"
        if (isEntering) animation = "unmaskImgSlideInRight 380ms cubic-bezier(0.4,0,0.2,1) forwards"
        const floatAnim = key === "flight" && isShown && !isLeaving && !isEntering
          ? "unmaskNightFloat 3.5s ease-in-out infinite" : "none"
        return (
          <img key={key} src={srcMap[key]} alt=""
            style={{
              position: "absolute", inset: 0, width: "100%", maxWidth: 360,
              margin: "0 auto", height: "100%", objectFit: "cover",
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
  relayer:  ["Hailing the relayer…", "Seeking a trusted harbour…", "The veil begins to lift…"],
  building: ["Charting the withdrawal route…", "Selecting the finest notes…", "Planning the surfacing…"],
  proving:  ["Forging the zero-knowledge seal…", "Proving ownership in the dark…", "The cryptographic tide rises…"],
  sending:  ["The ship breaks the surface…", "Coins emerge from shadow…", "Broadcasting into the light…"],
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
      style={{ color: "rgba(251,241,217,0.3)", animation: "unmaskFlavorFadeIn 0.6s ease" }}>
      "{lines[idx]}"
    </p>
  )
}

// ─── Ship Slider ──────────────────────────────────────────────────────────────
interface SliderProps { canSubmit: boolean; phase: Phase; onCommit: () => void }
function ShipSlider({ canSubmit, phase, onCommit }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const dragStartX        = useRef(0)
  const dragStartProgress = useRef(0)
  const committed         = useRef(false)
  const THUMB_W           = 52
  const COMMIT_THRESHOLD  = 0.88
  const isInFlight        = isBusy(phase)
  const disabled          = !canSubmit || isInFlight || phase === "success"

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
    const tW   = (trackRef.current?.clientWidth ?? 280) - THUMB_W
    const newP = Math.max(0, Math.min(1, dragStartProgress.current + (e.clientX - dragStartX.current) / tW))
    setProgress(newP)
    if (newP >= COMMIT_THRESHOLD && !committed.current) {
      committed.current = true; setProgress(1); setDragging(false); onCommit()
    }
  }, [dragging, disabled, onCommit])

  const onPointerUp = useCallback((e?: React.PointerEvent) => {
    if (!dragging) return
    setDragging(false)
    if (!committed.current) setProgress(0)
  }, [dragging])

  const travelW  = Math.max(1, (trackRef.current?.clientWidth ?? 280) - THUMB_W)
  const thumbX   = progress * travelW

  let fillColor  = "rgba(251,241,217,0.06)"
  let shipFilter = "drop-shadow(0 1px 2px rgba(23,19,17,0.5))"
  if (isInFlight)             { fillColor = "rgba(218,162,28,0.22)"; shipFilter = "drop-shadow(0 0 6px rgba(218,162,28,0.6))" }
  else if (phase==="success") { fillColor = "rgba(5,150,105,0.18)" }
  else if (canSubmit && progress > 0) { fillColor = `rgba(218,162,28,${0.08 + progress * 0.18})` }

  let fillExtra = 0; let trackLabel = ""
  if      (isInFlight)          { trackLabel = "Voyage in progress…"; fillExtra = 9999 }
  else if (phase === "success") { trackLabel = "Voyage complete!";    fillExtra = 9999 }
  else if (!canSubmit)          { trackLabel = "Enter amount to unmask" }
  else if (progress > 0.55)     { trackLabel = "Release to unmask!" }
  else                          { trackLabel = "Drag ship to unmask →" }

  const thumbPos: React.CSSProperties = isInFlight
    ? { left: "50%", right: "auto", transform: "translate(-50%, -50%)", transition: "left 0.6s cubic-bezier(0.22,1,0.36,1), filter 0.3s" }
    : phase === "success"
    ? { right: 2, left: "auto", transform: "translateY(-50%)", transition: "filter 0.3s" }
    : { left: thumbX, right: "auto", transform: "translateY(-50%)", transition: dragging ? "none" : "left 0.4s cubic-bezier(0.22,1,0.36,1), filter 0.3s" }

  const borderColor = phase==="success" ? "1.5px solid rgba(5,150,105,0.35)"
    : canSubmit ? "1.5px solid rgba(232,174,58,0.4)" : "1.5px solid rgba(251,241,217,0.15)"
  const bgColor = phase==="success" ? "rgba(5,150,105,0.10)"
    : canSubmit ? "rgba(232,174,58,0.07)" : "rgba(251,241,217,0.05)"
  const labelColor = phase==="success" ? "rgba(5,150,105,0.8)"
    : isInFlight ? "rgba(180,130,10,0.9)" : "rgba(251,241,217,0.4)"

  return (
    <div ref={trackRef} style={{
      position: "relative", width: "100%", height: 56, borderRadius: 28,
      border: borderColor, background: bgColor,
      overflow: "hidden", cursor: disabled ? "not-allowed" : "default",
      userSelect: "none", transition: "border-color 0.3s, background 0.3s",
    }}>
      {/* Fill */}
      <div style={{
        position:"absolute", inset:0, background: fillColor,
        width: `${thumbX + fillExtra + 26 + THUMB_W/2}px`, borderRadius:"inherit",
        transition: dragging ? "none" : "width 0.4s cubic-bezier(0.22,1,0.36,1), background 0.4s",
        pointerEvents:"none",
      }}/>
      {/* Animated wave */}
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
      {/* Label */}
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
      {/* Ship thumb */}
      <div onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onLostPointerCapture={() => onPointerUp()}
        style={{ position:"absolute", top:"50%", ...thumbPos,
          width:THUMB_W, height:THUMB_W,
          cursor: disabled ? "not-allowed" : dragging ? "grabbing" : "grab",
          display:"flex", alignItems:"center", justifyContent:"center",
          touchAction:"none", zIndex:2, filter:shipFilter }}>
        <img src={shipImg} alt="Drag to unmask" draggable={false}
          style={{ width:46, height:46, objectFit:"contain", pointerEvents:"none",
            opacity: disabled && !isInFlight && phase!=="success" ? 0.35 : 1,
            transition:"opacity 0.3s",
            transform: dragging ? "scale(1.07) translateY(-2px)" : "scale(1)",
            animation: isInFlight ? "unmaskShipSail 1.4s ease-in-out infinite"
              : dragging ? "none" : "unmaskShipFloat 3s ease-in-out infinite" }}
        />
      </div>
    </div>
  )
}

// ─── Main UnMaskModal ─────────────────────────────────────────────────────────
export default function UnMaskModal({ open, onClose }: Props) {
  const { wallet }  = useWallet()
  const { allUnspentUTXOs, getMerkleProof, forceSync } = usePool()

  const fromAddress = wallet?.normalAccount?.address ?? ""
  const privateKey  = wallet?.normalAccount?.privateKey ?? ""
  const noidAccount = wallet?.noidAccount

  const [amountEth,   setAmountEth]   = useState("")
  const [phase,       setPhase]       = useState<Phase>("form")
  const [statusMsg,   setStatusMsg]   = useState("")
  const [txHash,      setTxHash]      = useState<string|null>(null)
  const [errorMsg,    setErrorMsg]    = useState<string|null>(null)
  const [provenCount, setProvenCount] = useState(0)
  const [totalProofs, setTotalProofs] = useState(0)

  useEffect(() => {
    if (open) return
    const id = setTimeout(() => {
      setPhase("form"); setAmountEth(""); setTxHash(null)
      setErrorMsg(null); setProvenCount(0); setTotalProofs(0); setStatusMsg("")
    }, 320)
    return () => clearTimeout(id)
  }, [open])

  const parsedAmt = useMemo(() => {
    try { return ethers.parseEther(amountEth || "0") } catch { return ZERO_BIG }
  }, [amountEth])

  const totalAvailable = useMemo(
    () => allUnspentUTXOs.reduce((s, u) => s + BigInt(u.amount), ZERO_BIG),
    [allUnspentUTXOs]
  )

  const maxWithdrawable = useMemo(
    () => totalAvailable > RELAYER_FEE ? totalAvailable - RELAYER_FEE : ZERO_BIG,
    [totalAvailable]
  )

  const insufficient  = parsedAmt > ZERO_BIG && (parsedAmt + RELAYER_FEE) > totalAvailable
  const totalDeducted = parsedAmt > ZERO_BIG ? parsedAmt + RELAYER_FEE : ZERO_BIG
  const canSubmit     = parsedAmt > ZERO_BIG && !!privateKey && !!noidAccount && !insufficient

  const handleUnmask = useCallback(async () => {
    if (!canSubmit || !noidAccount || !privateKey || !fromAddress) return
    setErrorMsg(null); setTxHash(null); setProvenCount(0); setTotalProofs(0)
    try {
      setPhase("relayer"); setStatusMsg("Hailing the relayer…")
      const relayerKeys = await fetchRelayerKeys()
      setPhase("building"); setStatusMsg("Selecting inputs and building plan…")
      setPhase("proving")
      const result = await executeUnmask({
        withdrawAmountMon: amountEth, toAddress: fromAddress,
        normalPrivateKey: privateKey,
        noidSecretKey: noidAccount.zkSecretKey,
        noidPublicKey: noidAccount.publicKey,
        noidZkPublicKey: noidAccount.zkPublicKey,
        relayerKeys, allUnspentUTXOs, getMerkleProof,
        onBatchStart: (batchNum, total) => {
          setTotalProofs(total)
          setStatusMsg(`Generating ZK proof ${batchNum} of ${total}…`)
        },
        onProofStart: (batchNum) => {
          setProvenCount(batchNum)
          setStatusMsg(totalProofs === 1 ? "Forging ZK proof…" : `Generating ZK proof ${batchNum} of ${totalProofs}…`)
        },
        onSendTx: (hash) => {
          setPhase("sending"); setStatusMsg("Broadcasting to Monad…"); setTxHash(hash)
        }
      })
      setTxHash(result.hash); setPhase("success")
      setTimeout(() => void forceSync(), 1500)
    } catch (err: any) {
      console.error("[UnMaskModal]", err)
      setPhase("error")
      let msg = "Unmask failed"
      if (err?.message) {
        if (err.message.includes("insufficient balance")) msg = "Signer had insufficient balance"
        else if (err.message.includes("Insufficient balance")) msg = "Insufficient balance in pool"
        else if (err.message.includes("insufficient funds")) msg = "Insufficient funds for transaction"
        else if (err.message.includes("could not coalesce")) msg = err?.cause?.message || err?.error?.message || "Transaction failed — check balance and network"
        else msg = err.message
      } else if (err?.reason) { msg = err.reason }
      else if (err?.shortMessage) { msg = err.shortMessage }
      setErrorMsg(msg)
    }
  }, [canSubmit, noidAccount, privateKey, fromAddress, amountEth, allUnspentUTXOs, getMerkleProof, forceSync, totalProofs])

  const isInFlight    = isBusy(phase)
  const isFormOrError = phase === "form" || phase === "error"
  const isSuccess     = phase === "success"

  return (
    <LiquidSheet
      open={open}
      onClose={onClose}
      tone="ink"
      accent="rgba(163,110,20,0.18)"
      disableDrag={isInFlight}
      lockDrag={isFormOrError}
      defaultFullscreen={isFormOrError}
    >
      <div className="flex flex-col"
        style={{
          height: isFormOrError ? "100%" : "auto",
          overflow: isSuccess ? "hidden" : undefined,
          transition: "height 600ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {/* ── Shared header ── */}
        <div className="shrink-0 px-6 pt-2 pb-1 text-center">
          <p className="text-[9px] tracking-[0.45em] uppercase mb-1" style={{ color: "#A36E14" }}>
            {isSuccess ? "Veil Lifted" : phase==="error" ? "Storm Rolled In" : "Emerge from shadow"}
          </p>
          <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]"
            style={{ color: "rgba(251,241,217,0.92)" }}>
            {isSuccess ? "Treasure reclaimed. ⚓" : phase==="error" ? "Unmask failed." : "Unmask MON"}
          </h3>
          <p className="mt-1 text-[11px] leading-snug" style={{ color: "rgba(251,241,217,0.5)" }}>
            {isSuccess
              ? "Your MON has returned to the open."
              : `${allUnspentUTXOs.length} note${allUnspentUTXOs.length!==1?"s":""} · ${ethers.formatEther(totalAvailable)} MON private`}
          </p>
        </div>

        {/* ── Phase image (slides left→right between phases) ── */}
        <div className="shrink-0 px-6 pt-1">
          <UnmaskPhaseImage phase={phase}/>
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
        <div className="shrink-0 px-6 pb-2"
          style={{
            opacity: isInFlight ? 1 : 0,
            maxHeight: isInFlight ? 130 : 0,
            overflow: "hidden",
            transition: "opacity 500ms ease, max-height 600ms cubic-bezier(0.22,1,0.36,1)",
            pointerEvents: isInFlight ? "auto" : "none",
          }}>
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-[11px] tracking-[0.2em] uppercase" style={{ color: "#A36E14" }}>{statusMsg}</p>
            {phase==="proving" && (
              <p className="text-[10px] max-w-[260px] leading-snug" style={{ color: "rgba(251,241,217,0.45)" }}>
                ZK proof runs in your browser. Keep this window open.
              </p>
            )}
            {phase==="proving" && totalProofs > 1 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl border"
                style={{ background:"rgba(251,241,217,0.03)", borderColor:"rgba(251,241,217,0.08)" }}>
                <span className="font-mono text-[11px] font-bold" style={{ color:"#A36E14" }}>{provenCount}/{totalProofs}</span>
                <span className="text-[10px]" style={{ color:"rgba(251,241,217,0.4)" }}>proofs generated</span>
              </div>
            )}
            <FlavorText phase={phase}/>
          </div>
        </div>

        {/* ── Success actions ── */}
        {isSuccess && (
          <div className="shrink-0 px-6 pb-4">
            {txHash && (
              <div className="rounded-2xl border p-3 flex items-start gap-3 mb-3"
                style={{ background:"rgba(5,150,105,0.08)", borderColor:"rgba(5,150,105,0.25)" }}>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background:"rgba(5,150,105,0.2)" }}>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7L5.5 10.5L12 4" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-emerald-500">Withdrawal confirmed</p>
                  <p className="text-[10px] mt-0.5" style={{ color:"rgba(251,241,217,0.55)" }}>
                    {ethers.formatEther(parsedAmt)} MON → <span className="font-mono">{fromAddress.slice(0,8)}…{fromAddress.slice(-6)}</span>
                  </p>
                  {txHash && <p className="font-mono text-[9px] mt-1 break-all" style={{ color:"rgba(251,241,217,0.4)" }}>{txHash}</p>}
                </div>
              </div>
            )}
            {/* Done button — same liquid glass as MaskModal */}
            <button onClick={onClose}
              className="w-full rounded-xl py-3 text-[11px] tracking-[0.25em] uppercase hover:-translate-y-[1px] transition-all"
              style={{
                background: "linear-gradient(145deg, rgba(251,241,217,0.07) 0%, rgba(232,174,58,0.06) 100%)",
                backdropFilter: "blur(20px) saturate(180%)",
                WebkitBackdropFilter: "blur(20px) saturate(180%)",
                border: "1px solid rgba(232,174,58,0.25)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(232,174,58,0.1)",
                color: "rgba(251,241,217,0.88)",
              }}>
              Done
            </button>
            {/* View on explorer — small text link */}
            {txHash && (
              <div className="flex justify-center mt-2">
                <a href={`https://testnet.monadexplorer.com/tx/${txHash}`}
                  target="_blank" rel="noreferrer"
                  className="text-[10px] tracking-[0.2em] uppercase hover:opacity-60 transition-opacity"
                  style={{ color: "rgba(251,241,217,0.35)" }}>
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

          {/* Destination chip */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border"
            style={{ background:"rgba(251,241,217,0.04)", borderColor:"rgba(251,241,217,0.08)" }}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
              style={{ background:"rgba(163,110,20,0.15)", border:"1px solid rgba(163,110,20,0.25)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A36E14" strokeWidth="1.5">
                <circle cx="12" cy="5" r="3"/>
                <line x1="12" y1="8" x2="12" y2="22"/>
                <path d="M5 15H2a10 10 0 0 0 20 0h-3"/>
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-[8px] tracking-[0.35em] uppercase mb-0.5" style={{ color:"rgba(251,241,217,0.35)" }}>
                Destination (your open address)
              </p>
              <p className="font-mono text-[11px] truncate" style={{ color:"rgba(251,241,217,0.7)" }}>
                {fromAddress || "—"}
              </p>
            </div>
          </div>

          {/* Amount */}
          <div>
            <div className="flex items-end justify-between mb-1.5">
              <label className="text-[9px] tracking-[0.3em] uppercase" style={{ color:"rgba(251,241,217,0.5)" }}>
                Amount (MON)
              </label>
              <button
                onClick={() => maxWithdrawable > 0n && setAmountEth(ethers.formatEther(maxWithdrawable))}
                className="text-[9px] tracking-[0.3em] uppercase" style={{ color:"#A36E14" }}>
                Max
              </button>
            </div>
            <input value={amountEth}
              onChange={e => {
                try {
                  const entered = ethers.parseEther(e.target.value || "0")
                  setAmountEth(entered > maxWithdrawable ? ethers.formatEther(maxWithdrawable) : e.target.value)
                } catch { setAmountEth(e.target.value) }
              }}
              placeholder="0.00"
              className="w-full rounded-xl px-4 py-3 text-[15px] font-mono focus:outline-none"
              style={{
                background: "rgba(251,241,217,0.05)",
                border: `1px solid ${insufficient ? "rgba(248,113,113,0.4)" : "rgba(251,241,217,0.1)"}`,
                color: "rgba(251,241,217,0.9)"
              }}
            />
            {maxWithdrawable > 0n && (
              <p className="mt-1 text-[9px]" style={{ color:"rgba(251,241,217,0.3)" }}>
                Max: {ethers.formatEther(maxWithdrawable)} MON
                <span className="ml-1" style={{ color:"rgba(251,241,217,0.2)" }}>
                  (after {ethers.formatEther(RELAYER_FEE)} MON fee)
                </span>
              </p>
            )}
          </div>

          {/* Fee breakdown — always visible */}
          <div className="rounded-xl overflow-hidden border"
            style={{ borderColor:"rgba(251,241,217,0.08)", background:"rgba(251,241,217,0.03)" }}>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color:"rgba(251,241,217,0.5)" }}>Withdraw</span>
              <span className="font-mono text-[11px]" style={{ color:"rgba(251,241,217,0.85)" }}>
                {parsedAmt > ZERO_BIG ? `${ethers.formatEther(parsedAmt)} MON` : "—"}
              </span>
            </div>
            <div className="h-px" style={{ background:"rgba(251,241,217,0.06)" }}/>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color:"rgba(251,241,217,0.5)" }}>Relayer fee (flat)</span>
              <span className="font-mono text-[11px]" style={{ color:"rgba(251,241,217,0.4)" }}>
                − {ethers.formatEther(RELAYER_FEE)} MON
              </span>
            </div>
            <div className="h-px" style={{ background:"rgba(251,241,217,0.06)" }}/>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color:"rgba(251,241,217,0.5)" }}>Total deducted</span>
              <span className="font-mono text-[11px]"
                style={{ color: insufficient ? "#f87171" : "rgba(251,241,217,0.85)" }}>
                {parsedAmt > ZERO_BIG ? `${ethers.formatEther(totalDeducted)} MON` : "—"}
              </span>
            </div>
            {parsedAmt > ZERO_BIG && !insufficient && (
              <>
                <div className="h-px" style={{ background:"rgba(251,241,217,0.06)" }}/>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color:"#A36E14" }}>You receive</span>
                  <span className="font-mono text-[11px] font-semibold" style={{ color:"#A36E14" }}>
                    {ethers.formatEther(parsedAmt)} MON
                  </span>
                </div>
              </>
            )}
            {insufficient && (
              <div className="px-4 py-3" style={{ background:"rgba(248,113,113,0.06)" }}>
                <p className="text-[10px] font-semibold text-red-400 mb-0.5">Insufficient balance</p>
                <p className="text-[10px] leading-relaxed" style={{ color:"rgba(251,241,217,0.45)" }}>
                  Need {ethers.formatEther(parsedAmt + RELAYER_FEE)} MON total. You have {ethers.formatEther(totalAvailable)} MON.
                </p>
              </div>
            )}
          </div>

          {/* Info note */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl border"
            style={{ background:"rgba(163,110,20,0.05)", borderColor:"rgba(163,110,20,0.12)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A36E14" strokeWidth="1.5" className="shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p className="text-[10px] leading-relaxed" style={{ color:"rgba(251,241,217,0.45)" }}>
              Funds return to your open address. A flat {ethers.formatEther(RELAYER_FEE)} MON fee covers the relayer.
              A ZK proof verifies ownership without exposing which notes you're spending.
            </p>
          </div>

          {/* Error block */}
          {phase==="error" && errorMsg && (
            <div className="p-3 rounded-xl border"
              style={{ background:"rgba(248,113,113,0.06)", borderColor:"rgba(248,113,113,0.25)" }}>
              <p className="text-[10px] font-semibold text-red-400 mb-0.5">Unmask Failed</p>
              <p className="text-[10px] break-words" style={{ color:"rgba(251,241,217,0.55)" }}>{errorMsg}</p>
            </div>
          )}

          {phase==="error" && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button onClick={() => { setPhase("form"); setErrorMsg(null) }}
                className="rounded-xl border py-3 text-[11px] tracking-[0.25em] uppercase"
                style={{ background:"rgba(251,241,217,0.04)", borderColor:"rgba(251,241,217,0.1)", color:"rgba(251,241,217,0.7)" }}>
                Try Again
              </button>
              <button onClick={onClose}
                className="rounded-xl border py-3 text-[11px] tracking-[0.25em] uppercase"
                style={{ background:"rgba(251,241,217,0.04)", borderColor:"rgba(251,241,217,0.1)", color:"rgba(251,241,217,0.6)" }}>
                Cancel
              </button>
            </div>
          )}

          <p className="text-center font-serif italic text-[11px]" style={{ color:"rgba(251,241,217,0.3)" }}>
            "Step out of the fog. The port awaits."
          </p>
          <div style={{ height: 8 }}/>
        </div>

        {/* ── Fixed footer slider ── */}
        {isFormOrError && (
          <div className="shrink-0 px-6 pt-3 pb-6"
            style={{ borderTop:"1px solid rgba(251,241,217,0.08)" }}>
            <ShipSlider canSubmit={canSubmit} phase={phase} onCommit={handleUnmask}/>
          </div>
        )}

      </div>
    </LiquidSheet>
  )
}