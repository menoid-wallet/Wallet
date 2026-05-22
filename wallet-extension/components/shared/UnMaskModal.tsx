/**
 * UnMaskModal.tsx
 *
 * "Unmask" — withdraw from the ZK private pool back to the open (public)
 * address of the same wallet.
 *
 * Uses the executeUnmask service from unmask.ts for clean separation of concerns:
 *   - Business logic (batching, proofs, contract interaction) → unmask.ts
 *   - UI state management & rendering → this component
 *
 * Key differences from the old web-dapp WithdrawModal:
 *   - No MetaMask. We sign the on-chain tx with `wallet.normalAccount.privateKey`
 *     via ethers.Wallet, exactly like SendModal does for open-mode sends.
 *   - Destination address is always `wallet.normalAccount.address` (no input needed).
 *   - Ship Slider (drag-to-commit) replaces the plain "Withdraw" button.
 *   - Ship Voyage progress bar (5 ports) replaces the dot StepIndicator.
 *
 * Fee model:
 *   ONE flat RELAYER_FEE (0.5 MON) across ALL batches.
 *   Fee is paid in the first batch that has enough headroom; earlier batches
 *   carry zero fee. maxWithdrawable = totalAvailable − RELAYER_FEE.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"
import { ethers } from "ethers"
import { useWallet } from "~context/WalletContext"
import { usePool } from "~context/PoolContext"
import { fetchRelayerKeys } from "~services/api"
import { executeUnmask } from "~services/unmask"
import LiquidSheet from "./LiquidSheet"
import shipImg from "../../assets/ship/ship.png"

// ─── Constants ────────────────────────────────────────────────────────────────
const RELAYER_FEE = ethers.parseEther("0.5")
const ZERO_BIG = BigInt(0)

// ─── Types ────────────────────────────────────────────────────────────────────
type Phase =
  | "form"
  | "relayer"
  | "building"
  | "proving"
  | "sending"
  | "success"
  | "error"

const VOYAGE_STEPS = ["Relayer", "Build", "Prove", "Send", "Done"]

// ─── Ship Slider ──────────────────────────────────────────────────────────
interface ShipSliderProps {
  canSubmit: boolean
  phase: Phase
  onCommit: () => void
}

function ShipSlider({ canSubmit, phase, onCommit }: ShipSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const dragStartX = useRef(0)
  const dragStartProgress = useRef(0)
  const committed = useRef(false)

  const THUMB_W = 52
  const COMMIT_THRESHOLD = 0.88
  const isInFlight = ["relayer", "building", "proving", "sending"].includes(phase)
  const isSuccess = phase === "success"
  const disabled = !canSubmit || isInFlight || isSuccess

  useEffect(() => {
    if (phase === "form") {
      committed.current = false
      setProgress(0)
      setDragging(false)
    }
  }, [phase])

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
      const trackW = trackRef.current?.clientWidth ?? 280
      const travelW = trackW - THUMB_W
      const delta = e.clientX - dragStartX.current
      const newP = Math.max(0, Math.min(1, dragStartProgress.current + delta / travelW))
      setProgress(newP)
      if (newP >= COMMIT_THRESHOLD && !committed.current) {
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
    if (!committed.current) setProgress(0)
  }, [dragging])

  const trackW = trackRef.current?.clientWidth ?? 280
  const travelW = Math.max(1, trackW - THUMB_W)
  const thumbX = progress * travelW

  let fillColor = "rgba(163,110,20,0.06)"
  let shipFilter = "drop-shadow(0 1px 2px rgba(23,19,17,0.5))"
  if (isInFlight) {
    fillColor = "rgba(218,162,28,0.22)"
    shipFilter = "drop-shadow(0 0 6px rgba(218,162,28,0.6))"
  } else if (isSuccess) {
    fillColor = "rgba(5,150,105,0.18)"
  } else if (canSubmit && progress > 0) {
    fillColor = `rgba(218,162,28,${0.08 + progress * 0.18})`
  }

  let trackLabel = ""
  if (isInFlight) trackLabel = "Sailing…"
  else if (isSuccess) trackLabel = "Voyage complete!"
  else if (!canSubmit) trackLabel = "Enter amount to unmask"
  else if (progress > 0.55) trackLabel = "Release to unmask!"
  else trackLabel = "Drag ship to unmask →"

  return (
    <div
      ref={trackRef}
      style={{
        position: "relative",
        width: "100%",
        height: 56,
        borderRadius: 28,
        border: isSuccess
          ? "1.5px solid rgba(5,150,105,0.35)"
          : canSubmit
            ? "1.5px solid rgba(232,174,58,0.4)"
            : "1.5px solid rgba(251,241,217,0.1)",
        background: isSuccess
          ? "rgba(5,150,105,0.10)"
          : canSubmit
            ? "rgba(232,174,58,0.07)"
            : "rgba(251,241,217,0.03)",
        overflow: "hidden",
        cursor: disabled ? "not-allowed" : "default",
        userSelect: "none",
        transition: "border-color 0.3s, background 0.3s"
      }}
    >
      {/* Fill */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: fillColor,
          width: isSuccess ? "100%" : `${thumbX + 26 + THUMB_W / 2}px`,
          borderRadius: "inherit",
          transition: dragging ? "none" : "width 0.4s cubic-bezier(0.22,1,0.36,1), background 0.4s",
          pointerEvents: "none"
        }}
      />
      {/* Wave */}
      <svg style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 18, opacity: canSubmit ? 0.2 : 0.07, pointerEvents: "none" }} viewBox="0 0 280 18" preserveAspectRatio="none">
        <path d="M0 12 Q35 4 70 12 Q105 20 140 12 Q175 4 210 12 Q245 20 280 12 L280 18 L0 18 Z" fill="#1a6b8a" />
      </svg>
      {/* Label */}
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", paddingLeft: isSuccess ? 16 : thumbX + THUMB_W + 4, paddingRight: 16, transition: "padding-left 0.1s" }}>
        <span style={{ fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", color: isSuccess ? "rgba(5,150,105,0.8)" : isInFlight ? "rgba(180,130,10,0.9)" : "rgba(251,241,217,0.4)", fontWeight: 600, whiteSpace: "nowrap", transition: "color 0.3s" }}>
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
          ...(isSuccess ? { right: 2, left: "auto" } : { left: thumbX }),
          width: THUMB_W,
          height: THUMB_W,
          transform: "translateY(-50%)",
          cursor: disabled ? "not-allowed" : dragging ? "grabbing" : "grab",
          transition: dragging ? "none" : "left 0.4s cubic-bezier(0.22,1,0.36,1)",
          filter: shipFilter,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          touchAction: "none",
          zIndex: 2
        }}
      >
        <img
          src={shipImg}
          alt="Drag to unmask"
          draggable={false}
          style={{
            width: 46, height: 46, objectFit: "contain", pointerEvents: "none",
            opacity: disabled && !isInFlight && !isSuccess ? 0.3 : 1,
            transition: "opacity 0.3s, transform 0.2s",
            transform: isInFlight ? "scale(1.08)" : dragging ? "scale(1.05) translateY(-1px)" : "scale(1)",
            animation: isInFlight ? "unmaskShipBob 1.2s ease-in-out infinite" : "none"
          }}
        />
      </div>
      <style>{`@keyframes unmaskShipBob { 0%,100%{transform:translateY(0) scale(1.08)} 50%{transform:translateY(-2px) scale(1.08)} }`}</style>
    </div>
  )
}

// ─── Ship Voyage (5 ports) ────────────────────────────────────────────────
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

function ShipVoyage({ phase }: { phase: Phase }) {
  const progress = phaseToProgress(phase)
  const docked = phase === "success"
  const SHIP_PX = 54

  return (
    <div className="relative pb-1">
      <div className="relative h-16">
        {/* Track */}
        <div className="absolute left-3 right-3 top-1/2 -translate-y-1/2 h-[2px] rounded-full" style={{ background: "rgba(251,241,217,0.12)" }} />
        {/* Wake */}
        <div
          className="absolute left-3 top-1/2 -translate-y-1/2 h-[2px] rounded-full transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ width: `calc((100% - 24px) * ${progress})`, background: "linear-gradient(to right, rgba(163,110,20,0.6), #DAA21C)" }}
        />
        {/* Port dots */}
        {VOYAGE_STEPS.map((_, i) => {
          const pp = i / (VOYAGE_STEPS.length - 1)
          const reached = progress >= pp - 0.001
          const isCurrent = Math.abs(progress - pp) < 0.02 && !docked
          return (
            <div key={i} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2" style={{ left: `calc(12px + (100% - 24px) * ${pp})` }}>
              <div className={`relative h-3 w-3 rounded-full border transition-all duration-300 ${reached ? "border-goldDeep bg-goldDeep" : "border-bone/20 bg-inkSoft"} ${isCurrent ? "scale-125" : ""}`}>
                {isCurrent && <span className="absolute inset-0 rounded-full bg-goldDeep/40 animate-ping" />}
              </div>
            </div>
          )
        })}
        {/* Ocean wave */}
        <svg className="absolute bottom-0 left-0 w-full pointer-events-none opacity-25" height="6" viewBox="0 0 380 6" preserveAspectRatio="none">
          <path d="M0 3 Q47 0 95 3 Q142 6 190 3 Q237 0 285 3 Q332 6 380 3" stroke="#1a6b8a" strokeWidth="1" fill="none" />
        </svg>
        {/* Ship */}
        <div
          className="absolute top-1/2 transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ left: `calc(12px + (100% - 24px) * ${progress})`, width: SHIP_PX, height: SHIP_PX, transform: "translate(-50%, -50%)" }}
        >
          <div style={{ width: "100%", height: "100%", animation: docked ? "none" : "unmaskVoyageBob 1.6s ease-in-out infinite" }}>
            <img
              src={shipImg}
              alt="ship"
              style={{
                width: SHIP_PX, height: SHIP_PX, display: "block",
                filter: docked
                  ? "drop-shadow(0 0 8px rgba(218,162,28,0.75)) drop-shadow(0 0 16px rgba(218,162,28,0.35))"
                  : "drop-shadow(0 1px 2px rgba(23,19,17,0.5))",
                transition: "filter 400ms"
              }}
              className="select-none pointer-events-none object-contain"
            />
          </div>
          {docked && (
            <span className="absolute left-1/2 text-[14px] pointer-events-none" style={{ bottom: -6, transform: "translateX(-50%)", animation: "unmaskAnchorDrop 0.7s cubic-bezier(0.22,1,0.36,1)" }}>
              ⚓
            </span>
          )}
        </div>
      </div>
      {/* Port labels */}
      <div className="relative mt-1 flex">
        {VOYAGE_STEPS.map((label, i) => {
          const pp = i / (VOYAGE_STEPS.length - 1)
          const reached = progress >= pp - 0.001
          return (
            <span key={label} className="absolute -translate-x-1/2 text-[8px] tracking-[0.15em] uppercase transition-colors duration-300" style={{ left: `calc(12px + (100% - 24px) * ${pp})`, color: reached ? "#A36E14" : "rgba(251,241,217,0.25)" }}>
              {label}
            </span>
          )
        })}
      </div>
      <style>{`
        @keyframes unmaskVoyageBob { 0%,100%{transform:translateY(-2px) rotate(-2deg)} 50%{transform:translateY(1px) rotate(2deg)} }
        @keyframes unmaskAnchorDrop { 0%{transform:translateX(-50%) translateY(-10px);opacity:0} 60%{transform:translateX(-50%) translateY(3px);opacity:1} 100%{transform:translateX(-50%) translateY(0);opacity:1} }
      `}</style>
      <div className="h-4" />
    </div>
  )
}

// ─── Main UnMaskModal ─────────────────────────────────────────────────────────
interface Props {
  open: boolean
  onClose: () => void
}

export default function UnMaskModal({ open, onClose }: Props) {
  const { wallet } = useWallet()
  const { allUnspentUTXOs, getMerkleProof, forceSync } = usePool()

  // open-mode keys (same pattern as SendModal)
  const fromAddress = wallet?.normalAccount?.address ?? ""
  const privateKey = wallet?.normalAccount?.privateKey ?? ""

  const noidAccount = wallet?.noidAccount

  const [amountEth, setAmountEth] = useState("")
  const [phase, setPhase] = useState<Phase>("form")
  const [statusMsg, setStatusMsg] = useState("")
  const [txHash, setTxHash] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [provenCount, setProvenCount] = useState(0)
  const [totalProofs, setTotalProofs] = useState(0)

  // Reset form state after close animation. LiquidSheet owns slide and ESC.
  useEffect(() => {
    if (open) return
    const id = setTimeout(() => resetState(), 320)
    return () => clearTimeout(id)
  }, [open])

  function resetState() {
    setPhase("form")
    setAmountEth("")
    setTxHash(null)
    setErrorMsg(null)
    setProvenCount(0)
    setTotalProofs(0)
    setStatusMsg("")
  }

  // ── derived ──
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

  const insufficient = parsedAmt > ZERO_BIG && (parsedAmt + RELAYER_FEE) > totalAvailable
  const totalDeducted = parsedAmt > ZERO_BIG ? parsedAmt + RELAYER_FEE : ZERO_BIG
  const canSubmit = parsedAmt > ZERO_BIG && !!privateKey && !!noidAccount && !insufficient

  // ── run withdrawal ──
  const handleUnmask = useCallback(async () => {
    if (!canSubmit || !noidAccount || !privateKey || !fromAddress) return
    setErrorMsg(null)
    setTxHash(null)
    setProvenCount(0)
    setTotalProofs(0)

    try {
      // 1. Relayer
      setPhase("relayer")
      setStatusMsg("Hailing the relayer…")
      const relayerKeys = await fetchRelayerKeys()

      // 2. Building
      setPhase("building")
      setStatusMsg("Selecting inputs and building plan…")

      // 3. Proving + Sending handled by executeUnmask
      setPhase("proving")

      const result = await executeUnmask({
        withdrawAmountMon: amountEth,
        toAddress: fromAddress,
        normalPrivateKey: privateKey,
        noidSecretKey: noidAccount.zkSecretKey,
        noidPublicKey: noidAccount.publicKey,
        noidZkPublicKey: noidAccount.zkPublicKey,
        relayerKeys,
        allUnspentUTXOs,
        getMerkleProof,
        onBatchStart: (batchNum, total) => {
          setTotalProofs(total)
          setStatusMsg(`Generating ZK proof ${batchNum} of ${total}…`)
        },
        onProofStart: (batchNum) => {
          setProvenCount(batchNum)
          if (totalProofs === 1) {
            setStatusMsg("Forging ZK proof…")
          } else {
            setStatusMsg(`Generating ZK proof ${batchNum} of ${totalProofs}…`)
          }
        },
        onSendTx: (hash) => {
          setPhase("sending")
          setStatusMsg("Broadcasting to Monad…")
          setTxHash(hash)
        }
      })

      setTxHash(result.hash)
      setPhase("success")

      // Refresh ZK pool state so spent notes are marked
      setTimeout(() => void forceSync(), 1500)
    } catch (err: any) {
      console.error("[UnMaskModal]", err)
      setPhase("error")
      
      // Extract the most useful error message from various error formats
      let errorMessage = "Unmask failed"
      
      // Try to extract actual error message from complex error structures
      if (err?.message) {
        // First check for common RPC errors
        if (err.message.includes("insufficient balance")) {
          errorMessage = "Signer had insufficient balance"
        } else if (err.message.includes("Insufficient balance")) {
          errorMessage = "Insufficient balance in pool"
        } else if (err.message.includes("insufficient funds")) {
          errorMessage = "Insufficient funds for transaction"
        } else if (err.message.includes("could not coalesce")) {
          // Try to extract error from nested structure
          if (err?.cause?.message) {
            errorMessage = err.cause.message
          } else if (err?.error?.message) {
            errorMessage = err.error.message
          } else {
            errorMessage = "Transaction failed - check balance and network"
          }
        } else {
          // Use the message directly if it's readable
          errorMessage = err.message
        }
      } else if (err?.reason) {
        errorMessage = err.reason
      } else if (err?.shortMessage) {
        errorMessage = err.shortMessage
      } else if (typeof err === "string") {
        errorMessage = err
      }
      
      setErrorMsg(errorMessage)
    }
  }, [
    canSubmit, noidAccount, privateKey, fromAddress,
    amountEth, allUnspentUTXOs, getMerkleProof,
    forceSync, totalProofs
  ])

  const inFlight = isInFlight(phase)

  return (
    <LiquidSheet
      open={open}
      onClose={onClose}
      tone="ink"
      disableDrag={inFlight}
      accent="rgba(163,110,20,0.18)">
      <div className="relative">
            {/* Header */}
            <div className="relative px-6 pt-2 pb-2 text-center">
              <p className="text-[9px] tracking-[0.45em] uppercase mb-1" style={{ color: "#A36E14" }}>
                {phase === "success" ? "Veil Lifted" : phase === "error" ? "Storm Rolled In" : "Emerge from shadow"}
              </p>
              <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]" style={{ color: "rgba(251,241,217,0.92)" }}>
                {phase === "success" ? "Treasure reclaimed. ⚓" : phase === "error" ? "Unmask failed." : "Unmask MON"}
              </h3>
              <p className="mt-1 text-[11px] leading-snug" style={{ color: "rgba(251,241,217,0.5)" }}>
                {phase === "success"
                  ? "Your MON has returned to the open."
                  : `${allUnspentUTXOs.length} note${allUnspentUTXOs.length !== 1 ? "s" : ""} · ${ethers.formatEther(totalAvailable)} MON private`}
              </p>
            </div>

            {/* Voyage progress */}
            {(inFlight || phase === "success") && (
              <div className="relative px-6 pt-4">
                <ShipVoyage phase={phase} />
              </div>
            )}

            {/* Body */}
            <div className="relative px-6 pt-4 pb-6 space-y-4 overflow-y-auto max-h-[65vh]">

              {/* ── FORM ── */}
              {(phase === "form" || phase === "error") && (
                <>
                  {/* Destination chip */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 rounded-2xl border"
                    style={{ background: "rgba(251,241,217,0.04)", borderColor: "rgba(251,241,217,0.08)" }}
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                      style={{ background: "rgba(163,110,20,0.15)", border: "1px solid rgba(163,110,20,0.25)" }}
                    >
                      {/* anchor / address icon */}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A36E14" strokeWidth="1.5">
                        <circle cx="12" cy="5" r="3" />
                        <line x1="12" y1="8" x2="12" y2="22" />
                        <path d="M5 15H2a10 10 0 0 0 20 0h-3" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[8px] tracking-[0.35em] uppercase mb-0.5" style={{ color: "rgba(251,241,217,0.35)" }}>Destination (your open address)</p>
                      <p className="font-mono text-[11px] truncate" style={{ color: "rgba(251,241,217,0.7)" }}>
                        {fromAddress || "—"}
                      </p>
                    </div>
                  </div>

                  {/* Amount */}
                  <div>
                    <div className="flex items-end justify-between mb-1.5">
                      <label className="text-[9px] tracking-[0.3em] uppercase" style={{ color: "rgba(251,241,217,0.5)" }}>
                        Amount (MON)
                      </label>
                      <button
                        onClick={() => maxWithdrawable > 0n && setAmountEth(ethers.formatEther(maxWithdrawable))}
                        className="text-[9px] tracking-[0.3em] uppercase transition-colors"
                        style={{ color: "#A36E14" }}
                      >
                        Max
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        value={amountEth}
                        onChange={e => {
                          try {
                            const entered = ethers.parseEther(e.target.value || "0")
                            setAmountEth(entered > maxWithdrawable ? ethers.formatEther(maxWithdrawable) : e.target.value)
                          } catch {
                            setAmountEth(e.target.value)
                          }
                        }}
                        placeholder="0.00"
                        className="w-full rounded-xl px-4 py-3 text-[15px] font-mono focus:outline-none transition-colors"
                        style={{
                          background: "rgba(251,241,217,0.05)",
                          border: `1px solid ${insufficient ? "rgba(248,113,113,0.4)" : "rgba(251,241,217,0.1)"}`,
                          color: "rgba(251,241,217,0.9)"
                        }}
                      />
                    </div>
                    {maxWithdrawable > 0n && (
                      <p className="mt-1 text-[9px]" style={{ color: "rgba(251,241,217,0.3)" }}>
                        Max: {ethers.formatEther(maxWithdrawable)} MON
                        <span className="ml-1" style={{ color: "rgba(251,241,217,0.2)" }}>
                          (after {ethers.formatEther(RELAYER_FEE)} MON fee)
                        </span>
                      </p>
                    )}
                  </div>

                  {/* Fee breakdown */}
                  {parsedAmt > ZERO_BIG && (
                    <div className="rounded-xl overflow-hidden border" style={{ borderColor: "rgba(251,241,217,0.08)", background: "rgba(251,241,217,0.03)" }}>
                      <div className="flex justify-between px-4 py-2.5">
                        <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: "rgba(251,241,217,0.5)" }}>Withdraw</span>
                        <span className="font-mono text-[11px]" style={{ color: "rgba(251,241,217,0.85)" }}>{ethers.formatEther(parsedAmt)} MON</span>
                      </div>
                      <div className="h-px" style={{ background: "rgba(251,241,217,0.06)" }} />
                      <div className="flex justify-between px-4 py-2.5">
                        <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: "rgba(251,241,217,0.5)" }}>Relayer fee (flat)</span>
                        <span className="font-mono text-[11px]" style={{ color: "rgba(251,241,217,0.4)" }}>− {ethers.formatEther(RELAYER_FEE)} MON</span>
                      </div>
                      <div className="h-px" style={{ background: "rgba(251,241,217,0.06)" }} />
                      <div className="flex justify-between px-4 py-2.5">
                        <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: "rgba(251,241,217,0.5)" }}>Total deducted</span>
                        <span className="font-mono text-[11px]" style={{ color: insufficient ? "#f87171" : "rgba(251,241,217,0.85)" }}>
                          {ethers.formatEther(totalDeducted)} MON
                        </span>
                      </div>
                      {!insufficient && (
                        <>
                          <div className="h-px" style={{ background: "rgba(251,241,217,0.06)" }} />
                          <div className="flex justify-between px-4 py-2.5">
                            <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: "#A36E14" }}>You receive</span>
                            <span className="font-mono text-[11px] font-semibold" style={{ color: "#A36E14" }}>{ethers.formatEther(parsedAmt)} MON</span>
                          </div>
                        </>
                      )}
                      {insufficient && (
                        <div className="px-4 py-3" style={{ background: "rgba(248,113,113,0.06)" }}>
                          <p className="text-[10px] font-semibold text-red-400 mb-0.5">Insufficient balance</p>
                          <p className="text-[10px] leading-relaxed" style={{ color: "rgba(251,241,217,0.45)" }}>
                            Need {ethers.formatEther(parsedAmt + RELAYER_FEE)} MON total.
                            You have {ethers.formatEther(totalAvailable)} MON.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Info note */}
                  <div className="flex items-start gap-2.5 p-3 rounded-xl border" style={{ background: "rgba(163,110,20,0.05)", borderColor: "rgba(163,110,20,0.12)" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A36E14" strokeWidth="1.5" className="shrink-0 mt-0.5">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <p className="text-[10px] leading-relaxed" style={{ color: "rgba(251,241,217,0.45)" }}>
                      Funds return to your open address. A flat {ethers.formatEther(RELAYER_FEE)} MON fee covers the relayer. A ZK proof verifies ownership without exposing which notes you're spending.
                    </p>
                  </div>

                  {/* Error block */}
                  {phase === "error" && errorMsg && (
                    <div className="p-3 rounded-xl border" style={{ background: "rgba(248,113,113,0.06)", borderColor: "rgba(248,113,113,0.25)" }}>
                      <p className="text-[10px] font-semibold text-red-400 mb-0.5">Unmask Failed</p>
                      <p className="text-[10px] break-words" style={{ color: "rgba(251,241,217,0.55)" }}>{errorMsg}</p>
                    </div>
                  )}

                  {/* Slider */}
                  <ShipSlider canSubmit={canSubmit} phase={phase} onCommit={handleUnmask} />

                  {/* Footer buttons for error */}
                  {phase === "error" && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        onClick={() => { setPhase("form"); setErrorMsg(null) }}
                        className="rounded-xl border py-3 text-[11px] tracking-[0.25em] uppercase transition-colors"
                        style={{ background: "rgba(251,241,217,0.04)", borderColor: "rgba(251,241,217,0.1)", color: "rgba(251,241,217,0.7)" }}
                      >
                        Try Again
                      </button>
                      <button
                        onClick={onClose}
                        className="rounded-xl border py-3 text-[11px] tracking-[0.25em] uppercase transition-colors"
                        style={{ background: "rgba(251,241,217,0.04)", borderColor: "rgba(251,241,217,0.1)", color: "rgba(251,241,217,0.6)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  <p className="text-center font-serif italic text-[11px]" style={{ color: "rgba(251,241,217,0.3)" }}>
                    "Step out of the fog. The port awaits."
                  </p>
                </>
              )}

              {/* ── BUSY ── */}
              {inFlight && (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <p className="text-[11px] tracking-[0.2em] uppercase" style={{ color: "#A36E14" }}>{statusMsg}</p>
                  {phase === "proving" && (
                    <>
                      <p className="text-[10px] max-w-[260px] leading-snug" style={{ color: "rgba(251,241,217,0.45)" }}>
                        ZK proof runs in your browser. Keep this window open.
                      </p>
                      {totalProofs > 1 && (
                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl border" style={{ background: "rgba(251,241,217,0.03)", borderColor: "rgba(251,241,217,0.08)" }}>
                          <span className="font-mono text-[11px] font-bold" style={{ color: "#A36E14" }}>{provenCount}/{totalProofs}</span>
                          <span className="text-[10px]" style={{ color: "rgba(251,241,217,0.4)" }}>proofs generated</span>
                        </div>
                      )}
                    </>
                  )}
                  {phase === "sending" && txHash && (
                    <p className="font-mono text-[9px] break-all max-w-[280px]" style={{ color: "rgba(251,241,217,0.4)" }}>{txHash}</p>
                  )}
                </div>
              )}

              {/* ── SUCCESS ── */}
              {phase === "success" && (
                <div>
                  <div className="rounded-2xl border p-4 flex items-start gap-3" style={{ background: "rgba(5,150,105,0.08)", borderColor: "rgba(5,150,105,0.25)" }}>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "rgba(5,150,105,0.2)" }}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 7L5.5 10.5L12 4" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold text-emerald-500">Withdrawal confirmed</p>
                      <p className="text-[11px] mt-0.5" style={{ color: "rgba(251,241,217,0.55)" }}>
                        {ethers.formatEther(parsedAmt)} MON → <span className="font-mono">{fromAddress.slice(0, 8)}…{fromAddress.slice(-6)}</span>
                      </p>
                      {txHash && (
                        <p className="font-mono text-[9px] mt-1 break-all" style={{ color: "rgba(251,241,217,0.4)" }}>{txHash}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    {txHash && (
                      <a
                        href={`https://testnet.monadexplorer.com/tx/${txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-xl border py-3 text-[11px] tracking-[0.25em] uppercase text-center transition-colors"
                        style={{ background: "rgba(251,241,217,0.04)", borderColor: "rgba(251,241,217,0.1)", color: "rgba(251,241,217,0.7)" }}
                      >
                        Explorer ↗
                      </a>
                    )}
                    <button
                      onClick={onClose}
                      className="rounded-xl py-3 text-[11px] tracking-[0.25em] uppercase hover:-translate-y-[1px] transition"
                      style={{ background: "rgba(163,110,20,0.9)", color: "#171311" }}
                    >
                      Done
                    </button>
                  </div>
                  <p className="mt-3 text-center font-serif italic text-[11px]" style={{ color: "rgba(251,241,217,0.35)" }}>
                    "The fog parts. Yer gold sails free."
                  </p>
                </div>
              )}
            </div>
      </div>
    </LiquidSheet>
  )
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function isInFlight(p: Phase): boolean {
  return ["relayer", "building", "proving", "sending"].includes(p)
}