/**
 * NoidSendModal.tsx
 *
 * Phase layout:
 *   form/error  → fullscreen, no drag, slider fixed at bottom
 *   in-flight   → partial sheet, draggable (no fullscreen snap)
 *   success     → partial sheet, draggable (no fullscreen snap), auto-height (no scroll)
 *
 * Transition polish:
 *   - Modal size: single wrapper with animated min-height so sheet grows/shrinks smoothly
 *   - Images: crossfade via opacity between phases
 *   - ShipVoyage: wavy SVG track path; anchor waits for ship to arrive before dropping
 *   - Ship position: always animated from previous port, never teleports
 */

import React, {
  useCallback, useEffect, useMemo, useRef, useState
} from "react"
import { ethers } from "ethers"
import * as snarkjs from "snarkjs"
import { buildPoseidon } from "circomlibjs"
import { useWallet } from "../../context/WalletContext"
import { usePool } from "../../context/PoolContext"
import { useThemeTokens } from "../../lib/useThemeTokens"
import { BASE_URL } from "../../services/api"
import { saveNoidSendTx } from "../../lib/txStore"
import LiquidSheet from "./LiquidSheet"
import shipImg      from "../../assets/ship/ship.png"
import noidShipImg  from "../../assets/ship/noid_transfer.png"
import nightShipImg from "../../assets/ship/night_ship.png"
import successImg   from "../../assets/ship/hidden_transfer_successful.png"
import { zkAssetUrl } from "~services/mask"
import { createCommitment } from "~crypto/commitment"

// Preload images
;[noidShipImg, nightShipImg, successImg].forEach(src => {
  const i = new Image(); i.src = src
})

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_INPUTS = 4
const ZERO_HASH  = "0x0000000000000000000000000000000000000000000000000000000000000000"
const ZERO_BIG   = BigInt(0)

// Per-network fee constants:
//   monad        → 0.5 MON per call,   +0.1    on retry
//   sepolia      → 0.003 ETH per call, +0.002  on retry
//   base_sepolia → 0.00005 ETH per call, +0.00003 on retry
function getFeePerCall(networkId: string): bigint {
  if (networkId === "monad")        return ethers.parseEther("0.5")
  if (networkId === "base_sepolia") return ethers.parseEther("0.00005")
  return ethers.parseEther("0.003")   // sepolia
}
function getFeeRetryExtra(networkId: string): bigint {
  if (networkId === "monad")        return ethers.parseEther("0.1")
  if (networkId === "base_sepolia") return ethers.parseEther("0.00003")
  return ethers.parseEther("0.002")   // sepolia
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface NoidUser {
  _id: string; name: string
  noidModePublicKey: string; zkPublicKey: string
}
interface ParsedRecipient { ecPublicKey: string; zkPublicKey: string }
type Phase = "form"|"relayer"|"building"|"proving"|"sending"|"success"|"error"
const VOYAGE_STEPS = ["Relayer","Build","Prove","Send","Done"]

// ─── Poseidon ─────────────────────────────────────────────────────────────────
let _poseidon: any = null
async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon()
  return _poseidon
}

// ─── Planner ──────────────────────────────────────────────────────────────────
function feePerCall(isRetry = false, networkId = "monad"): bigint {
  const base  = getFeePerCall(networkId)
  const extra = getFeeRetryExtra(networkId)
  return isRetry ? base + extra : base
}
function planTransfer(
  unspent: any[], transferAmt: bigint, isRetry = false, networkId = "monad"
): { plans: any[]; numCalls: number; totalFee: bigint } | null {
  if (!unspent?.length || transferAmt <= ZERO_BIG) return null
  const fee = feePerCall(isRetry, networkId)
  const sorted = [...unspent].sort((a,b) => {
    const d = BigInt(b.amount) - BigInt(a.amount)
    return d > 0n ? 1 : d < 0n ? -1 : 0
  })
  let N = 1
  for (let iter = 0; iter < 20; iter++) {
    const need = transferAmt + fee * BigInt(N)
    const sel: any[] = []; let acc = ZERO_BIG
    for (const u of sorted) { if (acc >= need) break; sel.push(u); acc += BigInt(u.amount) }
    if (acc < need) return null
    const calls = Math.ceil(sel.length / MAX_INPUTS)
    if (calls <= N) return buildPlans(sel, transferAmt, fee, N)
    N = calls
  }
  return null
}
function buildPlans(
  sel: any[], transferAmt: bigint, fee: bigint, _N: number
): { plans: any[]; numCalls: number; totalFee: bigint } {
  const flat = [...sel]; const batches: any[][] = []
  while (flat.length > 0) batches.push(flat.splice(0, MAX_INPUTS))
  const plans: any[] = []; let rem = transferAmt
  for (const b of batches) {
    const tot = b.reduce((s:bigint,u:any) => s + BigInt(u.amount), ZERO_BIG)
    const avail = tot - fee
    const toRec = rem <= avail ? rem : avail
    const change = tot - fee - toRec
    rem -= toRec
    plans.push({ inputs: b, receiverAmt: toRec, changeAmt: change, feeAmt: fee })
  }
  if (rem > ZERO_BIG) return { plans: [], numCalls: 0, totalFee: 0n }
  return { plans, numCalls: batches.length, totalFee: fee * BigInt(batches.length) }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toBytes32(v: string|bigint): string {
  return ethers.zeroPadValue(ethers.toBeHex(BigInt(v)), 32)
}
function randomR(): string { return ethers.toBigInt(ethers.randomBytes(31)).toString() }
function encryptNote(data: object, pk: string): string {
  const { encryptMessage } = require("../../lib/crypto")
  return encryptMessage(JSON.stringify(data), pk)
}
function isBusy(p: Phase): boolean {
  return ["relayer","building","proving","sending"].includes(p)
}
function parseNoidKey(raw: string): ParsedRecipient | null {
  const t = raw.trim(); const idx = t.lastIndexOf("|")
  if (idx < 1) return null
  const ec = t.slice(0, idx).trim(); const zk = t.slice(idx+1).trim()
  if (!ec || !zk) return null
  return { ecPublicKey: ec, zkPublicKey: zk }
}

// ─── buildTransferCall ────────────────────────────────────────────────────────
async function buildTransferCall(
  inputs: any[], receiverAmt: bigint, changeAmt: bigint, feeAmt: bigint,
  receiver: ParsedRecipient,
  sender: { zk: { secretKey: string; publicKey: string }; privateWallet: { publicKey: string } },
  relayer: { zkPublicKey: string; publicKey: string },
  getMerkleProof: (poolId: string, leafIndex: number) => any
) {
  const poseidon = await getPoseidon()
  const padded = [...inputs]
  while (padded.length < MAX_INPUTS) padded.push(null)
  const enabled: number[] = [], c_ins: string[] = [], a_ins: string[] = []
  const r_ins: string[] = [], roots: string[] = [], pathElements: string[][] = []
  const pathIndices: number[][] = [], nullifiers: string[] = [], poolIds: number[] = []
  const rootsBytes32: string[] = [], nullifiersBytes32: string[] = []
  for (const utxo of padded) {
    if (!utxo) {
      enabled.push(0); c_ins.push("0"); a_ins.push("0"); r_ins.push("0"); roots.push("0")
      pathElements.push(Array(20).fill("0")); pathIndices.push(Array(20).fill(0))
      nullifiers.push("0"); poolIds.push(0); rootsBytes32.push(ZERO_HASH); nullifiersBytes32.push(ZERO_HASH)
      continue
    }
    enabled.push(1)
    const mp = getMerkleProof(utxo.poolId, utxo.leafIndex)
    if (!mp) throw new Error(`No Merkle proof for leaf ${utxo.leafIndex}`)
    const rootBig = mp.root.toString()
    const nullifier = poseidon.F.toString(
      poseidon([2n, BigInt(utxo.commitment), BigInt(utxo.randomness), BigInt(sender.zk.secretKey)])
    )
    c_ins.push(BigInt(utxo.commitment).toString()); a_ins.push(utxo.amount)
    r_ins.push(utxo.randomness); roots.push(rootBig)
    pathElements.push(mp.siblings.map((s:any) => s[0].toString()))
    pathIndices.push(mp.pathIndices); nullifiers.push(nullifier)
    poolIds.push(typeof utxo.poolId === "number" ? utxo.poolId : parseInt(utxo.poolId)||0)
    rootsBytes32.push(toBytes32(rootBig)); nullifiersBytes32.push(toBytes32(nullifier))
  }
  const rR = randomR(), rC = randomR(), rRel = randomR()
  const rE = receiverAmt > ZERO_BIG ? 1 : 0
  const cE = changeAmt > ZERO_BIG ? 1 : 0
  const fE = feeAmt > ZERO_BIG ? 1 : 0
  const rCom = await createCommitment(receiverAmt.toString(), rR, receiver.zkPublicKey)
  const cCom = await createCommitment(changeAmt.toString(), rC, sender.zk.publicKey)
  const fCom = await createCommitment(feeAmt.toString(), rRel, relayer.zkPublicKey)
  const n1 = encryptNote({ amount: receiverAmt.toString(), randomness: rR }, receiver.ecPublicKey)
  const n2 = encryptNote({ amount: changeAmt.toString(), randomness: rC }, sender.privateWallet.publicKey)
  const n3 = encryptNote({ amount: feeAmt.toString(), randomness: rRel }, relayer.publicKey)
  const ci = {
    sk: sender.zk.secretKey, pk: sender.zk.publicKey, relayer: relayer.zkPublicKey,
    enabled, c_ins, a_ins, r_ins, roots, pathElements, pathIndices, nullifiers,
    output_enabled: [rE, cE, fE],
    c_outs: [rE ? rCom.decimal:"0", cE ? cCom.decimal:"0", fE ? fCom.decimal:"0"],
    a_outs: [receiverAmt.toString(), changeAmt.toString(), feeAmt.toString()],
    r_outs: [rR, rC, rRel],
    receivers: [receiver.zkPublicKey, sender.zk.publicKey, relayer.zkPublicKey]
  }
  console.log("ci:",ci);
  const { proof: zkProof, publicSignals } = await (snarkjs as any).groth16.fullProve(
    ci, zkAssetUrl("transfer_proof.wasm"), zkAssetUrl("transfer_proof_final.zkey")
  )
  const calldata = await (snarkjs as any).groth16.exportSolidityCallData(zkProof, publicSignals)
  const argv = calldata.replace(/["[\]\s]/g,"").split(",")
  return {
    transferCall: {
      a: [argv[0],argv[1]], b: [[argv[2],argv[3]],[argv[4],argv[5]]], c: [argv[6],argv[7]],
      inputs: { enabled, roots: rootsBytes32, poolIds, nullifiers: nullifiersBytes32 },
      C1: rE ? rCom.bytes32 : ZERO_HASH, C2: cE ? cCom.bytes32 : ZERO_HASH, C3: fE ? fCom.bytes32 : ZERO_HASH,
      encryptedNote1: n1, encryptedNote2: n2, encryptedNote3: n3
    }, zkProof
  }
}

// ─── ShipVoyage ───────────────────────────────────────────────────────────────
// Wave path points for the track (SVG coords for a 380px wide, 10px tall wave)
const WAVE_PATH = "M0 5 Q24 1 47 5 Q71 9 95 5 Q118 1 142 5 Q166 9 190 5 Q213 1 237 5 Q261 9 285 5 Q308 1 332 5 Q356 9 380 5"

function phaseToProgress(p: Phase): number {
  switch(p) {
    case "relayer":  return 0
    case "building": return 0.25
    case "proving":  return 0.5
    case "sending":  return 0.75
    case "success":  return 1
    default:         return 0
  }
}

function ShipVoyage({ phase }: { phase: Phase }) {
  const progress = phaseToProgress(phase)
  const docked   = phase === "success"
  const SHIP_PX  = 48
  // Anchor only drops after ship finishes its 900ms journey
  // We delay showing the anchor by 950ms from when docked becomes true
  const [showAnchor, setShowAnchor] = useState(false)
  useEffect(() => {
    if (!docked) { setShowAnchor(false); return }
    const t = setTimeout(() => setShowAnchor(true), 950)
    return () => clearTimeout(t)
  }, [docked])

  return (
    <div className="relative pb-1 px-1">
      {/* Track area — h-14 to give wave room */}
      <div className="relative h-14">

        {/* Background wave track */}
        <svg
          className="absolute inset-x-3 pointer-events-none"
          style={{ top: "50%", transform: "translateY(-50%)", height: 10, width: "calc(100% - 24px)" }}
          viewBox="0 0 380 10" preserveAspectRatio="none"
        >
          <path d={WAVE_PATH} stroke="rgba(251,241,217,0.12)" strokeWidth="1.5" fill="none" />
        </svg>

        {/* Gold wake that fills as ship advances */}
        <div
          className="absolute pointer-events-none overflow-hidden"
          style={{
            left: 12, top: "50%", transform: "translateY(-50%)",
            width: `calc((100% - 24px) * ${progress})`,
            height: 10,
            transition: "width 900ms cubic-bezier(0.22,1,0.36,1)"
          }}
        >
          <svg
            style={{ width: "380px", height: 10, maxWidth: "none" }}
            viewBox="0 0 380 10" preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="wakeGrad" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="rgba(163,110,20,0.5)" />
                <stop offset="100%" stopColor="#DAA21C" />
              </linearGradient>
            </defs>
            <path d={WAVE_PATH} stroke="url(#wakeGrad)" strokeWidth="2" fill="none" />
          </svg>
        </div>

        {/* Port dots */}
        {VOYAGE_STEPS.map((_, i) => {
          const pp      = i / (VOYAGE_STEPS.length - 1)
          const reached = progress >= pp - 0.001
          const isCur   = !docked && Math.abs(progress - pp) < 0.02
          return (
            <div
              key={i}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `calc(12px + (100% - 24px) * ${pp})` }}
            >
              <div className={`relative h-3 w-3 rounded-full border transition-all duration-500
                ${reached ? "border-goldDeep bg-goldDeep" : "border-bone/20 bg-inkSoft"}
                ${isCur ? "scale-125" : ""}`}
              >
                {isCur && <span className="absolute inset-0 rounded-full bg-goldDeep/40 animate-ping" />}
              </div>
            </div>
          )
        })}

        {/* Ship — slides along wave path */}
        <div
          className="absolute top-1/2 -translate-x-1/2"
          style={{
            left: `calc(12px + (100% - 24px) * ${progress})`,
            width: SHIP_PX, height: SHIP_PX,
            marginTop: -SHIP_PX / 2,
            transition: "left 900ms cubic-bezier(0.22,1,0.36,1)",
            zIndex: 2,
          }}
        >
          <div style={{
            width: "100%", height: "100%",
            animation: docked ? "none" : "voyShipBob 1.6s ease-in-out infinite"
          }}>
            <img
              src={shipImg}
              alt="ship"
              draggable={false}
              style={{
                width: SHIP_PX, height: SHIP_PX,
                objectFit: "contain", display: "block",
                filter: docked
                  ? "drop-shadow(0 0 8px rgba(218,162,28,0.8)) drop-shadow(0 0 20px rgba(218,162,28,0.4))"
                  : "drop-shadow(0 1px 3px rgba(0,0,0,0.6))",
                transition: "filter 600ms ease",
              }}
              className="select-none pointer-events-none"
            />
          </div>

          {/* Anchor — only appears after ship finishes journey */}
          {showAnchor && (
            <span
              className="absolute left-1/2 text-[13px] pointer-events-none"
              style={{
                bottom: -4,
                transform: "translateX(-50%)",
                animation: "voyAnchorDrop 0.6s cubic-bezier(0.22,1,0.36,1) forwards"
              }}
            >
              ⚓
            </span>
          )}
        </div>
      </div>

      {/* Port labels */}
      <div className="relative mt-1" style={{ height: 14 }}>
        {VOYAGE_STEPS.map((label, i) => {
          const pp      = i / (VOYAGE_STEPS.length - 1)
          const reached = progress >= pp - 0.001
          return (
            <span
              key={label}
              className="absolute -translate-x-1/2 text-[8px] tracking-[0.15em] uppercase transition-colors duration-500"
              style={{ left: `calc(12px + (100% - 24px) * ${pp})`, color: reached ? "#A36E14" : "rgba(251,241,217,0.25)" }}
            >
              {label}
            </span>
          )
        })}
      </div>

      {docked && (
        <p className="text-center text-[9px] tracking-[0.2em] uppercase mt-3"
          style={{ color: "rgba(163,110,20,0.7)" }}>
          Ship docked at port
        </p>
      )}

      <style>{`
        @keyframes voyShipBob {
          0%,100% { transform: translateY(-2px) rotate(-2deg); }
          50%      { transform: translateY(2px) rotate(2deg); }
        }
        @keyframes voyAnchorDrop {
          0%   { transform: translateX(-50%) translateY(-8px); opacity: 0; }
          65%  { transform: translateX(-50%) translateY(2px);  opacity: 1; }
          100% { transform: translateX(-50%) translateY(0px);  opacity: 1; }
        }
        @keyframes nightShipFloat {
          0%, 100% { transform: translateY(0px) rotate(-1deg); }
          50%       { transform: translateY(-8px) rotate(1deg); }
        }
        @keyframes noidShipFloat {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-5px); }
        }
        @keyframes noidShipSail {
          0%   { transform: translateY(0px)  rotate(-6deg) scale(1.05); }
          25%  { transform: translateY(-4px) rotate(0deg)  scale(1.08); }
          50%  { transform: translateY(0px)  rotate(6deg)  scale(1.05); }
          75%  { transform: translateY(-4px) rotate(0deg)  scale(1.08); }
          100% { transform: translateY(0px)  rotate(-6deg) scale(1.05); }
        }
      `}</style>
    </div>
  )
}

// ─── Ship Slider ──────────────────────────────────────────────────────────────
interface ShipSliderProps { canSubmit: boolean; phase: Phase; onCommit: () => void }
function ShipSlider({ canSubmit, phase, onCommit }: ShipSliderProps) {
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

  let fillColor  = "rgba(163,110,20,0.06)"
  let shipFilter = "drop-shadow(0 1px 2px rgba(23,19,17,0.5))"
  if (isInFlight)             { fillColor = "rgba(218,162,28,0.22)"; shipFilter = "drop-shadow(0 0 6px rgba(218,162,28,0.6))" }
  else if (phase==="success") { fillColor = "rgba(5,150,105,0.18)" }
  else if (canSubmit && progress > 0) { fillColor = `rgba(218,162,28,${0.08 + progress * 0.18})` }

  let fillExtra = 0; let trackLabel = ""
  if      (isInFlight)          { trackLabel = "Voyage in progress…"; fillExtra = 9999 }
  else if (phase === "success") { trackLabel = "Voyage complete!";    fillExtra = 9999 }
  else if (!canSubmit)          { trackLabel = "Fill in details to sail" }
  else if (progress > 0.55)     { trackLabel = "Release to send!" }
  else                          { trackLabel = "Drag ship to send →" }

  const thumbPos: React.CSSProperties = isInFlight
    ? { left: "50%", right: "auto", transform: "translate(-50%, -50%)", transition: "left 0.6s cubic-bezier(0.22,1,0.36,1), filter 0.3s" }
    : phase === "success"
    ? { right: 2, left: "auto", transform: "translateY(-50%)", transition: "filter 0.3s" }
    : { left: thumbX, right: "auto", transform: "translateY(-50%)", transition: dragging ? "none" : "left 0.4s cubic-bezier(0.22,1,0.36,1), filter 0.3s" }

  return (
    <div ref={trackRef} style={{
      position: "relative", width: "100%", height: 56, borderRadius: 28,
      border: phase==="success" ? "1.5px solid rgba(5,150,105,0.35)" : canSubmit ? "1.5px solid rgba(232,174,58,0.4)" : "1.5px solid rgba(251,241,217,0.1)",
      background: phase==="success" ? "rgba(5,150,105,0.10)" : canSubmit ? "rgba(232,174,58,0.07)" : "rgba(251,241,217,0.03)",
      overflow: "hidden", cursor: disabled ? "not-allowed" : "default",
      userSelect: "none", transition: "border-color 0.3s, background 0.3s",
    }}>
      <div style={{
        position:"absolute", inset:0, background: fillColor,
        width: `${thumbX + fillExtra + 26 + THUMB_W/2}px`, borderRadius:"inherit",
        transition: dragging ? "none" : "width 0.4s cubic-bezier(0.22,1,0.36,1), background 0.4s", pointerEvents:"none",
      }}/>
      <svg style={{ position:"absolute", bottom:0, left:0, width:"100%", height:18,
        opacity: isInFlight ? 0.45 : canSubmit ? 0.2 : 0.07, pointerEvents:"none", overflow:"visible", transition:"opacity 0.5s" }}
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
          whiteSpace:"nowrap", transition:"color 0.3s",
          color: phase==="success" ? "rgba(5,150,105,0.8)" : isInFlight ? "rgba(180,130,10,0.9)" : "rgba(251,241,217,0.4)" }}>
          {trackLabel}
        </span>
      </div>
      <div
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onLostPointerCapture={() => onPointerUp()}
        style={{ position:"absolute", top:"50%", ...thumbPos,
          width:THUMB_W, height:THUMB_W,
          cursor: disabled ? "not-allowed" : dragging ? "grabbing" : "grab",
          display:"flex", alignItems:"center", justifyContent:"center",
          touchAction:"none", zIndex:2, filter:shipFilter }}
      >
        <img src={shipImg} alt="Drag to send" draggable={false}
          style={{ width:46, height:46, objectFit:"contain", pointerEvents:"none",
            opacity: disabled && !isInFlight && phase!=="success" ? 0.3 : 1,
            transition:"opacity 0.3s",
            transform: dragging ? "scale(1.07) translateY(-2px)" : "scale(1)",
            animation: isInFlight ? "noidShipSail 1.4s ease-in-out infinite"
              : dragging ? "none" : "noidShipFloat 3s ease-in-out infinite" }}
        />
      </div>
    </div>
  )
}

// ─── FeeBreakdown ─────────────────────────────────────────────────────────────
function FeeBreakdown({ parsedAmt, feeResult, totalAvailable, isRetry, networkId, nativeCurrency }: {
  parsedAmt: bigint; feeResult: ReturnType<typeof planTransfer>; totalAvailable: bigint; isRetry: boolean; networkId: string; nativeCurrency: string
}) {
  if (!feeResult || parsedAmt <= ZERO_BIG) return null
  const { numCalls, totalFee } = feeResult
  const totalNeeded = parsedAmt + totalFee
  const insufficient = totalAvailable < totalNeeded
  const perCallLabel = ethers.formatEther(feePerCall(false, networkId))
  const perCallRetryLabel = ethers.formatEther(feePerCall(true, networkId))
  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor:"rgba(251,241,217,0.08)", background:"rgba(251,241,217,0.03)" }}>
      <div className="flex justify-between px-4 py-2.5">
        <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color:"rgba(251,241,217,0.5)" }}>Send</span>
        <span className="font-mono text-[11px]" style={{ color:"rgba(251,241,217,0.85)" }}>{ethers.formatEther(parsedAmt)} {nativeCurrency}</span>
      </div>
      <div className="h-px" style={{ background:"rgba(251,241,217,0.06)" }}/>
      <div className="flex justify-between items-start px-4 py-2.5">
        <div>
          <span className="block text-[10px] tracking-[0.2em] uppercase" style={{ color:"rgba(251,241,217,0.5)" }}>Relayer fee</span>
          <span className="block text-[9px] mt-0.5" style={{ color:"rgba(251,241,217,0.3)" }}>
            {numCalls} call{numCalls>1?"s":""} × {isRetry ? perCallRetryLabel : perCallLabel} {nativeCurrency}
            {isRetry && <span style={{ color:"rgba(245,158,11,0.7)" }}> (retry)</span>}
          </span>
        </div>
        <span className="font-mono text-[11px]" style={{ color:"rgba(251,241,217,0.45)" }}>− {ethers.formatEther(totalFee)} {nativeCurrency}</span>
      </div>
      <div className="h-px" style={{ background:"rgba(251,241,217,0.06)" }}/>
      <div className="flex justify-between px-4 py-2.5">
        <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color:"rgba(251,241,217,0.5)" }}>Total deducted</span>
        <span className="font-mono text-[11px]" style={{ color: insufficient?"#f87171":"rgba(251,241,217,0.85)" }}>{ethers.formatEther(totalNeeded)} {nativeCurrency}</span>
      </div>
      {!insufficient && (<>
        <div className="h-px" style={{ background:"rgba(251,241,217,0.06)" }}/>
        <div className="flex justify-between px-4 py-2.5">
          <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color:"#A36E14" }}>Receiver gets</span>
          <span className="font-mono text-[11px] font-semibold" style={{ color:"#A36E14" }}>{ethers.formatEther(parsedAmt)} {nativeCurrency}</span>
        </div>
      </>)}
      {insufficient && (
        <div className="px-4 py-3" style={{ background:"rgba(248,113,113,0.06)" }}>
          <p className="text-[10px] font-semibold text-red-400 mb-0.5">Insufficient balance</p>
          <p className="text-[10px] leading-relaxed" style={{ color:"rgba(251,241,217,0.45)" }}>
            Fee is {ethers.formatEther(totalFee)} {nativeCurrency} for {numCalls} call{numCalls>1?"s":""}. Reduce amount or deposit more.
          </p>
        </div>
      )}
    </div>
  )
}

function MaskGlyph() {
  return (
    <svg width="18" height="12" viewBox="0 0 20 14" fill="none" className="shrink-0 mt-0.5">
      <path d="M2 6 Q4 2 7 2 Q9 2 10 4 Q11 2 13 2 Q16 2 18 6 Q17 11 13 11 Q11 11 10 9 Q9 11 7 11 Q3 11 2 6 Z" fill="rgba(163,110,20,0.7)"/>
    </svg>
  )
}

// ─── Voyage flavour text ─────────────────────────────────────────────────────
const FLAVOR_BY_PHASE: Record<string, string[]> = {
  relayer:  ["Hailing the shadow network…", "Seeking a trusted relayer…", "The veil stirs…"],
  building: ["Charting the secret route…", "Selecting the finest doubloons…", "Planning the covert passage…"],
  proving:  ["Forging the zero-knowledge seal…", "The cryptographic tide rises…", "No one shall trace this voyage…"],
  sending:  ["The ship crosses the veil…", "Coins vanish into shadow…", "Broadcasting into the deep…"],
}
function VoyageFlavorText({ phase }: { phase: Phase }) {
  const lines = FLAVOR_BY_PHASE[phase] ?? []
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (!lines.length) return
    setIdx(0)
    const t = setInterval(() => setIdx(i => (i + 1) % lines.length), 2800)
    return () => clearInterval(t)
  }, [phase])
  if (!lines.length) return null
  return (
    <p
      key={`${phase}-${idx}`}
      className="text-[10px] font-serif italic mt-1"
      style={{
        color: "rgba(251,241,217,0.3)",
        animation: "flavorFadeIn 0.6s ease",
      }}
    >
      <style>{`@keyframes flavorFadeIn { from { opacity:0; transform: translateY(4px); } to { opacity:1; transform: translateY(0); } }`}</style>
      "{lines[idx]}"
    </p>
  )
}

// ─── Phase image slide transition ────────────────────────────────────────────
// Outgoing image plays slideOutLeft, incoming image plays slideInRight.
// All other images are invisible and untransformed.

function phaseToImgPhase(p: Phase): "form"|"flight"|"success" {
  if (p === "success") return "success"
  if (isBusy(p)) return "flight"
  return "form"
}

function PhaseImage({ phase }: { phase: Phase }) {
  const want = phaseToImgPhase(phase)

  // Which image is currently shown (fully visible, centered)
  const [shown,    setShown]    = useState<"form"|"flight"|"success">(want)
  // Which image is animating out (slideOutLeft)
  const [leaving,  setLeaving]  = useState<"form"|"flight"|"success"|null>(null)
  // Which image is animating in  (slideInRight)
  const [entering, setEntering] = useState<"form"|"flight"|"success"|null>(null)

  useEffect(() => {
    if (want === shown && !leaving) return
    if (want === shown) return

    // Start transition: old slides out, new slides in simultaneously
    setLeaving(shown)
    setEntering(want)

    const t = setTimeout(() => {
      setShown(want)
      setLeaving(null)
      setEntering(null)
    }, 380)
    return () => clearTimeout(t)
  }, [want]) // eslint-disable-line

  const images: Array<"form"|"flight"|"success"> = ["form", "flight", "success"]
  const srcMap = { form: noidShipImg, flight: nightShipImg, success: successImg }

  return (
    <div
      className="relative w-full"
      style={{ height: 200, overflow: "hidden" }}
    >
      <style>{`
        @keyframes nightShipFloat {
          0%, 100% { transform: translateY(0px) rotate(-1deg); }
          50%       { transform: translateY(-8px) rotate(1deg); }
        }
        @keyframes imgSlideOutLeft {
          from { transform: translateX(0%);     opacity: 1; }
          to   { transform: translateX(-110%);  opacity: 0; }
        }
        @keyframes imgSlideInRight {
          from { transform: translateX(110%);   opacity: 0; }
          to   { transform: translateX(0%);     opacity: 1; }
        }
      `}</style>

      {images.map(key => {
        const isShown    = key === shown    && key !== leaving
        const isLeaving  = key === leaving
        const isEntering = key === entering

        let animation = "none"
        if (isLeaving)  animation = "imgSlideOutLeft 380ms cubic-bezier(0.4,0,0.2,1) forwards"
        if (isEntering) animation = "imgSlideInRight 380ms cubic-bezier(0.4,0,0.2,1) forwards"

        // Float animation for night ship when it's shown and not in transition
        const floatAnim = key === "flight" && isShown && !isLeaving && !isEntering
          ? "nightShipFloat 3.5s ease-in-out infinite"
          : "none"

        const visible = isShown || isLeaving || isEntering

        return (
          <img
            key={key}
            src={srcMap[key]}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              maxWidth: 350,
              margin: "0 auto",
              objectFit: "contain",
              height: "100%",
              opacity: visible ? 1 : 0,
              pointerEvents: "none",
              animation: isLeaving || isEntering ? animation : floatAnim,
              filter: key === "flight" ? "drop-shadow(0 8px 24px rgba(74,108,182,0.35))" : "none",
              // when shown but not animating, ensure no leftover transform
              transform: visible && !isLeaving && !isEntering ? "translateX(0%)" : undefined,
            }}
          />
        )
      })}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
interface Props { open: boolean; onClose: () => void }

export default function NoidSendModal({ open, onClose }: Props) {
  const { wallet, activeNetwork, networkConfig }           = useWallet()
  const { allUnspentUTXOs, getMerkleProof, forceSync }     = usePool()

  const [users,        setUsers]        = useState<NoidUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [selectedUser, setSelectedUser] = useState<NoidUser|null>(null)
  const [pastedKey,    setPastedKey]    = useState("")
  const [recipientMode, setRecipientMode] = useState<"paste"|"list">("paste")
  const [userSearch,   setUserSearch]   = useState("")
  const [amountEth,    setAmountEth]    = useState("")
  const [isRetry,      setIsRetry]      = useState(false)
  const [phase,        setPhase]        = useState<Phase>("form")
  const [statusMsg,    setStatusMsg]    = useState("")
  const [txHash,       setTxHash]       = useState<string|null>(null)
  const [errorMsg,     setErrorMsg]     = useState<string|null>(null)
  const [isRelayerFeeError, setIsRelayerFeeError] = useState(false)
  const [provenCount,  setProvenCount]  = useState(0)
  const [totalProofs,  setTotalProofs]  = useState(0)

  useEffect(() => {
    if (open) return
    const id = setTimeout(() => resetState(), 320)
    return () => clearTimeout(id)
  }, [open])

  function resetState() {
    setPhase("form"); setAmountEth(""); setSelectedUser(null); setPastedKey("")
    setUserSearch(""); setIsRetry(false); setTxHash(null); setErrorMsg(null)
    setIsRelayerFeeError(false); setProvenCount(0); setTotalProofs(0); setStatusMsg("")
  }

  useEffect(() => {
    if (!open) return
    setUsersLoading(true)
    fetch(`${BASE_URL}/noidusers/all`)
      .then(r => r.json())
      .then((list: NoidUser[]) => {
        const myKey = wallet?.noidAccount?.publicKey ?? ""
        setUsers(list.filter(u => u.noidModePublicKey !== myKey))
      })
      .catch(() => {})
      .finally(() => setUsersLoading(false))
  }, [open, wallet])

  const parsedAmt = useMemo(() => {
    try { return ethers.parseEther(amountEth || "0") } catch { return ZERO_BIG }
  }, [amountEth])

  const totalAvailable = useMemo(
    () => allUnspentUTXOs.reduce((s,u) => s + BigInt(u.amount), ZERO_BIG),
    [allUnspentUTXOs]
  )
  const feeResult = useMemo(
    () => parsedAmt > ZERO_BIG ? planTransfer(allUnspentUTXOs, parsedAmt, isRetry, activeNetwork) : null,
    [parsedAmt, allUnspentUTXOs, isRetry, activeNetwork]
  )
  const retryFeeResult = useMemo(
    () => parsedAmt > ZERO_BIG ? planTransfer(allUnspentUTXOs, parsedAmt, true, activeNetwork) : null,
    [parsedAmt, allUnspentUTXOs, activeNetwork]
  )
  const maxTransferable = useMemo(() => {
    if (totalAvailable <= ZERO_BIG) return ZERO_BIG
    let lo = ZERO_BIG, hi = totalAvailable
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi + 1n) / 2n
      if (planTransfer(allUnspentUTXOs, mid, isRetry, activeNetwork) !== null) lo = mid; else hi = mid - 1n
    }
    return lo
  }, [totalAvailable, allUnspentUTXOs, isRetry, activeNetwork])

  const resolvedRecipient: ParsedRecipient|null = useMemo(() => {
    if (recipientMode === "list" && selectedUser)
      return { ecPublicKey: selectedUser.noidModePublicKey, zkPublicKey: selectedUser.zkPublicKey }
    if (recipientMode === "paste" && pastedKey.trim())
      return parseNoidKey(pastedKey)
    return null
  }, [recipientMode, selectedUser, pastedKey])

  const pastedKeyValid = recipientMode==="paste"
    ? (pastedKey.trim()==="" ? null : parseNoidKey(pastedKey)!==null) : null

  const totalNeeded = feeResult ? parsedAmt + feeResult.totalFee : parsedAmt
  const canSubmit   = !!(resolvedRecipient && parsedAmt > ZERO_BIG && feeResult && totalAvailable >= totalNeeded)
  const filteredUsers = users.filter(u => u.name.toLowerCase().includes(userSearch.toLowerCase()))

  const runTransfer = useCallback(async (retry: boolean) => {
    if (!wallet?.noidAccount) return
    setErrorMsg(null); setTxHash(null); setProvenCount(0); setTotalProofs(0); setIsRelayerFeeError(false)
    const recipient = resolvedRecipient; if (!recipient) return
    try {
      setPhase("relayer"); setStatusMsg("Hailing the relayer…")
      const relRes = await fetch(`${BASE_URL}/relayer/get`)
      if (!relRes.ok) throw new Error("Could not fetch relayer info")
      const relayer = await relRes.json()
      setPhase("building"); setStatusMsg("Selecting inputs and building plan…")
      const plan = planTransfer(allUnspentUTXOs, parsedAmt, retry, activeNetwork)
      if (!plan) throw new Error(`Insufficient balance. Have ${ethers.formatEther(totalAvailable)} ${networkConfig.nativeCurrency}.`)
      const { plans } = plan; setTotalProofs(plans.length)
      const noid   = wallet.noidAccount
      const sender = { zk: { secretKey: noid.zkSecretKey, publicKey: noid.zkPublicKey }, privateWallet: { publicKey: noid.publicKey } }
      setPhase("proving"); setStatusMsg(`Forging ZK proof${plans.length>1?"s":""}…`)
      const transferCalls: any[] = [], zkProofs: any[] = []
      for (let i = 0; i < plans.length; i++) {
        const p = plans[i]; setStatusMsg(`Generating ZK proof ${i+1} of ${plans.length}…`)
        const { transferCall, zkProof } = await buildTransferCall(
          p.inputs, p.receiverAmt, p.changeAmt, p.feeAmt, recipient, sender, relayer, getMerkleProof
        )
        transferCalls.push(transferCall); zkProofs.push(zkProof); setProvenCount(i+1)
      }
      setPhase("sending"); setStatusMsg(`Broadcasting to ${networkConfig.label}…`)
      const res  = await fetch(`${BASE_URL}/transfer/${activeNetwork}/transfer`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ transferCalls, zkProofs })
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        if (data.message === "Relayer fee insufficient") {
          const err: any = new Error("Relayer fee insufficient"); err.isRelayerFeeError = true; throw err
        }
        throw new Error(data.message || "Transfer failed on-chain")
      }
      setTxHash(data.txHash); setPhase("success")
      saveNoidSendTx(wallet.noidAccount.publicKey, {
        type: "noid_send",
        txHash: data.txHash,
        senderNoidPublicKey: wallet.noidAccount.publicKey,
        receiverNoidPublicKey: recipient.ecPublicKey,
        amountMon: amountEth,
        totalRelayerFee: ethers.formatEther(plan.totalFee),
        timestamp: Date.now(),
      })
      setTimeout(() => void forceSync(), 1500)
    } catch (err: any) {
      console.error("[NoidSendModal]", err)
      setPhase("error"); setErrorMsg(err?.reason || err?.message || "Transfer failed")
      if (err.isRelayerFeeError) setIsRelayerFeeError(true)
    }
  }, [resolvedRecipient, parsedAmt, allUnspentUTXOs, getMerkleProof, forceSync, totalAvailable, wallet])

  const handleSend  = useCallback(() => runTransfer(isRetry), [runTransfer, isRetry])
  const handleRetry = useCallback(() => {
    setIsRetry(true); setPhase("form"); setErrorMsg(null); setIsRelayerFeeError(false)
    const r = planTransfer(allUnspentUTXOs, parsedAmt, true, activeNetwork); if (!r) return
    setTimeout(() => runTransfer(true), 50)
  }, [allUnspentUTXOs, parsedAmt, runTransfer])

  const retryInsufficient = retryFeeResult
    ? totalAvailable < parsedAmt + retryFeeResult.totalFee : true
  const isInFlight    = isBusy(phase)
  const isFormOrError = phase === "form" || phase === "error"
  const isSuccess     = phase === "success"

  return (
    <LiquidSheet
      open={open}
      onClose={onClose}
      tone="ink"
      accent="rgba(74,108,182,0.18)"
      disableDrag={isInFlight}
      lockDrag={isFormOrError}
      defaultFullscreen={isFormOrError}
    >
      {/*
        SINGLE always-mounted layout.
        The outer shell is always flex-col h-full (fullscreen during form,
        auto-height during in-flight/success because LiquidSheet handles that).
        Sections fade in/out with opacity + pointer-events so React never
        unmounts them — no pop, smooth crossfade between every stage.
      */}
      <div
        className="flex flex-col"
        style={{
          height: isFormOrError ? "100%" : "auto",
          transition: "height 600ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >

        {/* ── Shared header — text crossfades per phase ── */}
        <div className="shrink-0 px-6 pt-2 pb-1 text-center">
          <p className="text-[9px] tracking-[0.45em] uppercase mb-1" style={{ color:"#A36E14" }}>
            {isSuccess ? "Veil Drawn" : phase==="error" ? "Storm Rolled In" : "Shadow Transfer"}
          </p>
          <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]" style={{ color:"rgba(251,241,217,0.92)" }}>
            {isSuccess ? "Treasure sent. ⚓" : phase==="error" ? "Transfer failed." : isInFlight ? "Sailing the Veil…" : `Send Private ${networkConfig.nativeCurrency}`}
          </h3>
          <p className="mt-1 text-[11px]" style={{ color:"rgba(251,241,217,0.5)", transition:"opacity 400ms" }}>
            {isSuccess
              ? `Your ${networkConfig.nativeCurrency} crossed into the shadow.`
              : `${allUnspentUTXOs.length} note${allUnspentUTXOs.length!==1?"s":""} · ${ethers.formatEther(totalAvailable)} ${networkConfig.nativeCurrency}`}
          </p>
        </div>

        {/* ── Crossfading image (always mounted, opacity switches) ── */}
        <div className="shrink-0 px-6 pt-1">
          <PhaseImage phase={phase}/>
        </div>

        {/* ── Voyage tracker (fades in during in-flight + success) ── */}
        <div
          className="shrink-0 px-6"
          style={{
            opacity: (isInFlight || isSuccess) ? 1 : 0,
            maxHeight: (isInFlight || isSuccess) ? 120 : 0,
            overflow: "hidden",
            transition: "opacity 500ms ease, max-height 600ms cubic-bezier(0.22,1,0.36,1)",
            pointerEvents: (isInFlight || isSuccess) ? "auto" : "none",
          }}
        >
          <ShipVoyage phase={phase}/>
        </div>

        {/* ── In-flight status text ── */}
        <div
          className="shrink-0 px-6 pb-2"
          style={{
            opacity: isInFlight ? 1 : 0,
            maxHeight: isInFlight ? 140 : 0,
            overflow: "hidden",
            transition: "opacity 500ms ease, max-height 600ms cubic-bezier(0.22,1,0.36,1)",
            pointerEvents: isInFlight ? "auto" : "none",
          }}
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-[11px] tracking-[0.2em] uppercase" style={{ color:"#A36E14" }}>{statusMsg}</p>
            {phase==="proving" && totalProofs > 1 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl border"
                style={{ background:"rgba(251,241,217,0.03)", borderColor:"rgba(251,241,217,0.08)" }}>
                <span className="font-mono text-[11px] font-bold" style={{ color:"#A36E14" }}>{provenCount}/{totalProofs}</span>
                <span className="text-[10px]" style={{ color:"rgba(251,241,217,0.4)" }}>proofs generated</span>
              </div>
            )}
            {phase==="proving" && (
              <p className="text-[10px] max-w-[260px] leading-snug" style={{ color:"rgba(251,241,217,0.45)" }}>
                ZK proof runs in your browser. Keep this window open.
              </p>
            )}
            {/* Flavour text — always visible during flight */}
            <VoyageFlavorText phase={phase}/>
          </div>
        </div>

        {/* ── Scrollable form body ── */}
        <div
          className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-6 pt-1 pb-2 space-y-4"
          style={{
            opacity: isFormOrError ? 1 : 0,
            transition: "opacity 400ms ease",
            pointerEvents: isFormOrError ? "auto" : "none",
            display: isFormOrError ? undefined : "none",
          }}
        >
          {isRetry && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl border"
              style={{ background:"rgba(245,158,11,0.06)", borderColor:"rgba(245,158,11,0.2)" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5" className="mt-0.5 shrink-0">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <p className="text-[10px] leading-relaxed" style={{ color:"rgba(245,158,11,0.8)" }}>
                {`Retry mode active — fee increased to ${ethers.formatEther(feePerCall(true, activeNetwork))} ${networkConfig.nativeCurrency}/call.`}
              </p>
            </div>
          )}

          {/* Recipient toggle */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              {(["paste","list"] as const).map(mode => (
                <button key={mode} onClick={() => setRecipientMode(mode)}
                  className="flex-1 py-2 rounded-xl text-[9px] tracking-[0.25em] uppercase font-semibold transition-all"
                  style={{
                    background: recipientMode===mode ? "rgba(163,110,20,0.2)" : "rgba(251,241,217,0.04)",
                    border: `1px solid ${recipientMode===mode ? "rgba(163,110,20,0.4)" : "rgba(251,241,217,0.08)"}`,
                    color: recipientMode===mode ? "#A36E14" : "rgba(251,241,217,0.45)"
                  }}>
                  {mode==="list" ? "Noid contacts" : "Paste Noid key"}
                </button>
              ))}
            </div>
            {recipientMode==="list" && (
              usersLoading ? (
                <p className="text-[10px] text-center py-3" style={{ color:"rgba(251,241,217,0.35)" }}>Loading contacts…</p>
              ) : users.length===0 ? (
                <p className="text-[10px] p-3 rounded-xl text-center"
                  style={{ color:"rgba(251,241,217,0.35)", background:"rgba(251,241,217,0.03)", border:"1px solid rgba(251,241,217,0.07)" }}>
                  No other Noid users yet. Use the paste tab.
                </p>
              ) : (<>
                <input value={userSearch} onChange={e => setUserSearch(e.target.value)}
                  placeholder="Search by name…" className="w-full rounded-xl px-3 py-2 text-[11px] font-mono mb-2 focus:outline-none"
                  style={{ background:"rgba(251,241,217,0.05)", border:"1px solid rgba(251,241,217,0.1)", color:"rgba(251,241,217,0.85)" }}/>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                  {filteredUsers.map(u => {
                    const picked = selectedUser?._id===u._id
                    return (
                      <button key={u._id} onClick={() => setSelectedUser(u)}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all text-left"
                        style={{ background: picked ? "rgba(163,110,20,0.15)" : "rgba(251,241,217,0.03)",
                          border: `1px solid ${picked ? "rgba(163,110,20,0.35)" : "rgba(251,241,217,0.07)"}` }}>
                        <div>
                          <p className="text-[11px] font-semibold" style={{ color: picked ? "#A36E14" : "rgba(251,241,217,0.8)" }}>{u.name}</p>
                          <p className="font-mono text-[9px] mt-0.5" style={{ color:"rgba(251,241,217,0.35)" }}>
                            {u.noidModePublicKey.slice(0,12)}…{u.noidModePublicKey.slice(-6)}
                          </p>
                        </div>
                        {picked && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#A36E14" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>}
                      </button>
                    )
                  })}
                </div>
              </>)
            )}
            {recipientMode==="paste" && (<>
              <textarea value={pastedKey} onChange={e => setPastedKey(e.target.value)}
                placeholder={"0x04abc…ef|21578…142"} rows={3}
                className="w-full rounded-xl px-3 py-2.5 text-[10px] font-mono focus:outline-none resize-none"
                style={{ background:"rgba(251,241,217,0.05)",
                  border:`1px solid ${pastedKeyValid===false?"rgba(248,113,113,0.4)":pastedKeyValid===true?"rgba(163,110,20,0.4)":"rgba(251,241,217,0.1)"}`,
                  color:"rgba(251,241,217,0.85)" }}/>
              {pastedKeyValid===false && <p className="mt-1 text-[10px] text-red-400">Invalid key. Format: {"<ecPublicKey>|<zkPublicKey>"}</p>}
              {pastedKeyValid===true  && <p className="mt-1 text-[10px]" style={{ color:"#A36E14" }}>✓ Valid Noid key</p>}
              <p className="mt-2 text-[9px] leading-relaxed" style={{ color:"rgba(251,241,217,0.3)" }}>
                Noid key format: EC public key | ZK public key, joined by "|"
              </p>
            </>)}
          </div>

          {/* Amount */}
          <div>
            <div className="flex items-end justify-between mb-1.5">
              <label className="text-[9px] tracking-[0.3em] uppercase" style={{ color:"rgba(251,241,217,0.5)" }}>Amount ({networkConfig.nativeCurrency})</label>
              <button onClick={() => maxTransferable > 0n && setAmountEth(ethers.formatEther(maxTransferable))}
                className="text-[9px] tracking-[0.3em] uppercase" style={{ color:"#A36E14" }}>Max</button>
            </div>
            <input value={amountEth}
              onChange={e => { try { const en = ethers.parseEther(e.target.value||"0"); setAmountEth(en>maxTransferable?ethers.formatEther(maxTransferable):e.target.value) } catch { setAmountEth(e.target.value) }}}
              placeholder="0.00"
              className="w-full rounded-xl px-4 py-3 text-[15px] font-mono focus:outline-none"
              style={{ background:"rgba(251,241,217,0.05)", border:"1px solid rgba(251,241,217,0.1)", color:"rgba(251,241,217,0.9)" }}/>
            {/* Max transferable hint */}
            {maxTransferable > 0n ? (
              <p className="mt-1 text-[9px]" style={{ color:"rgba(245,158,11,0.7)" }}>
                Max transferable: {ethers.formatEther(maxTransferable)} {networkConfig.nativeCurrency}
              </p>
            ) : totalAvailable > 0n ? (
              /* Notes exist but none can be transferred — balance is all fee */
              (() => {
                // How many batches of MAX_INPUTS notes do we have?
                const numBatches = Math.max(1, Math.ceil(allUnspentUTXOs.length / MAX_INPUTS))
                const minDeposit = feePerCall(isRetry, activeNetwork) * BigInt(numBatches)
                return (
                  <div className="mt-1.5 p-2.5 rounded-xl border" style={{ background:"rgba(245,158,11,0.06)", borderColor:"rgba(245,158,11,0.2)" }}>
                    <p className="text-[9px] leading-relaxed" style={{ color:"rgba(245,158,11,0.75)" }}>
                      Your notes can't cover the relayer fee yet. Add{" "}
                      <span className="font-semibold">{ethers.formatEther(minDeposit)} {networkConfig.nativeCurrency}</span>
                      {" "}({numBatches} call{numBatches > 1 ? "s" : ""} × {ethers.formatEther(feePerCall(isRetry, activeNetwork))} {networkConfig.nativeCurrency}) to transfer your balance.
                    </p>
                  </div>
                )
              })()
            ) : null}
          </div>

          <FeeBreakdown parsedAmt={parsedAmt} feeResult={feeResult} totalAvailable={totalAvailable} isRetry={isRetry} networkId={activeNetwork} nativeCurrency={networkConfig.nativeCurrency}/>

          <div className="flex items-start gap-2.5 p-3 rounded-xl border"
            style={{ background:"rgba(163,110,20,0.06)", borderColor:"rgba(163,110,20,0.15)" }}>
            <MaskGlyph/>
            <p className="text-[10px] leading-relaxed" style={{ color:"rgba(251,241,217,0.45)" }}>
              Shielded end-to-end. Only the recipient can decrypt their note. Submitted by the relayer — your identity stays in the shadow.
            </p>
          </div>

          {phase==="error" && errorMsg && !isRelayerFeeError && (
            <div className="p-3 rounded-xl border" style={{ background:"rgba(248,113,113,0.06)", borderColor:"rgba(248,113,113,0.25)" }}>
              <p className="text-[10px] font-semibold text-red-400 mb-0.5">Transfer Failed</p>
              <p className="text-[10px] break-words" style={{ color:"rgba(251,241,217,0.55)" }}>{errorMsg}</p>
            </div>
          )}
          {phase==="error" && isRelayerFeeError && (
            <div className="p-3 rounded-xl border space-y-2" style={{ background:"rgba(245,158,11,0.06)", borderColor:"rgba(245,158,11,0.2)" }}>
              <p className="text-[10px] font-semibold" style={{ color:"rgba(245,158,11,0.9)" }}>Relayer Fee Too Low</p>
              <p className="text-[10px] leading-relaxed" style={{ color:"rgba(251,241,217,0.55)" }}>Gas cost exceeded. Retry with +{ethers.formatEther(getFeeRetryExtra(activeNetwork))} {networkConfig.nativeCurrency} per call.</p>
              {retryFeeResult && (
                <div className="rounded-lg overflow-hidden border" style={{ borderColor:"rgba(251,241,217,0.08)" }}>
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-[9px] uppercase tracking-widest" style={{ color:"rgba(251,241,217,0.4)" }}>Retry fee</span>
                    <span className="font-mono text-[10px]" style={{ color:"rgba(245,158,11,0.85)" }}>
                      {retryFeeResult.numCalls} × {ethers.formatEther(feePerCall(true, activeNetwork))} = {ethers.formatEther(retryFeeResult.totalFee)} {networkConfig.nativeCurrency}
                    </span>
                  </div>
                  {retryInsufficient && (
                    <div className="px-3 py-2" style={{ background:"rgba(248,113,113,0.06)" }}>
                      <p className="text-[9px] text-red-400">Still insufficient — reduce amount or deposit more.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {phase==="error" && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              {!isRelayerFeeError && (
                <button onClick={() => { setPhase("form"); setErrorMsg(null) }}
                  className="rounded-xl border py-3 text-[11px] tracking-[0.25em] uppercase"
                  style={{ background:"rgba(251,241,217,0.04)", borderColor:"rgba(251,241,217,0.1)", color:"rgba(251,241,217,0.7)" }}>
                  Try Again
                </button>
              )}
              {isRelayerFeeError && (
                <button onClick={handleRetry} disabled={retryInsufficient}
                  className="rounded-xl py-3 text-[11px] tracking-[0.25em] uppercase disabled:opacity-30"
                  style={{ background:"rgba(245,158,11,0.15)", border:"1px solid rgba(245,158,11,0.35)", color:"rgba(245,158,11,0.9)" }}>
                  Retry (+fee)
                </button>
              )}
              <button onClick={onClose} className="rounded-xl border py-3 text-[11px] tracking-[0.25em] uppercase"
                style={{ background:"rgba(251,241,217,0.04)", borderColor:"rgba(251,241,217,0.1)", color:"rgba(251,241,217,0.6)" }}>
                Cancel
              </button>
            </div>
          )}
          <div style={{ height: 8 }}/>
        </div>

        {/* ── Success actions ── */}
        {isSuccess && (
          <div className="shrink-0 px-6 pb-5 overflow-hidden" style={{ opacity: 1, transition: "opacity 500ms ease 200ms" }}>
            {txHash && (
              <div className="w-full rounded-2xl border p-3 flex items-start gap-3 mb-4"
                style={{ background:"rgba(5,150,105,0.08)", borderColor:"rgba(5,150,105,0.25)" }}>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background:"rgba(5,150,105,0.2)" }}>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7L5.5 10.5L12 4" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-emerald-500">Transfer confirmed</p>
                  <p className="font-mono text-[9px] mt-1 break-all" style={{ color:"rgba(251,241,217,0.5)" }}>{txHash}</p>
                </div>
              </div>
            )}
            <button onClick={onClose}
              className="w-full rounded-xl py-3 text-[11px] tracking-[0.25em] uppercase hover:-translate-y-[1px] transition-all"
              style={{
                background:"linear-gradient(145deg, rgba(251,241,217,0.07) 0%, rgba(232,174,58,0.06) 100%)",
                backdropFilter:"blur(20px) saturate(180%)", WebkitBackdropFilter:"blur(20px) saturate(180%)",
                border:"1px solid rgba(232,174,58,0.25)",
                boxShadow:"inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(232,174,58,0.1)",
                color:"rgba(251,241,217,0.88)",
              }}>
              Done
            </button>
            {txHash && (
              <div className="flex justify-center mt-3">
                <a href={`https://testnet.monadexplorer.com/tx/${txHash}`} target="_blank" rel="noreferrer"
                  className="text-[10px] tracking-[0.2em] uppercase hover:opacity-60 transition-opacity"
                  style={{ color:"rgba(251,241,217,0.35)" }}>
                  View on explorer
                </a>
              </div>
            )}
          </div>
        )}

        {/* ── Fixed footer: slider — only shown during form/error ── */}
        {isFormOrError && (
          <div
            className="shrink-0 px-6 pt-3 pb-6"
            style={{ borderTop:"1px solid rgba(251,241,217,0.08)" }}
          >
            <ShipSlider canSubmit={canSubmit} phase={phase} onCommit={handleSend}/>
          </div>
        )}

      </div>
    </LiquidSheet>
  )
}