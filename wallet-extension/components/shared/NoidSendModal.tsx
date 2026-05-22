/**
 * NoidSendModal.tsx
 *
 * Private transfer (Send) modal for Noid mode in the extension wallet.
 *
 * Recipient selection:
 *   - Browse registered Noid users from GET /api/noidusers/all
 *     Each user has { name, noidModePublicKey, zkPublicKey }
 *   - OR paste a raw Noid key directly
 *     Format: "<ecPublicKey>|<zkPublicKey>"
 *
 * Transfer logic is a direct port of TransferModal.jsx from the original
 * web dapp, adapted for the extension's WalletContext / PoolContext shape:
 *   - walletKeys  → wallet.noidAccount (zk.secretKey, zk.publicKey, publicKey, privateWallet.publicKey)
 *   - allUnspentUTXOs / getMerkleProof come from usePool()
 *   - planTransfer / buildPlans / buildTransferCall identical to the dapp
 *
 * UX:
 *   - Recipient + amount → "form" phase
 *   - Ship Slider (same drag mechanic as SendModal) to commit
 *   - Ship Voyage progress bar (same 4-port design as MaskModal) during flight
 *     Ports: Relayer → Building → Proving → Sending → Done
 *   - Success / Error states with retry support for RelayerFee errors
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"
import { ethers } from "ethers"
import * as snarkjs from "snarkjs"
import { buildPoseidon } from "circomlibjs"
import { useWallet } from "../../context/WalletContext"
import { usePool } from "../../context/PoolContext"
import { useThemeTokens } from "../../lib/useThemeTokens"
import { BASE_URL } from "../../services/api"
import ModalPortal from "./ModalPortal"
import shipImg from "../../assets/ship/ship.png"
import { zkAssetUrl } from "~services/mask"
import { createCommitment } from "~crypto/commitment"

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_INPUTS = 4
const FEE_PER_CALL = ethers.parseEther("0.5")
const FEE_RETRY_EXTRA = ethers.parseEther("0.1")
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000"
const ZERO_BIG = BigInt(0)

// ─── Types ────────────────────────────────────────────────────────────────────
interface NoidUser {
  _id: string
  name: string
  noidModePublicKey: string // EC public key (the part before "|")
  zkPublicKey: string
}

interface ParsedRecipient {
  ecPublicKey: string   // ECIES encrypt target
  zkPublicKey: string   // Poseidon commitment target
}

type Phase =
  | "form"
  | "relayer"
  | "building"
  | "proving"
  | "sending"
  | "success"
  | "error"

const VOYAGE_STEPS = ["Relayer", "Build", "Prove", "Send", "Done"]

// ─── Poseidon singleton ───────────────────────────────────────────────────────
let _poseidon: any = null
async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon()
  return _poseidon
}

// ─── Transfer planner (identical logic to the dapp) ──────────────────────────
function feePerCall(isRetry = false): bigint {
  return isRetry ? FEE_PER_CALL + FEE_RETRY_EXTRA : FEE_PER_CALL
}

function planTransfer(
  unspent: any[],
  transferAmt: bigint,
  isRetry = false
): { plans: any[]; numCalls: number; totalFee: bigint } | null {
  if (!unspent?.length || transferAmt <= ZERO_BIG) return null
  const fee = feePerCall(isRetry)
  const sorted = [...unspent].sort((a, b) => {
    const diff = BigInt(b.amount) - BigInt(a.amount)
    return diff > 0n ? 1 : diff < 0n ? -1 : 0
  })

  let N = 1
  for (let iter = 0; iter < 20; iter++) {
    const totalNeeded = transferAmt + fee * BigInt(N)
    const selected: any[] = []
    let acc = ZERO_BIG
    for (const u of sorted) {
      if (acc >= totalNeeded) break
      selected.push(u)
      acc += BigInt(u.amount)
    }
    if (acc < totalNeeded) return null
    const callsNeeded = Math.ceil(selected.length / MAX_INPUTS)
    if (callsNeeded <= N) return buildPlans(selected, transferAmt, fee, N)
    N = callsNeeded
  }
  return null
}

function buildPlans(
  selectedUTXOs: any[],
  transferAmt: bigint,
  fee: bigint,
  _N: number
): { plans: any[]; numCalls: number; totalFee: bigint } {
  const flat = [...selectedUTXOs]
  const batches: any[][] = []
  while (flat.length > 0) batches.push(flat.splice(0, MAX_INPUTS))

  const plans: any[] = []
  let receiverRemaining = transferAmt

  for (const batch of batches) {
    const batchTotal = batch.reduce((s: bigint, u: any) => s + BigInt(u.amount), ZERO_BIG)
    const availableForReceiver = batchTotal - fee
    const toReceiver = receiverRemaining <= availableForReceiver
      ? receiverRemaining
      : availableForReceiver
    const changeAmt = batchTotal - fee - toReceiver
    receiverRemaining -= toReceiver
    plans.push({ inputs: batch, receiverAmt: toReceiver, changeAmt, feeAmt: fee })
  }

  if (receiverRemaining > ZERO_BIG) return { plans: [], numCalls: 0, totalFee: 0n }
  return { plans, numCalls: batches.length, totalFee: fee * BigInt(batches.length) }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toBytes32(value: string | bigint): string {
  return ethers.zeroPadValue(
    ethers.toBeHex(BigInt(value)),
    32
  )
}

function randomR(): string {
  return ethers.toBigInt(ethers.randomBytes(31)).toString()
}


// ECIES-style encrypt — re-use whatever the extension exposes
function encryptNote(data: object, recipientPublicKey: string): string {
  // encryptMessage is the same helper used in PoolContext/mask
  // We import it from the same path as the dapp helper
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { encryptMessage } = require("../../lib/crypto")
  return encryptMessage(JSON.stringify(data), recipientPublicKey)
}

// ─── Build one TransferCall + ZK proof ───────────────────────────────────────
async function buildTransferCall(
  inputs: any[],
  receiverAmt: bigint,
  changeAmt: bigint,
  feeAmt: bigint,
  receiver: ParsedRecipient,
  sender: {
    zk: { secretKey: string; publicKey: string }
    privateWallet: { publicKey: string }
  },
  relayer: { zkPublicKey: string; publicKey: string },
  getMerkleProof: (poolId: string, leafIndex: number) => any
) {
  const poseidon = await getPoseidon()
  const padded = [...inputs]
  while (padded.length < MAX_INPUTS) padded.push(null)

  const enabled: number[] = []
  const c_ins: string[] = []
  const a_ins: string[] = []
  const r_ins: string[] = []
  const roots: string[] = []
  const pathElements: string[][] = []
  const pathIndices: number[][] = []
  const nullifiers: string[] = []
  const poolIds: number[] = []
  const rootsBytes32: string[] = []
  const nullifiersBytes32: string[] = []

  for (const utxo of padded) {
    if (!utxo) {
      enabled.push(0)
      c_ins.push("0"); a_ins.push("0"); r_ins.push("0"); roots.push("0")
      pathElements.push(Array(20).fill("0"))
      pathIndices.push(Array(20).fill(0))
      nullifiers.push("0"); 
      poolIds.push(0)
      console.log("ZERO_HASH",ZERO_HASH);
      rootsBytes32.push(ZERO_HASH); 
      nullifiersBytes32.push(ZERO_HASH)
      continue
    }

    enabled.push(1)
    const merkleProof = getMerkleProof(utxo.poolId, utxo.leafIndex)
    if (!merkleProof) throw new Error(`No Merkle proof for leaf ${utxo.leafIndex} in pool ${utxo.poolId}`)

    const rootBig = merkleProof.root.toString()
    const nullifier = poseidon.F.toString(
      poseidon([2n, BigInt(utxo.commitment), BigInt(utxo.randomness), BigInt(sender.zk.secretKey)])
    )

    c_ins.push(BigInt(utxo.commitment).toString())
    a_ins.push(utxo.amount)
    r_ins.push(utxo.randomness)
    roots.push(rootBig)
    pathElements.push(merkleProof.siblings.map((s: any) => s[0].toString()))
    pathIndices.push(merkleProof.pathIndices)
    nullifiers.push(nullifier)
    poolIds.push(typeof utxo.poolId === "number" ? utxo.poolId : parseInt(utxo.poolId) || 0)
    rootsBytes32.push(toBytes32(rootBig))
    nullifiersBytes32.push(toBytes32(nullifier))
  }

  const rReceiver = randomR()
  const rChange = randomR()
  const rRelayer = randomR()

  const receiverEnabled = receiverAmt > ZERO_BIG ? 1 : 0
  const changeEnabled = changeAmt > ZERO_BIG ? 1 : 0
  const relayerEnabled = feeAmt > ZERO_BIG ? 1 : 0

  const receiverCommitment = await createCommitment(receiverAmt.toString(), rReceiver, receiver.zkPublicKey)
  const changeCommitment = await createCommitment(changeAmt.toString(), rChange, sender.zk.publicKey)
  const relayerCommitment = await createCommitment(feeAmt.toString(), rRelayer, relayer.zkPublicKey)

  const encryptedNote1 = encryptNote({ amount: receiverAmt.toString(), randomness: rReceiver }, receiver.ecPublicKey)
  const encryptedNote2 = encryptNote({ amount: changeAmt.toString(), randomness: rChange }, sender.privateWallet.publicKey)
  const encryptedNote3 = encryptNote({ amount: feeAmt.toString(), randomness: rRelayer }, relayer.publicKey)

  const circuitInput = {
    sk: sender.zk.secretKey,
    pk: sender.zk.publicKey,
    relayer: relayer.zkPublicKey,
    enabled,
    c_ins, a_ins, r_ins, roots, pathElements, pathIndices, nullifiers,
    output_enabled: [receiverEnabled, changeEnabled, relayerEnabled],
    c_outs: [
      receiverEnabled ? receiverCommitment.decimal : "0",
      changeEnabled ? changeCommitment.decimal : "0",
      relayerEnabled ? relayerCommitment.decimal : "0"
    ],
    a_outs: [receiverAmt.toString(), changeAmt.toString(), feeAmt.toString()],
    r_outs: [rReceiver, rChange, rRelayer],
    receivers: [receiver.zkPublicKey, sender.zk.publicKey, relayer.zkPublicKey]
  }

  const wasmPath = zkAssetUrl("transfer_proof.wasm")
  const zkeyPath = zkAssetUrl("transfer_proof_final.zkey")

  console.log("a_outs", circuitInput.a_outs)
  console.log("a_ins", circuitInput.a_ins)
  console.log("circuit inputs: ",circuitInput);

  const { proof: zkProof, publicSignals } = await (snarkjs as any).groth16.fullProve(
    circuitInput,
    wasmPath,
    zkeyPath,
  )



  const calldata = await (snarkjs as any).groth16.exportSolidityCallData(zkProof, publicSignals)
  const argv = calldata.replace(/["[\]\s]/g, "").split(",")

  return {
    transferCall: {
      a: [argv[0], argv[1]],
      b: [[argv[2], argv[3]], [argv[4], argv[5]]],
      c: [argv[6], argv[7]],
      inputs: {
            enabled,
            roots: rootsBytes32,
            poolIds,
            nullifiers: nullifiersBytes32
      },
      C1: receiverEnabled ? receiverCommitment.bytes32 : ZERO_HASH,
      C2: changeEnabled ? changeCommitment.bytes32 : ZERO_HASH,
      C3: relayerEnabled ? relayerCommitment.bytes32 : ZERO_HASH,
      encryptedNote1,
      encryptedNote2,
      encryptedNote3
    },
    zkProof
  }
}

// ─── Parse a raw Noid key string ──────────────────────────────────────────────
function parseNoidKey(raw: string): ParsedRecipient | null {
  const trimmed = raw.trim()
  const idx = trimmed.lastIndexOf("|")
  if (idx < 1) return null
  const ec = trimmed.slice(0, idx).trim()
  const zk = trimmed.slice(idx + 1).trim()
  if (!ec || !zk) return null
  return { ecPublicKey: ec, zkPublicKey: zk }
}

// ─── Ship Slider (ported from SendModal) ─────────────────────────────────────
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
  const disabled = !canSubmit || phase === "submitting" || phase === "success"

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

  const isSuccess = phase === "success"
  const isBusy = ["relayer", "building", "proving", "sending"].includes(phase)

  let fillColor = "rgba(163,110,20,0.06)"
  let shipFilter = "drop-shadow(0 1px 2px rgba(23,19,17,0.5))"
  if (isBusy) { fillColor = "rgba(218,162,28,0.22)"; shipFilter = "drop-shadow(0 0 6px rgba(218,162,28,0.6))" }
  else if (isSuccess) { fillColor = "rgba(5,150,105,0.18)" }
  else if (canSubmit && progress > 0) { fillColor = `rgba(218,162,28,${0.08 + progress * 0.18})` }

  let trackLabel = ""
  if (isBusy) trackLabel = "Sailing…"
  else if (isSuccess) trackLabel = "Voyage complete!"
  else if (!canSubmit) trackLabel = "Fill in details to sail"
  else if (progress > 0.55) trackLabel = "Release to send!"
  else trackLabel = "Drag ship to send →"

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
      {/* Fill wave */}
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
      {/* Wave SVG */}
      <svg
        style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 18, opacity: canSubmit ? 0.2 : 0.07, pointerEvents: "none" }}
        viewBox="0 0 280 18"
        preserveAspectRatio="none"
      >
        <path d="M0 12 Q35 4 70 12 Q105 20 140 12 Q175 4 210 12 Q245 20 280 12 L280 18 L0 18 Z" fill="#1a6b8a" />
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
          paddingLeft: isSuccess ? 16 : thumbX + THUMB_W + 4,
          paddingRight: 16,
          transition: "padding-left 0.1s"
        }}
      >
        <span style={{
          fontSize: 10,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: isSuccess ? "rgba(5,150,105,0.8)" : isBusy ? "rgba(180,130,10,0.9)" : "rgba(251,241,217,0.4)",
          fontWeight: 600,
          whiteSpace: "nowrap",
          transition: "color 0.3s"
        }}>
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
          alt="Drag to send"
          draggable={false}
          style={{
            width: 46,
            height: 46,
            objectFit: "contain",
            pointerEvents: "none",
            opacity: disabled && !isBusy && !isSuccess ? 0.3 : 1,
            transition: "opacity 0.3s, transform 0.2s",
            transform: isBusy ? "scale(1.08)" : dragging ? "scale(1.05) translateY(-1px)" : "scale(1)",
            animation: isBusy ? "shipBobSlider 1.2s ease-in-out infinite" : "none"
          }}
        />
      </div>
      <style>{`@keyframes shipBobSlider { 0%,100%{transform:translateY(0) scale(1.08)} 50%{transform:translateY(-2px) scale(1.08)} }`}</style>
    </div>
  )
}

// ─── Ship Voyage Progress (ported from MaskModal, 5 ports) ───────────────────
function phaseToProgress(p: Phase): number {
  switch (p) {
    case "relayer": return 0
    case "building": return 1 / 4
    case "proving": return 2 / 4
    case "sending": return 3 / 4
    case "success": return 1
    default: return 0
  }
}

function ShipVoyage({ phase }: { phase: Phase }) {
  const progress = phaseToProgress(phase)
  const docked = phase === "success"
  const SHIP_PX = 54

  return (
    <div className="relative pb-1">
      <div className="relative h-16">
        {/* Track bg */}
        <div className="absolute left-3 right-3 top-1/2 -translate-y-1/2 h-[2px] rounded-full" style={{ background: "rgba(251,241,217,0.12)" }} />
        {/* Wake */}
        <div
          className="absolute left-3 top-1/2 -translate-y-1/2 h-[2px] rounded-full transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ width: `calc((100% - 24px) * ${progress})`, background: "linear-gradient(to right, rgba(163,110,20,0.6), #DAA21C)" }}
        />
        {/* Ports */}
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
        {/* Wave decoration */}
        <svg className="absolute bottom-0 left-0 w-full pointer-events-none opacity-25" height="6" viewBox="0 0 380 6" preserveAspectRatio="none">
          <path d="M0 3 Q47 0 95 3 Q142 6 190 3 Q237 0 285 3 Q332 6 380 3" stroke="#1a6b8a" strokeWidth="1" fill="none" />
        </svg>
        {/* Ship */}
        <div
          className="absolute top-1/2 transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ left: `calc(12px + (100% - 24px) * ${progress})`, width: SHIP_PX, height: SHIP_PX, transform: "translate(-50%, -50%)" }}
        >
          <div style={{ width: "100%", height: "100%", animation: docked ? "none" : "noidShipBob 1.6s ease-in-out infinite" }}>
            <img
              src={shipImg}
              alt="ship"
              style={{
                width: SHIP_PX,
                height: SHIP_PX,
                display: "block",
                filter: docked
                  ? "drop-shadow(0 0 8px rgba(218,162,28,0.75)) drop-shadow(0 0 16px rgba(218,162,28,0.35))"
                  : "drop-shadow(0 1px 2px rgba(23,19,17,0.5))",
                transition: "filter 400ms"
              }}
              className="select-none pointer-events-none object-contain"
            />
          </div>
          {docked && (
            <span className="absolute left-1/2 text-[14px] pointer-events-none" style={{ bottom: -6, transform: "translateX(-50%)", animation: "noidAnchorDrop 0.7s cubic-bezier(0.22,1,0.36,1)" }}>
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
        @keyframes noidShipBob { 0%,100%{transform:translateY(-2px) rotate(-2deg)} 50%{transform:translateY(1px) rotate(2deg)} }
        @keyframes noidAnchorDrop { 0%{transform:translateX(-50%) translateY(-10px);opacity:0} 60%{transform:translateX(-50%) translateY(3px);opacity:1} 100%{transform:translateX(-50%) translateY(0);opacity:1} }
      `}</style>
      <div className="h-4" />
    </div>
  )
}

// ─── Fee Breakdown ────────────────────────────────────────────────────────────
function FeeBreakdown({
  parsedAmt,
  feeResult,
  totalAvailable,
  isRetry
}: {
  parsedAmt: bigint
  feeResult: ReturnType<typeof planTransfer>
  totalAvailable: bigint
  isRetry: boolean
}) {
  if (!feeResult || parsedAmt <= ZERO_BIG) return null
  const { numCalls, totalFee } = feeResult
  const totalNeeded = parsedAmt + totalFee
  const insufficient = totalAvailable < totalNeeded
  const perCallLabel = isRetry ? "0.4" : "0.5"

  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: "rgba(251,241,217,0.08)", background: "rgba(251,241,217,0.03)" }}>
      <div className="flex justify-between px-4 py-2.5">
        <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: "rgba(251,241,217,0.5)" }}>Send</span>
        <span className="font-mono text-[11px]" style={{ color: "rgba(251,241,217,0.85)" }}>{ethers.formatEther(parsedAmt)} MON</span>
      </div>
      <div className="h-px" style={{ background: "rgba(251,241,217,0.06)" }} />
      <div className="flex justify-between items-start px-4 py-2.5">
        <div>
          <span className="block text-[10px] tracking-[0.2em] uppercase" style={{ color: "rgba(251,241,217,0.5)" }}>Relayer fee</span>
          <span className="block text-[9px] mt-0.5" style={{ color: "rgba(251,241,217,0.3)" }}>
            {numCalls} call{numCalls > 1 ? "s" : ""} × {perCallLabel} MON
            {isRetry && <span style={{ color: "rgba(245,158,11,0.7)" }}> (retry)</span>}
          </span>
        </div>
        <span className="font-mono text-[11px]" style={{ color: "rgba(251,241,217,0.45)" }}>− {ethers.formatEther(totalFee)} MON</span>
      </div>
      <div className="h-px" style={{ background: "rgba(251,241,217,0.06)" }} />
      <div className="flex justify-between px-4 py-2.5">
        <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: "rgba(251,241,217,0.5)" }}>Total deducted</span>
        <span className="font-mono text-[11px]" style={{ color: insufficient ? "#f87171" : "rgba(251,241,217,0.85)" }}>{ethers.formatEther(totalNeeded)} MON</span>
      </div>
      {!insufficient && (
        <>
          <div className="h-px" style={{ background: "rgba(251,241,217,0.06)" }} />
          <div className="flex justify-between px-4 py-2.5">
            <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: "#A36E14" }}>Receiver gets</span>
            <span className="font-mono text-[11px] font-semibold" style={{ color: "#A36E14" }}>{ethers.formatEther(parsedAmt)} MON</span>
          </div>
        </>
      )}
      {insufficient && (
        <div className="px-4 py-3" style={{ background: "rgba(248,113,113,0.06)" }}>
          <p className="text-[10px] font-semibold text-red-400 mb-0.5">Insufficient balance</p>
          <p className="text-[10px] leading-relaxed" style={{ color: "rgba(251,241,217,0.45)" }}>
            Fee is {ethers.formatEther(totalFee)} MON for {numCalls} call{numCalls > 1 ? "s" : ""}. Reduce amount or deposit more funds.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Main NoidSendModal ───────────────────────────────────────────────────────
interface Props {
  open: boolean
  onClose: () => void
}

export default function NoidSendModal({ open, onClose }: Props) {
  const { wallet } = useWallet()
  const { allUnspentUTXOs, getMerkleProof, forceSync } = usePool()
  const t = useThemeTokens()

  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  // ── recipient state ──
  const [users, setUsers] = useState<NoidUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [selectedUser, setSelectedUser] = useState<NoidUser | null>(null)
  const [pastedKey, setPastedKey] = useState("")
  const [recipientMode, setRecipientMode] = useState<"list" | "paste">("list")
  const [userSearch, setUserSearch] = useState("")

  // ── amount + retry ──
  const [amountEth, setAmountEth] = useState("")
  const [isRetry, setIsRetry] = useState(false)

  // ── execution state ──
  const [phase, setPhase] = useState<Phase>("form")
  const [statusMsg, setStatusMsg] = useState("")
  const [txHash, setTxHash] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isRelayerFeeError, setIsRelayerFeeError] = useState(false)
  const [provenCount, setProvenCount] = useState(0)
  const [totalProofs, setTotalProofs] = useState(0)

  // ── mount/unmount animation ──
  useEffect(() => {
    if (open) {
      setMounted(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    } else if (mounted) {
      setVisible(false)
      const id = setTimeout(() => {
        setMounted(false)
        resetState()
      }, 320)
      return () => clearTimeout(id)
    }
  }, [open, mounted])

  function resetState() {
    setPhase("form")
    setAmountEth("")
    setSelectedUser(null)
    setPastedKey("")
    setUserSearch("")
    setIsRetry(false)
    setTxHash(null)
    setErrorMsg(null)
    setIsRelayerFeeError(false)
    setProvenCount(0)
    setTotalProofs(0)
    setStatusMsg("")
  }

  // Esc to close
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !isBusy(phase)) onClose() }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [open, phase, onClose])

  // ── load noid users ──
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

  // ── derived: parsed amounts ──
  const parsedAmt = useMemo(() => {
    try { return ethers.parseEther(amountEth || "0") } catch { return ZERO_BIG }
  }, [amountEth])

  const totalAvailable = useMemo(
    () => allUnspentUTXOs.reduce((s, u) => s + BigInt(u.amount), ZERO_BIG),
    [allUnspentUTXOs]
  )

  const feeResult = useMemo(
    () => parsedAmt > ZERO_BIG ? planTransfer(allUnspentUTXOs, parsedAmt, isRetry) : null,
    [parsedAmt, allUnspentUTXOs, isRetry]
  )

  const retryFeeResult = useMemo(
    () => parsedAmt > ZERO_BIG ? planTransfer(allUnspentUTXOs, parsedAmt, true) : null,
    [parsedAmt, allUnspentUTXOs]
  )

  const maxTransferable = useMemo(() => {
    if (totalAvailable <= ZERO_BIG) return ZERO_BIG
    let lo = ZERO_BIG, hi = totalAvailable
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi + 1n) / 2n
      const ok = planTransfer(allUnspentUTXOs, mid, isRetry) !== null
      if (ok) lo = mid; else hi = mid - 1n
    }
    return lo
  }, [totalAvailable, allUnspentUTXOs, isRetry])

  // ── recipient resolution ──
  const resolvedRecipient: ParsedRecipient | null = useMemo(() => {
    if (recipientMode === "list" && selectedUser) {
      return { ecPublicKey: selectedUser.noidModePublicKey, zkPublicKey: selectedUser.zkPublicKey }
    }
    if (recipientMode === "paste" && pastedKey.trim()) {
      return parseNoidKey(pastedKey)
    }
    return null
  }, [recipientMode, selectedUser, pastedKey])

  const pastedKeyValid = recipientMode === "paste"
    ? (pastedKey.trim() === "" ? null : parseNoidKey(pastedKey) !== null)
    : null

  // ── canSubmit ──
  const totalNeeded = feeResult ? parsedAmt + feeResult.totalFee : parsedAmt
  const canSubmit = !!(
    resolvedRecipient &&
    parsedAmt > ZERO_BIG &&
    feeResult &&
    totalAvailable >= totalNeeded
  )

  // ── filtered users ──
  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(userSearch.toLowerCase())
  )

  // ── execute transfer ──
  const runTransfer = useCallback(async (retry: boolean) => {
    if (!wallet?.noidAccount) return
    setErrorMsg(null)
    setTxHash(null)
    setProvenCount(0)
    setTotalProofs(0)
    setIsRelayerFeeError(false)

    const recipient = resolvedRecipient
    if (!recipient) return

    try {
      setPhase("relayer")
      setStatusMsg("Hailing the relayer…")
      const relRes = await fetch(`${BASE_URL}/relayer/get`)
      if (!relRes.ok) throw new Error("Could not fetch relayer info")
      const relayer = await relRes.json()

      setPhase("building")
      setStatusMsg("Selecting inputs and building plan…")
      const plan = planTransfer(allUnspentUTXOs, parsedAmt, retry)
      if (!plan) throw new Error(`Insufficient balance. Have ${ethers.formatEther(totalAvailable)} MON.`)

      const { plans } = plan
      setTotalProofs(plans.length)

      const noid = wallet.noidAccount
      const sender = {
        zk: { secretKey: noid.zkSecretKey, publicKey: noid.zkPublicKey },
        privateWallet: { publicKey: noid.publicKey }
      }

      setPhase("proving")
      setStatusMsg(`Forging ZK proof${plans.length > 1 ? "s" : ""}…`)

      const transferCalls: any[] = []
      const zkProofs: any[] = []

      for (let i = 0; i < plans.length; i++) {
        const p = plans[i]
        setStatusMsg(`Generating ZK proof ${i + 1} of ${plans.length}…`)
        const { transferCall, zkProof } = await buildTransferCall(
          p.inputs, p.receiverAmt, p.changeAmt, p.feeAmt,
          recipient, sender, relayer, getMerkleProof
        )
        transferCalls.push(transferCall)
        zkProofs.push(zkProof)
        setProvenCount(i + 1)
      }

      setPhase("sending")
      setStatusMsg("Broadcasting to Monad…")
      const res = await fetch(`${BASE_URL}/transfer/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transferCalls, zkProofs })
      })
      const data = await res.json()

      if (!res.ok || !data.success) {
        if (data.message === "Relayer fee insufficient") {
          const err: any = new Error("Relayer fee insufficient")
          err.isRelayerFeeError = true
          throw err
        }
        throw new Error(data.message || "Transfer failed on-chain")
      }

      setTxHash(data.txHash)
      setPhase("success")
      setTimeout(() => void forceSync(), 1500)
    } catch (err: any) {
      console.error("[NoidSendModal]", err)
      setPhase("error")
      setErrorMsg(err?.reason || err?.message || "Transfer failed")
      if (err.isRelayerFeeError) setIsRelayerFeeError(true)
    }
  }, [resolvedRecipient, parsedAmt, allUnspentUTXOs, getMerkleProof, forceSync, totalAvailable, wallet])

  const handleSend = useCallback(() => runTransfer(isRetry), [runTransfer, isRetry])

  const handleRetry = useCallback(() => {
    setIsRetry(true)
    setPhase("form")
    setErrorMsg(null)
    setIsRelayerFeeError(false)
    const r = planTransfer(allUnspentUTXOs, parsedAmt, true)
    if (!r) return
    setTimeout(() => runTransfer(true), 50)
  }, [allUnspentUTXOs, parsedAmt, runTransfer])

  const retryInsufficient = retryFeeResult
    ? totalAvailable < parsedAmt + retryFeeResult.totalFee
    : true

  const isInFlight = isBusy(phase)

  if (!mounted) return null

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[2147483000] flex items-end justify-center overflow-hidden">
        {/* Backdrop */}
        <button
          aria-label="Close"
          onClick={() => { if (!isInFlight) onClose() }}
          className={`absolute inset-0 bg-ink/50 backdrop-blur-sm transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
        />

        {/* Sheet */}
        <div className={`relative w-full max-w-[420px] mx-auto transition-all duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${visible ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"}`}>
          <div
            className="relative rounded-t-[28px] border border-b-0 overflow-hidden"
            style={{
              background: "linear-gradient(165deg, #1A1510 0%, #171311 60%, #110F0E 100%)",
              borderColor: "rgba(251,241,217,0.12)",
              boxShadow: "0 -30px 60px -20px rgba(23,19,17,0.6), 0 -8px 0 0 rgba(163,110,20,0.08)"
            }}
          >
            {/* Textures */}
            <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
            <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% -10%, rgba(163,110,20,0.2) 0%, transparent 55%)" }} />
            <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 110%, rgba(74,108,182,0.18) 0%, transparent 55%)" }} />

            {/* Drag handle */}
            <div className="relative flex justify-center pt-3">
              <span className="h-1 w-10 rounded-full" style={{ background: "rgba(251,241,217,0.18)" }} />
            </div>

            {/* Close button */}
            {!isInFlight && (
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute top-3 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border transition-colors"
                style={{ background: "rgba(251,241,217,0.06)", borderColor: "rgba(251,241,217,0.12)" }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2L10 10M10 2L2 10" stroke="rgba(251,241,217,0.6)" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            )}

            {/* Header */}
            <div className="relative px-6 pt-4 pb-2 text-center">
              <p className="text-[9px] tracking-[0.45em] uppercase mb-1" style={{ color: "#A36E14" }}>
                {phase === "success" ? "Veil Drawn" : phase === "error" ? "Storm Rolled In" : "Shadow Transfer"}
              </p>
              <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]" style={{ color: "rgba(251,241,217,0.92)" }}>
                {phase === "success" ? "Treasure sent. ⚓" : phase === "error" ? "Transfer failed." : "Send Private MON"}
              </h3>
              <p className="mt-1 text-[11px] leading-snug" style={{ color: "rgba(251,241,217,0.5)" }}>
                {phase === "success"
                  ? "Your MON crossed into the shadow."
                  : `${allUnspentUTXOs.length} note${allUnspentUTXOs.length !== 1 ? "s" : ""} · ${ethers.formatEther(totalAvailable)} MON available`}
              </p>
            </div>

            {/* Voyage progress (while in flight or success) */}
            {(isInFlight || phase === "success") && (
              <div className="relative px-6 pt-4">
                <ShipVoyage phase={phase} />
              </div>
            )}

            {/* Scrollable body */}
            <div className="relative px-6 pt-4 pb-6 space-y-4 overflow-y-auto max-h-[65vh]">

              {/* ── FORM ── */}
              {(phase === "form" || phase === "error") && (
                <>
                  {isRetry && (
                    <div className="flex items-start gap-2.5 p-3 rounded-xl border" style={{ background: "rgba(245,158,11,0.06)", borderColor: "rgba(245,158,11,0.2)" }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5" className="mt-0.5 shrink-0">
                        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      <p className="text-[10px] leading-relaxed" style={{ color: "rgba(245,158,11,0.8)" }}>
                        Retry mode active — fee increased to 0.4 MON/call.
                      </p>
                    </div>
                  )}

                  {/* ── Recipient mode toggle ── */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <button
                        onClick={() => setRecipientMode("list")}
                        className="flex-1 py-2 rounded-xl text-[9px] tracking-[0.25em] uppercase font-semibold transition-all"
                        style={{
                          background: recipientMode === "list" ? "rgba(163,110,20,0.2)" : "rgba(251,241,217,0.04)",
                          border: `1px solid ${recipientMode === "list" ? "rgba(163,110,20,0.4)" : "rgba(251,241,217,0.08)"}`,
                          color: recipientMode === "list" ? "#A36E14" : "rgba(251,241,217,0.45)"
                        }}
                      >
                        Noid contacts
                      </button>
                      <button
                        onClick={() => setRecipientMode("paste")}
                        className="flex-1 py-2 rounded-xl text-[9px] tracking-[0.25em] uppercase font-semibold transition-all"
                        style={{
                          background: recipientMode === "paste" ? "rgba(163,110,20,0.2)" : "rgba(251,241,217,0.04)",
                          border: `1px solid ${recipientMode === "paste" ? "rgba(163,110,20,0.4)" : "rgba(251,241,217,0.08)"}`,
                          color: recipientMode === "paste" ? "#A36E14" : "rgba(251,241,217,0.45)"
                        }}
                      >
                        Paste Noid key
                      </button>
                    </div>

                    {/* ── Contact list ── */}
                    {recipientMode === "list" && (
                      <>
                        {usersLoading ? (
                          <p className="text-[10px] text-center py-3" style={{ color: "rgba(251,241,217,0.35)" }}>Loading contacts…</p>
                        ) : users.length === 0 ? (
                          <p className="text-[10px] p-3 rounded-xl text-center" style={{ color: "rgba(251,241,217,0.35)", background: "rgba(251,241,217,0.03)", border: "1px solid rgba(251,241,217,0.07)" }}>
                            No other Noid users yet. Use the paste tab.
                          </p>
                        ) : (
                          <>
                            <input
                              value={userSearch}
                              onChange={e => setUserSearch(e.target.value)}
                              placeholder="Search by name…"
                              className="w-full rounded-xl px-3 py-2 text-[11px] font-mono mb-2 focus:outline-none transition-colors"
                              style={{
                                background: "rgba(251,241,217,0.05)",
                                border: "1px solid rgba(251,241,217,0.1)",
                                color: "rgba(251,241,217,0.85)",
                              }}
                            />
                            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                              {filteredUsers.map(u => {
                                const picked = selectedUser?._id === u._id
                                return (
                                  <button
                                    key={u._id}
                                    onClick={() => setSelectedUser(u)}
                                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all text-left"
                                    style={{
                                      background: picked ? "rgba(163,110,20,0.15)" : "rgba(251,241,217,0.03)",
                                      border: `1px solid ${picked ? "rgba(163,110,20,0.35)" : "rgba(251,241,217,0.07)"}`,
                                    }}
                                  >
                                    <div>
                                      <p className="text-[11px] font-semibold" style={{ color: picked ? "#A36E14" : "rgba(251,241,217,0.8)" }}>{u.name}</p>
                                      <p className="font-mono text-[9px] mt-0.5" style={{ color: "rgba(251,241,217,0.35)" }}>
                                        {u.noidModePublicKey.slice(0, 12)}…{u.noidModePublicKey.slice(-6)}
                                      </p>
                                    </div>
                                    {picked && (
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#A36E14" strokeWidth="2">
                                        <polyline points="20 6 9 17 4 12" />
                                      </svg>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          </>
                        )}
                      </>
                    )}

                    {/* ── Paste key ── */}
                    {recipientMode === "paste" && (
                      <>
                        <textarea
                          value={pastedKey}
                          onChange={e => setPastedKey(e.target.value)}
                          placeholder={"0x04abc…ef|21578…142"}
                          rows={3}
                          className="w-full rounded-xl px-3 py-2.5 text-[10px] font-mono focus:outline-none transition-colors resize-none"
                          style={{
                            background: "rgba(251,241,217,0.05)",
                            border: `1px solid ${pastedKeyValid === false ? "rgba(248,113,113,0.4)" : pastedKeyValid === true ? "rgba(163,110,20,0.4)" : "rgba(251,241,217,0.1)"}`,
                            color: "rgba(251,241,217,0.85)"
                          }}
                        />
                        {pastedKeyValid === false && (
                          <p className="mt-1 text-[10px] text-red-400">
                            Invalid key. Format: {"<ecPublicKey>|<zkPublicKey>"}
                          </p>
                        )}
                        {pastedKeyValid === true && (
                          <p className="mt-1 text-[10px]" style={{ color: "#A36E14" }}>✓ Valid Noid key</p>
                        )}
                        <p className="mt-2 text-[9px] leading-relaxed" style={{ color: "rgba(251,241,217,0.3)" }}>
                          Noid key format: EC public key | ZK public key, joined by "|"
                        </p>
                      </>
                    )}
                  </div>

                  {/* ── Amount ── */}
                  <div>
                    <div className="flex items-end justify-between mb-1.5">
                      <label className="text-[9px] tracking-[0.3em] uppercase" style={{ color: "rgba(251,241,217,0.5)" }}>
                        Amount (MON)
                      </label>
                      <button
                        onClick={() => maxTransferable > 0n && setAmountEth(ethers.formatEther(maxTransferable))}
                        className="text-[9px] tracking-[0.3em] uppercase transition-colors"
                        style={{ color: "#A36E14" }}
                      >
                        Max
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={amountEth}
                        onChange={e => {
                          try {
                            const entered = ethers.parseEther(e.target.value || "0")
                            setAmountEth(entered > maxTransferable ? ethers.formatEther(maxTransferable) : e.target.value)
                          } catch {
                            setAmountEth(e.target.value)
                          }
                        }}
                        placeholder="0.00"
                        className="w-full rounded-xl px-4 py-3 text-[15px] font-mono focus:outline-none transition-colors"
                        style={{
                          background: "rgba(251,241,217,0.05)",
                          border: "1px solid rgba(251,241,217,0.1)",
                          color: "rgba(251,241,217,0.9)"
                        }}
                      />
                    </div>
                    {maxTransferable > 0n && (
                      <p className="mt-1 text-[9px]" style={{ color: "rgba(245,158,11,0.7)" }}>
                        Max transferable: {ethers.formatEther(maxTransferable)} MON
                      </p>
                    )}
                  </div>

                  {/* ── Fee breakdown ── */}
                  <FeeBreakdown
                    parsedAmt={parsedAmt}
                    feeResult={feeResult}
                    totalAvailable={totalAvailable}
                    isRetry={isRetry}
                  />

                  {/* ── Privacy note ── */}
                  <div className="flex items-start gap-2.5 p-3 rounded-xl border" style={{ background: "rgba(163,110,20,0.06)", borderColor: "rgba(163,110,20,0.15)" }}>
                    <MaskGlyph />
                    <p className="text-[10px] leading-relaxed" style={{ color: "rgba(251,241,217,0.45)" }}>
                      Shielded end-to-end. Only the recipient can decrypt their note. Submitted by the relayer — your identity stays in the shadow.
                    </p>
                  </div>

                  {/* ── Error block ── */}
                  {phase === "error" && errorMsg && !isRelayerFeeError && (
                    <div className="p-3 rounded-xl border" style={{ background: "rgba(248,113,113,0.06)", borderColor: "rgba(248,113,113,0.25)" }}>
                      <p className="text-[10px] font-semibold text-red-400 mb-0.5">Transfer Failed</p>
                      <p className="text-[10px] break-words" style={{ color: "rgba(251,241,217,0.55)" }}>{errorMsg}</p>
                    </div>
                  )}

                  {phase === "error" && isRelayerFeeError && (
                    <div className="p-3 rounded-xl border space-y-2" style={{ background: "rgba(245,158,11,0.06)", borderColor: "rgba(245,158,11,0.2)" }}>
                      <p className="text-[10px] font-semibold" style={{ color: "rgba(245,158,11,0.9)" }}>Relayer Fee Too Low</p>
                      <p className="text-[10px] leading-relaxed" style={{ color: "rgba(251,241,217,0.55)" }}>
                        Gas cost exceeded the fee. Retry with +0.1 MON per call.
                      </p>
                      {retryFeeResult && (
                        <div className="rounded-lg overflow-hidden border" style={{ borderColor: "rgba(251,241,217,0.08)" }}>
                          <div className="flex justify-between px-3 py-2">
                            <span className="text-[9px] uppercase tracking-widest" style={{ color: "rgba(251,241,217,0.4)" }}>Retry fee</span>
                            <span className="font-mono text-[10px]" style={{ color: "rgba(245,158,11,0.85)" }}>
                              {retryFeeResult.numCalls} × 0.4 = {ethers.formatEther(retryFeeResult.totalFee)} MON
                            </span>
                          </div>
                          {retryInsufficient && (
                            <div className="px-3 py-2" style={{ background: "rgba(248,113,113,0.06)" }}>
                              <p className="text-[9px] text-red-400">Still insufficient — reduce amount or deposit more.</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Ship slider ── */}
                  <ShipSlider canSubmit={canSubmit} phase={phase} onCommit={handleSend} />
                </>
              )}

              {/* ── BUSY STATUS ── */}
              {isInFlight && (
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
                      <p className="text-[12px] font-semibold text-emerald-500">Transfer confirmed</p>
                      <p className="font-mono text-[10px] mt-1 break-all" style={{ color: "rgba(251,241,217,0.5)" }}>{txHash}</p>
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
                    "The veil holds. Yer coins sail uncharted seas."
                  </p>
                </div>
              )}

              {/* ── Footer buttons for error states ── */}
              {phase === "error" && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {!isRelayerFeeError && (
                    <button
                      onClick={() => { setPhase("form"); setErrorMsg(null) }}
                      className="rounded-xl border py-3 text-[11px] tracking-[0.25em] uppercase transition-colors"
                      style={{ background: "rgba(251,241,217,0.04)", borderColor: "rgba(251,241,217,0.1)", color: "rgba(251,241,217,0.7)" }}
                    >
                      Try Again
                    </button>
                  )}
                  {isRelayerFeeError && (
                    <button
                      onClick={handleRetry}
                      disabled={retryInsufficient}
                      className="rounded-xl py-3 text-[11px] tracking-[0.25em] uppercase transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.35)", color: "rgba(245,158,11,0.9)" }}
                    >
                      Retry (+fee)
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="rounded-xl border py-3 text-[11px] tracking-[0.25em] uppercase transition-colors"
                    style={{ background: "rgba(251,241,217,0.04)", borderColor: "rgba(251,241,217,0.1)", color: "rgba(251,241,217,0.6)" }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isBusy(p: Phase): boolean {
  return ["relayer", "building", "proving", "sending"].includes(p)
}

function MaskGlyph() {
  return (
    <svg width="18" height="12" viewBox="0 0 20 14" fill="none" className="shrink-0 mt-0.5">
      <path
        d="M2 6 Q4 2 7 2 Q9 2 10 4 Q11 2 13 2 Q16 2 18 6 Q17 11 13 11 Q11 11 10 9 Q9 11 7 11 Q3 11 2 6 Z"
        fill="rgba(163,110,20,0.7)"
      />
    </svg>
  )
}