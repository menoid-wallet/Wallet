/**
 * CreateNoidSmartAccountModal.tsx
 *
 * Creates a Noid Smart Account by:
 *   1. Selecting UTXOs to cover 0.5 MON/batch relayer fee + 1 MON creation fee.
 *   2. Building a CreateNoidAccount ZK proof (same circuit/input structure
 *      as the transfer proof but with cmx_noirAccount as an extra public signal).
 *   3. Calling NoidAccountManager.createNoidAccount() via the relayer.
 *
 * UX mirrors MaskModal exactly:
 *   form    → fullscreen, lockDrag, image + fee summary, fixed ship-slider footer
 *   flight  → partial sheet, voyage tracker, status text
 *   success → partial sheet, success card + Done button
 *   error   → fullscreen, inline error, slider resets
 *
 * Post-creation:
 *   - The new account is immediately stored in local state and set as
 *     selectedNoidAccount so the UI reflects it before the 10 s server
 *     refresh catches up.
 *   - forceSync() is fired after 1.5 s so the backend state lands soon.
 */

import React, {
  useCallback, useEffect, useRef, useState
} from "react"
import * as snarkjs from "snarkjs"
import { ethers } from "ethers"
import { buildPoseidon } from "circomlibjs"
import { useWallet } from "../../context/WalletContext"
import { usePool, type NoidSmartAccount } from "../../context/PoolContext"
import { fetchRelayerKeys, BASE_URL } from "../../services/api"
import { createCommitment } from "../../crypto/commitment"
import { encryptMessage } from "../../lib/crypto"
import { zkAssetUrl } from "../../services/mask"
import LiquidSheet from "./LiquidSheet"

import shipImg      from "../../assets/ship/ship.png"
import maskStartImg from "../../assets/modes/mask_start.png"
import createImg from "../../assets/meno/create_noid_account.png"
import createdImg from "../../assets/meno/created.png"
import nightShipImg from "../../assets/ship/night_ship.png"
import maskDoneImg  from "../../assets/modes/mask.png"

// Preload images
;[maskStartImg, nightShipImg, maskDoneImg].forEach(src => {
  const i = new Image(); i.src = src
})

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_INPUTS          = 4
const RELAYER_FEE_WEI     = ethers.parseEther("0.5")  // per batch, same as transfer
const CREATION_PREMIUM_WEI = ethers.parseEther("1")   // added to relayer fee on last batch
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000"
const ZERO_BIG  = BigInt(0)

// ─── Phase ────────────────────────────────────────────────────────────────────
type Phase = "form" | "relayer" | "building" | "proving" | "sending" | "success" | "error"
const VOYAGE_STEPS = ["Relayer", "Build", "Prove", "Send", "Done"]
const WAVE_PATH = "M0 5 Q24 1 47 5 Q71 9 95 5 Q118 1 142 5 Q166 9 190 5 Q213 1 237 5 Q261 9 285 5 Q308 1 332 5 Q356 9 380 5"

function isBusy(p: Phase) {
  return p === "relayer" || p === "building" || p === "proving" || p === "sending"
}
function phaseToProgress(p: Phase): number {
  switch (p) {
    case "relayer":  return 0
    case "building": return 0.25
    case "proving":  return 0.5
    case "sending":  return 0.75
    case "success":  return 1
    default:         return 0
  }
}

// ─── Poseidon singleton ───────────────────────────────────────────────────────
let _poseidon: any = null
async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon()
  return _poseidon
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function randomR(): string {
  return ethers.toBigInt(ethers.randomBytes(31)).toString()
}
function toBytes32(v: string | bigint): string {
  return ethers.zeroPadValue(ethers.toBeHex(BigInt(v)), 32)
}
function encNote(data: object, pk: string): string {
  return encryptMessage(JSON.stringify(data), pk)
}

// ─── Planner ─────────────────────────────────────────────────────────────────
/**
 * Find minimum UTXOs to cover: relayerFee × N batches + 1 MON creation premium.
 * The creation premium is folded into the last batch's relayer feeAmt — so from
 * the circuit's perspective it is just a larger feeAmt on that batch.
 * totalCost = RELAYER_FEE × N + CREATION_PREMIUM (what UTXOs must cover).
 */
function planCreate(unspent: any[]): {
  selected: any[]
  numBatches: number
  totalRelayerFee: bigint   // N × 0.5 MON (pure relayer portion)
  totalCost: bigint         // totalRelayerFee + 1 MON creation premium
} | null {
  if (!unspent?.length) return null
  const sorted = [...unspent].sort((a, b) => {
    const d = BigInt(b.amount) - BigInt(a.amount)
    return d > 0n ? 1 : d < 0n ? -1 : 0
  })
  for (let N = 1; N <= 10; N++) {
    const totalRelayerFee = RELAYER_FEE_WEI * BigInt(N)
    const totalCost       = totalRelayerFee + CREATION_PREMIUM_WEI
    const sel: any[] = []
    let acc = ZERO_BIG
    for (const u of sorted) {
      if (acc >= totalCost) break
      sel.push(u); acc += BigInt(u.amount)
    }
    if (acc < totalCost) return null
    const batches = Math.ceil(sel.length / MAX_INPUTS)
    if (batches <= N) {
      return { selected: sel, numBatches: batches, totalRelayerFee, totalCost }
    }
  }
  return null
}

// ─── Build one CreateNoidAccount call ────────────────────────────────────────
async function buildCreateCall(
  batchInputs: any[],
  changeAmt:   bigint,
  feeAmt:      bigint,
  cmx:         string,   // account commitment (decimal)
  rAccount:    string,   // randomness used to build cmx
  sender:      { zk: { secretKey: string; publicKey: string }; noidAccount: { privateKey: string; publicKey: string } },
  relayer:     { zkPublicKey: string; publicKey: string },
  getMerkleProof: (poolId: string, leafIndex: number) => any
) {
  const poseidon = await getPoseidon()
  const padded = [...batchInputs]
  while (padded.length < MAX_INPUTS) padded.push(null)

  const enabled: number[] = []
  const c_ins: string[] = [], a_ins: string[] = [], r_ins: string[] = []
  const roots: string[] = [], pathElements: string[][] = [], pathIndices: number[][] = []
  const nullifiers: string[] = [], poolIds: number[] = []
  const rootsBytes32: string[] = [], nullifiersBytes32: string[] = []

  for (const utxo of padded) {
    if (!utxo) {
      enabled.push(0); c_ins.push("0"); a_ins.push("0"); r_ins.push("0"); roots.push("0")
      pathElements.push(Array(20).fill("0")); pathIndices.push(Array(20).fill(0))
      nullifiers.push("0"); poolIds.push(0)
      rootsBytes32.push(ZERO_HASH); nullifiersBytes32.push(ZERO_HASH)
      continue
    }
    enabled.push(1)
    const mp = getMerkleProof(utxo.poolId, utxo.leafIndex)
    if (!mp) throw new Error(`No Merkle proof for leaf ${utxo.leafIndex}`)
    const rootBig = mp.root.toString()
    const nullifier = poseidon.F.toString(
      poseidon([2n, BigInt(utxo.commitment), BigInt(utxo.randomness), BigInt(sender.zk.secretKey)])
    )
    c_ins.push(BigInt(utxo.commitment).toString())
    a_ins.push(utxo.amount)
    r_ins.push(utxo.randomness)
    roots.push(rootBig)
    pathElements.push(mp.siblings.map((s: any) => s[0].toString()))
    pathIndices.push(mp.pathIndices)
    nullifiers.push(nullifier)
    poolIds.push(typeof utxo.poolId === "number" ? utxo.poolId : parseInt(utxo.poolId) || 0)
    rootsBytes32.push(toBytes32(rootBig))
    nullifiersBytes32.push(toBytes32(nullifier))
  }

  // outputs: C1 = change back to user, C2 = relayer fee
  const rChange = randomR(), rRelayer = randomR()
  const cEnabled = changeAmt > ZERO_BIG ? 1 : 0
  const fEnabled = feeAmt   > ZERO_BIG ? 1 : 0

  const changeCom  = await createCommitment(changeAmt.toString(), rChange,  sender.zk.publicKey)
  const relayerCom = await createCommitment(feeAmt.toString(),   rRelayer, relayer.zkPublicKey)

  const enc1 = cEnabled ? encNote({ amount: changeAmt.toString(), randomness: rChange },  sender.noidAccount.publicKey) : "0x"
  const enc2 = fEnabled ? encNote({ amount: feeAmt.toString(),   randomness: rRelayer }, relayer.publicKey)             : "0x"

  // Circom input
  const ci = {
    sk:      sender.zk.secretKey,
    pk:      sender.zk.publicKey,
    relayer: relayer.zkPublicKey,

    enabled, c_ins, a_ins, r_ins, roots, pathElements, pathIndices, nullifiers,

    out_enabled: [cEnabled, fEnabled],
    c_outs: [cEnabled ? changeCom.decimal : "0", fEnabled ? relayerCom.decimal : "0"],
    a_outs: [changeAmt.toString(), feeAmt.toString()],
    r_outs: [rChange, rRelayer],
    receivers: [sender.zk.publicKey, relayer.zkPublicKey],

    // account commitment public signal
    cmx_noirAccount: cmx,
    r_noirAccount:   rAccount,
  }

  console.log("ci: ",ci)

  const { proof: zkProof, publicSignals } = await (snarkjs as any).groth16.fullProve(
    ci,
    zkAssetUrl("create_noid_account.wasm"),
    zkAssetUrl("create_noid_account_final.zkey")
  )

  const calldata = await (snarkjs as any).groth16.exportSolidityCallData(zkProof, publicSignals)
  const argv = calldata.replace(/["[\]\s]/g, "").split(",")

  return {
    call: {
      a:   [argv[0], argv[1]],
      b:   [[argv[2], argv[3]], [argv[4], argv[5]]],
      c:   [argv[6], argv[7]],
      inputs: {
        enabled,
        roots:      rootsBytes32,
        poolIds,
        nullifiers: nullifiersBytes32,
      },
      C1:             cEnabled ? changeCom.bytes32  : ZERO_HASH,
      C2:             fEnabled ? relayerCom.bytes32 : ZERO_HASH,
      encryptedNote1: enc1,
      encryptedNote2: enc2,
    },
    // raw proof object for backend snarkjs.groth16.verify
    zkProof: {
      pi_a:     zkProof.pi_a,
      pi_b:     zkProof.pi_b,
      pi_c:     zkProof.pi_c,
      protocol: "groth16",
      curve:    "bn128",
    }
  }
}

// ─── Flavor text ─────────────────────────────────────────────────────────────
const FLAVOR: Record<string, string[]> = {
  relayer:  ["Hailing the relayer…", "Seeking a trusted port…"],
  building: ["Charting the course…", "Assembling the voyage…"],
  proving:  ["Forging the zero-knowledge seal…", "No trace shall remain…", "The cryptographic tide rises…"],
  sending:  ["The ship crosses the veil…", "Account materialises from shadow…"],
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
    <p key={`${phase}-${idx}`}
      className="text-[10px] font-serif italic mt-1 text-center"
      style={{ color: "rgba(251,241,217,0.35)", animation: "cnaFlavorFadeIn 0.6s ease" }}>
      "{lines[idx]}"
    </p>
  )
}

// ─── Phase image (slide transition, same as MaskModal) ───────────────────────
type ImgKey = "form" | "flight" | "success"
function PhaseImage({ phase }: { phase: Phase }) {
  const want: ImgKey = phase === "success" ? "success" : isBusy(phase) ? "flight" : "form"
  const [shown,    setShown]    = useState<ImgKey>(want)
  const [leaving,  setLeaving]  = useState<ImgKey | null>(null)
  const [entering, setEntering] = useState<ImgKey | null>(null)

  useEffect(() => {
    if (want === shown && !leaving) return
    if (want === shown) return
    setLeaving(shown); setEntering(want)
    const t = setTimeout(() => { setShown(want); setLeaving(null); setEntering(null) }, 380)
    return () => clearTimeout(t)
  }, [want]) // eslint-disable-line

  const srcMap: Record<ImgKey, string> = {
    form:    createImg,
    flight:  nightShipImg,
    success: createdImg,
  }
  return (
    <div className="relative w-full" style={{ height: 220, overflow: "hidden" }}>
      {(["form", "flight", "success"] as ImgKey[]).map(key => {
        const isShown    = key === shown && key !== leaving
        const isLeaving  = key === leaving
        const isEntering = key === entering
        const visible    = isShown || isLeaving || isEntering
        let animation = "none"
        if (isLeaving)  animation = "cnaImgSlideOutLeft 380ms cubic-bezier(0.4,0,0.2,1) forwards"
        if (isEntering) animation = "cnaImgSlideInRight 380ms cubic-bezier(0.4,0,0.2,1) forwards"
        const floatAnim = key === "flight" && isShown && !isLeaving && !isEntering
          ? "cnaNightFloat 3.5s ease-in-out infinite" : "none"
        return (
          <img key={key} src={srcMap[key]} alt=""
            style={{
              position: "absolute", inset: 0, width: "100%", maxWidth: 350,
              margin: "0 auto", height: "100%",
              objectFit: "cover", borderRadius: "20px",
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

// ─── Voyage tracker ───────────────────────────────────────────────────────────
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
        <svg className="absolute inset-x-3 pointer-events-none"
          style={{ top: "50%", transform: "translateY(-50%)", height: 10, width: "calc(100% - 24px)" }}
          viewBox="0 0 380 10" preserveAspectRatio="none">
          <path d={WAVE_PATH} stroke="rgba(251,241,217,0.12)" strokeWidth="1.5" fill="none" />
        </svg>
        <div className="absolute pointer-events-none overflow-hidden"
          style={{
            left: 12, top: "50%", transform: "translateY(-50%)",
            width: `calc((100% - 24px) * ${progress})`, height: 10,
            transition: "width 900ms cubic-bezier(0.22,1,0.36,1)"
          }}>
          <svg style={{ width: "380px", height: 10, maxWidth: "none" }} viewBox="0 0 380 10" preserveAspectRatio="none">
            <defs>
              <linearGradient id="cnaWakeGrad" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="rgba(163,110,20,0.5)" />
                <stop offset="100%" stopColor="#DAA21C" />
              </linearGradient>
            </defs>
            <path d={WAVE_PATH} stroke="url(#cnaWakeGrad)" strokeWidth="2" fill="none" />
          </svg>
        </div>
        {VOYAGE_STEPS.map((_, i) => {
          const pp      = i / (VOYAGE_STEPS.length - 1)
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
        <div className="absolute top-1/2 -translate-x-1/2"
          style={{
            left: `calc(12px + (100% - 24px) * ${progress})`,
            width: SHIP_PX, height: SHIP_PX, marginTop: -SHIP_PX / 2,
            transition: "left 900ms cubic-bezier(0.22,1,0.36,1)", zIndex: 2
          }}>
          <div style={{ width: "100%", height: "100%", animation: docked ? "none" : "cnaShipBob 1.6s ease-in-out infinite" }}>
            <img src={shipImg} alt="ship" draggable={false}
              style={{
                width: SHIP_PX, height: SHIP_PX, objectFit: "contain", display: "block",
                filter: docked
                  ? "drop-shadow(0 0 8px rgba(218,162,28,0.8)) drop-shadow(0 0 20px rgba(218,162,28,0.4))"
                  : "drop-shadow(0 1px 3px rgba(0,0,0,0.6))",
                transition: "filter 600ms ease"
              }}
              className="select-none pointer-events-none"
            />
          </div>
          {showAnchor && (
            <span className="absolute left-1/2 text-[13px] pointer-events-none"
              style={{ bottom: -4, transform: "translateX(-50%)", animation: "cnaAnchorDrop 0.6s cubic-bezier(0.22,1,0.36,1) forwards" }}>
              ⚓
            </span>
          )}
        </div>
      </div>
      <div className="relative mt-1" style={{ height: 14 }}>
        {VOYAGE_STEPS.map((label, i) => {
          const pp      = i / (VOYAGE_STEPS.length - 1)
          const reached = progress >= pp - 0.001
          return (
            <span key={label}
              className="absolute -translate-x-1/2 text-[8px] tracking-[0.15em] uppercase transition-colors duration-500"
              style={{ left: `calc(12px + (100% - 24px) * ${pp})`, color: reached ? "#A36E14" : "rgba(251,241,217,0.25)" }}>
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
      {!compact && <div className="h-4" />}
    </div>
  )
}

// ─── Ship Slider ──────────────────────────────────────────────────────────────
interface SliderProps { canSubmit: boolean; phase: Phase; onCommit: () => void }
function ShipSlider({ canSubmit, phase, onCommit }: SliderProps) {
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
  else if (phase === "success") { fillColor = "rgba(5,150,105,0.18)" }
  else if (canSubmit && progress > 0) { fillColor = `rgba(218,162,28,${0.08 + progress * 0.18})` }

  let fillExtra = 0; let trackLabel = ""
  if      (isInFlight)          { trackLabel = "Voyage in progress…"; fillExtra = 9999 }
  else if (phase === "success") { trackLabel = "Account created!";    fillExtra = 9999 }
  else if (!canSubmit)          { trackLabel = "Insufficient balance" }
  else if (progress > 0.55)     { trackLabel = "Release to create!" }
  else                          { trackLabel = "Drag ship to create →" }

  const thumbPos: React.CSSProperties = isInFlight
    ? { left: "50%", right: "auto", transform: "translate(-50%, -50%)", transition: "left 0.6s cubic-bezier(0.22,1,0.36,1), filter 0.3s" }
    : phase === "success"
    ? { right: 2, left: "auto", transform: "translateY(-50%)", transition: "filter 0.3s" }
    : { left: thumbX, right: "auto", transform: "translateY(-50%)", transition: dragging ? "none" : "left 0.4s cubic-bezier(0.22,1,0.36,1), filter 0.3s" }

  return (
    <div ref={trackRef} style={{
      position: "relative", width: "100%", height: 56, borderRadius: 28,
      border: phase === "success" ? "1.5px solid rgba(5,150,105,0.35)" : canSubmit ? "1.5px solid rgba(232,174,58,0.4)" : "1.5px solid rgba(251,241,217,0.1)",
      background: phase === "success" ? "rgba(5,150,105,0.10)" : canSubmit ? "rgba(232,174,58,0.07)" : "rgba(251,241,217,0.03)",
      overflow: "hidden", cursor: disabled ? "not-allowed" : "default",
      userSelect: "none", transition: "border-color 0.3s, background 0.3s",
    }}>
      <div style={{
        position: "absolute", inset: 0, background: fillColor,
        width: `${thumbX + fillExtra + 26 + THUMB_W / 2}px`, borderRadius: "inherit",
        transition: dragging ? "none" : "width 0.4s cubic-bezier(0.22,1,0.36,1), background 0.4s",
        pointerEvents: "none",
      }} />
      <svg style={{
        position: "absolute", bottom: 0, left: 0, width: "100%", height: 18,
        opacity: isInFlight ? 0.45 : canSubmit ? 0.2 : 0.07,
        pointerEvents: "none", overflow: "visible", transition: "opacity 0.5s"
      }} viewBox="0 0 280 18" preserveAspectRatio="none">
        <path d="M0 12 Q35 4 70 12 Q105 20 140 12 Q175 4 210 12 Q245 20 280 12 L280 18 L0 18 Z" fill="#1a6b8a">
          {isInFlight && <animateTransform attributeName="transform" type="translate" from="0 0" to="-70 0" dur="1.2s" repeatCount="indefinite" />}
        </path>
        {isInFlight && (
          <path d="M280 12 Q315 4 350 12 Q385 20 420 12 Q455 4 490 12 Q525 20 560 12 L560 18 L280 18 Z" fill="#1a6b8a">
            <animateTransform attributeName="transform" type="translate" from="0 0" to="-70 0" dur="1.2s" repeatCount="indefinite" />
          </path>
        )}
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        pointerEvents: "none",
        paddingLeft: (isInFlight || phase === "success") ? 16 : thumbX + THUMB_W + 4,
        paddingRight: 16, transition: "padding-left 0.1s",
      }}>
        <span style={{
          fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", fontWeight: 600,
          whiteSpace: "nowrap", transition: "color 0.3s",
          color: phase === "success" ? "rgba(5,150,105,0.8)" : isInFlight ? "rgba(180,130,10,0.9)" : "rgba(251,241,217,0.4)"
        }}>
          {trackLabel}
        </span>
      </div>
      <div
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onLostPointerCapture={() => onPointerUp()}
        style={{
          position: "absolute", top: "50%", ...thumbPos,
          width: THUMB_W, height: THUMB_W,
          cursor: disabled ? "not-allowed" : dragging ? "grabbing" : "grab",
          display: "flex", alignItems: "center", justifyContent: "center",
          touchAction: "none", zIndex: 2, filter: shipFilter
        }}>
        <img src={shipImg} alt="Drag to create" draggable={false}
          style={{
            width: 46, height: 46, objectFit: "contain", pointerEvents: "none",
            opacity: disabled && !isInFlight && phase !== "success" ? 0.3 : 1,
            transition: "opacity 0.3s",
            transform: dragging ? "scale(1.07) translateY(-2px)" : "scale(1)",
            animation: isInFlight ? "cnaShipSail 1.4s ease-in-out infinite"
              : dragging ? "none" : "cnaShipFloat 3s ease-in-out infinite"
          }}
        />
      </div>
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────
interface Props {
  open: boolean
  onClose: () => void
  onCreated?: (account: NoidSmartAccount) => void
}

export default function CreateNoidSmartAccountModal({ open, onClose, onCreated }: Props) {
  const { wallet, setSelectedNoidAccount } = useWallet()
  const { allUnspentUTXOs, getMerkleProof, forceSync } = usePool()

  const [phase,     setPhase]     = useState<Phase>("form")
  const [statusMsg, setStatusMsg] = useState("")
  const [txHash,    setTxHash]    = useState<string | null>(null)
  const [fatal,     setFatal]     = useState<string | null>(null)

  // Reset when closed
  useEffect(() => {
    if (open) return
    const id = setTimeout(() => {
      setPhase("form"); setStatusMsg(""); setTxHash(null); setFatal(null)
    }, 320)
    return () => clearTimeout(id)
  }, [open])

  // Fee computation
  const plan = planCreate(allUnspentUTXOs)
  const canSubmit = !!wallet && !!plan

  const isInFlight    = isBusy(phase)
  const isFormOrError = phase === "form" || phase === "error"
  const isSuccess     = phase === "success"

  const handleCreate = useCallback(async () => {
    if (!wallet || !plan) return
    setFatal(null)

    try {
      // 1. Relayer keys
      setPhase("relayer"); setStatusMsg("Hailing the relayer…")
      const relayerKeys = await fetchRelayerKeys()

      // 2. Build account commitment
      setPhase("building"); setStatusMsg("Charting the course…")
      const poseidon = await getPoseidon()
      const rAccount = randomR()

      // cmx = Poseidon(4, zkPubKey, rAccount)
      const cmxBig: string = poseidon.F.toString(
        poseidon([4n, BigInt(wallet.noidAccount.zkPublicKey), BigInt(rAccount)])
      )
      const cmxBytes32 = toBytes32(cmxBig)

      // encrypted account note (only the randomness + zkPublicKey, so owner can reconstruct)
      const encryptedAccountNote = encNote(
        { randomness: rAccount, zkPublicKey: wallet.noidAccount.zkPublicKey },
        wallet.noidAccount.publicKey
      )

      // 3. Batch UTXOs and build calls
      const { selected, numBatches, totalRelayerFee, totalCost } = plan
      const batches: any[][] = []
      const flat = [...selected]
      while (flat.length > 0) batches.push(flat.splice(0, MAX_INPUTS))

      const sender = {
        zk:          { secretKey: wallet.noidAccount.zkSecretKey, publicKey: wallet.noidAccount.zkPublicKey },
        noidAccount: { privateKey: wallet.noidAccount.privateKey,  publicKey: wallet.noidAccount.publicKey }
      }
      const relayer = {
        zkPublicKey: relayerKeys.zkPublicKey,
        publicKey:   relayerKeys.publicKey
      }

      // Build one proof per batch
      setPhase("proving"); setStatusMsg(`Forging ZK proof 1 of ${numBatches}…`)
      const calls: any[]    = []
      const zkProofs: any[] = []

      for (let bi = 0; bi < batches.length; bi++) {
        const batch      = batches[bi]
        const batchInput = batch.reduce((s: bigint, u: any) => s + BigInt(u.amount), ZERO_BIG)
        const isLast     = bi === batches.length - 1
        // Last batch: relayer gets 0.5 MON (their cut) + 1 MON creation premium = 1.5 MON
        // All other batches: relayer gets 0.5 MON
        // Circuit: sum(inputs) = changeAmt + feeAmt  ← no separate creation deduction
        const feeAmt    = isLast ? RELAYER_FEE_WEI + CREATION_PREMIUM_WEI : RELAYER_FEE_WEI
        const changeAmt = batchInput > feeAmt ? batchInput - feeAmt : ZERO_BIG

        if (bi > 0) setStatusMsg(`Forging ZK proof ${bi + 1} of ${numBatches}…`)

        const { call, zkProof } = await buildCreateCall(
          batch, changeAmt, feeAmt, cmxBig, rAccount, sender, relayer, getMerkleProof
        )
        calls.push(call)
        zkProofs.push(zkProof)
      }

      // 4. POST to relayer — relayer signs and submits the tx
      setPhase("sending"); setStatusMsg("Broadcasting to Monad…")

      const relayerRes = await fetch(`${BASE_URL}/noidroutes/createnoidaccount`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calls,
          cmx:     cmxBytes32,
          eNote:   encryptedAccountNote,
          zkProofs,
        }),
      })

      if (!relayerRes.ok) {
        const errBody = await relayerRes.json().catch(() => ({}))
        throw new Error(errBody?.message || `Relayer responded with ${relayerRes.status}`)
      }

      const { txHash } = await relayerRes.json()
      setTxHash(txHash)

      // 5. Success — build local NoidSmartAccount optimistically.
      // The deployed address isn't known yet (requires indexer to catch the event),
      // so we store ZeroAddress for now; forceSync will fill it in after the 10 s refresh.
      const newAccount: NoidSmartAccount = {
        commitment:  cmxBig,
        randomness:  rAccount,
        zkPublicKey: wallet.noidAccount.zkPublicKey,
        account:     ethers.ZeroAddress
      }

      // Set immediately — don't wait for backend refresh
      setSelectedNoidAccount(newAccount)
      onCreated?.(newAccount)

      setPhase("success"); setStatusMsg("Noid Smart Account created!")
      setTimeout(() => void forceSync(), 1500)

    } catch (e: any) {
      console.error("[CreateNoidSmartAccount]", e)
      setFatal(e?.shortMessage || e?.reason || e?.message || "Creation failed.")
      setPhase("error")
    }
  }, [wallet, plan, getMerkleProof, setSelectedNoidAccount, onCreated, forceSync])

  const eyebrow  = isSuccess ? "Account Forged" : phase === "error" ? "Storm Rolled In" : "Smart Account"
  const title    = isSuccess ? "Your account is live. ⚓" : phase === "error" ? "Creation failed." : "Create Noid Account"
  const subtitle = isSuccess
    ? "Your Noid Smart Account is ready to use"
    : plan
      ? `Cost: ${ethers.formatEther(plan.totalCost)} MON (${plan.numBatches} batch${plan.numBatches > 1 ? "es" : ""} × 0.5 + 1 MON creation)`
      : "Insufficient balance — need at least 1.5 MON in shadow"

  return (
    <LiquidSheet
      open={open}
      onClose={onClose}
      tone="ink"
      accent="rgba(232,174,58,0.24)"
      disableDrag={isInFlight}
      lockDrag={isFormOrError}
      defaultFullscreen={isFormOrError}
    >
      <div className="flex flex-col"
        style={{
          height:     isFormOrError ? "100%" : "auto",
          overflow:   isSuccess ? "hidden" : undefined,
          transition: "height 600ms cubic-bezier(0.22,1,0.36,1)"
        }}>

        {/* ── Header ── */}
        <div className="shrink-0 px-6 pt-2 pb-1 text-center">
          <p className="text-[9px] tracking-[0.45em] uppercase mb-1" style={{ color: "rgba(232,174,58,0.7)" }}>
            {eyebrow}
          </p>
          <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]"
            style={{ color: "rgba(251,241,217,0.9)" }}>
            {title}
          </h3>
          <p className="mt-1 text-[11px] leading-snug" style={{ color: "rgba(251,241,217,0.5)" }}>
            {subtitle}
          </p>
        </div>

        {/* ── Phase image ── */}
        <div className="shrink-0 px-6 pt-1">
          <PhaseImage phase={phase} />
        </div>

        {/* ── Voyage tracker (in-flight + success) ── */}
        <div className="shrink-0 px-6"
          style={{
            opacity:    (isInFlight || isSuccess) ? 1 : 0,
            maxHeight:  (isInFlight || isSuccess) ? 130 : 0,
            overflow:   "hidden",
            transition: "opacity 500ms ease, max-height 600ms cubic-bezier(0.22,1,0.36,1)",
            pointerEvents: (isInFlight || isSuccess) ? "auto" : "none",
          }}>
          <ShipVoyage phase={phase} compact={isSuccess} />
        </div>

        {/* ── In-flight status + flavor ── */}
        <div className="shrink-0 px-6 pb-2"
          style={{
            opacity:    isInFlight ? 1 : 0,
            maxHeight:  isInFlight ? 130 : 0,
            overflow:   "hidden",
            transition: "opacity 500ms ease, max-height 600ms cubic-bezier(0.22,1,0.36,1)",
            pointerEvents: isInFlight ? "auto" : "none",
          }}>
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-[11px] tracking-[0.2em] uppercase" style={{ color: "rgba(218,162,28,0.85)" }}>
              {statusMsg}
            </p>
            {phase === "proving" && (
              <p className="text-[10px] max-w-[260px] leading-snug" style={{ color: "rgba(251,241,217,0.4)" }}>
                ZK proof runs in your browser. Keep this window open.
              </p>
            )}
            <FlavorText phase={phase} />
          </div>
        </div>

        {/* ── Success ── */}
        {isSuccess && (
          <div className="shrink-0 px-6 pb-4">
            {txHash && (
              <div className="rounded-2xl border p-3 flex items-start gap-3 mb-3"
                style={{ background: "rgba(5,150,105,0.08)", borderColor: "rgba(5,150,105,0.25)" }}>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: "rgba(5,150,105,0.2)" }}>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7L5.5 10.5L12 4" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-emerald-500">Account created</p>
                  <p className="font-mono text-[9px] mt-1 break-all" style={{ color: "rgba(251,241,217,0.5)" }}>
                    {txHash}
                  </p>
                </div>
              </div>
            )}
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
            {txHash && (
              <div className="flex justify-center mt-2">
                <a href={`${process.env.PLASMO_PUBLIC_EXPLORER_URL ?? "https://testnet.monadexplorer.com"}/tx/${txHash}`}
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
        <div
          className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-6 pt-2 pb-2 space-y-4"
          style={{
            opacity:       isFormOrError ? 1 : 0,
            transition:    "opacity 400ms ease",
            pointerEvents: isFormOrError ? "auto" : "none",
            display:       isFormOrError ? undefined : "none",
          }}>

          {/* Fee breakdown card */}
          <div className="rounded-2xl overflow-hidden"
            style={{ background: "rgba(251,241,217,0.03)", border: "1px solid rgba(251,241,217,0.08)" }}>
            {/* Relayer fee (batch cost) */}
            <div className="flex justify-between items-center px-4 py-3">
              <div>
                <p className="text-[10px] tracking-[0.2em] uppercase" style={{ color: "rgba(251,241,217,0.5)" }}>
                  Relayer fee
                </p>
                <p className="text-[9px] mt-0.5" style={{ color: "rgba(251,241,217,0.25)" }}>
                  {plan
                    ? `${plan.numBatches} batch${plan.numBatches > 1 ? "es" : ""} × 0.5 MON`
                    : "0.5 MON per batch"}
                </p>
              </div>
              <span className="font-mono text-[11px]" style={{ color: "rgba(251,241,217,0.55)" }}>
                {plan ? `${ethers.formatEther(plan.totalRelayerFee)} MON` : "—"}
              </span>
            </div>
            <div className="h-px" style={{ background: "rgba(251,241,217,0.06)" }} />
            {/* Creation fee — covered inside relayer fee, shown for clarity */}
            <div className="flex justify-between items-center px-4 py-3">
              <div>
                <p className="text-[10px] tracking-[0.2em] uppercase" style={{ color: "rgba(251,241,217,0.5)" }}>
                  Creation fee
                </p>
                <p className="text-[9px] mt-0.5" style={{ color: "rgba(251,241,217,0.25)" }}>
                  One-time smart account deploy (via relayer)
                </p>
              </div>
              <span className="font-mono text-[11px]" style={{ color: "rgba(251,241,217,0.55)" }}>
                1.0 MON
              </span>
            </div>
            <div className="h-px" style={{ background: "rgba(251,241,217,0.06)" }} />
            {/* Total */}
            <div className="flex justify-between items-center px-4 py-3"
              style={{ background: plan ? "rgba(163,110,20,0.06)" : "rgba(248,113,113,0.06)" }}>
              <p className="text-[10px] tracking-[0.2em] uppercase font-semibold"
                style={{ color: plan ? "rgba(232,174,58,0.8)" : "rgba(248,113,113,0.8)" }}>
                Total cost
              </p>
              <span className="font-mono text-[12px] font-semibold"
                style={{ color: plan ? "#E8AE3A" : "#f87171" }}>
                {plan ? `${ethers.formatEther(plan.totalCost)} MON` : "Insufficient"}
              </span>
            </div>
          </div>

          {/* Insufficient error */}
          {!plan && (
            <div className="flex items-start gap-2 p-3 rounded-xl"
              style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                className="text-red-500 mt-0.5 shrink-0">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="text-[11px] leading-relaxed" style={{ color: "rgba(248,113,113,0.85)" }}>
                Not enough balance in shadow. Mask at least 1.5 MON first (1 MON creation + 0.5 MON relayer fee).
              </p>
            </div>
          )}

          {/* Fatal error from last attempt */}
          {phase === "error" && fatal && (
            <div className="flex items-start gap-2 p-3 rounded-xl"
              style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                className="text-red-500 mt-0.5 shrink-0">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="text-[11px] leading-relaxed" style={{ color: "rgba(248,113,113,0.85)" }}>
                {fatal}
              </p>
            </div>
          )}

          <p className="text-center font-serif italic text-[11px] pt-1"
            style={{ color: "rgba(251,241,217,0.35)" }}>
            "Your identity, crystallised in shadow."
          </p>

          <div style={{ height: 8 }} />
        </div>

        {/* ── Fixed footer slider ── */}
        {isFormOrError && (
          <div className="shrink-0 px-6 pt-3 pb-6"
            style={{ borderTop: "1px solid rgba(251,241,217,0.08)" }}>
            <ShipSlider canSubmit={canSubmit} phase={phase} onCommit={handleCreate} />
          </div>
        )}

      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes cnaShipBob {
          0%,100% { transform: translateY(-2px) rotate(-2deg); }
          50%      { transform: translateY(2px) rotate(2deg); }
        }
        @keyframes cnaAnchorDrop {
          0%   { transform: translateX(-50%) translateY(-8px); opacity: 0; }
          65%  { transform: translateX(-50%) translateY(2px);  opacity: 1; }
          100% { transform: translateX(-50%) translateY(0px);  opacity: 1; }
        }
        @keyframes cnaNightFloat {
          0%, 100% { transform: translateY(0px) rotate(-1deg); }
          50%       { transform: translateY(-8px) rotate(1deg); }
        }
        @keyframes cnaShipFloat {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-5px); }
        }
        @keyframes cnaShipSail {
          0%   { transform: translateY(0px)  rotate(-6deg) scale(1.05); }
          25%  { transform: translateY(-4px) rotate(0deg)  scale(1.08); }
          50%  { transform: translateY(0px)  rotate(6deg)  scale(1.05); }
          75%  { transform: translateY(-4px) rotate(0deg)  scale(1.08); }
          100% { transform: translateY(0px)  rotate(-6deg) scale(1.05); }
        }
        @keyframes cnaImgSlideOutLeft {
          from { transform: translateX(0%);    opacity: 1; }
          to   { transform: translateX(-110%); opacity: 0; }
        }
        @keyframes cnaImgSlideInRight {
          from { transform: translateX(110%);  opacity: 0; }
          to   { transform: translateX(0%);    opacity: 1; }
        }
        @keyframes cnaFlavorFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </LiquidSheet>
  )
}