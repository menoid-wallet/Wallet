/**
 * TxApprovalModal.tsx
 *
 * Transaction signing modal — shown when a dapp calls eth_sendTransaction.
 *
 * Open mode:  signs normally with the user's private key and broadcasts.
 * Noid mode:  builds ExecuteFunctionCall ZK proofs (one per UTXO batch,
 *             0.5 MON relayer fee PER BATCH) + NoidAccountOwnership proof,
 *             then posts to /noidroutes/executefunction and shows the
 *             voyage animation identical to CreateNoidSmartAccountModal.
 *
 * Layout:
 *   form/error (open)  — existing cream card with ship slider + cancel
 *   form/error (noid)  — same structure, dark ink card (noid theme)
 *   in-flight (noid)   — voyage tracker + phase image animation
 *   success (noid)     — success card + Done button
 *
 * The noid "slide ship to execute" slider commits and immediately transitions
 * to the voyage tracker — the user cannot cancel mid-flight.
 */

import React, { useCallback, useEffect, useRef, useState } from "react"
import { ethers } from "ethers"
import * as snarkjs from "snarkjs"
import { buildPoseidon } from "circomlibjs"
import { MONAD_RPC_URLS, getProvider } from "../lib/rpc"
import { useWallet } from "../context/WalletContext"
import { usePool } from "../context/PoolContext"
import { fetchRelayerKeys, BASE_URL } from "../services/api"
import { createCommitment } from "../crypto/commitment"
import { encryptMessage } from "../lib/crypto"
import { zkAssetUrl } from "../services/mask"
import { saveOpenTx, saveNoidTx } from "../lib/txStore"
import shipImg      from "../assets/ship/ship.png"
import nightShipImg from "../assets/ship/night_ship.png"
import createdImg   from "../assets/meno/created.png"
import createImg    from "../assets/meno/create_noid_account.png"

// ── Preload noid-mode images ───────────────────────────────────────────────────
;[nightShipImg, createdImg, createImg].forEach(src => {
  const i = new Image(); i.src = src
})

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)"
const EASE   = "cubic-bezier(0.65, 0, 0.35, 1)"

const GOLD_DEEP = "#A36E14"
const INK       = "#171311"
const BONE      = "#FBF1D9"
const CREAM_LOW = "#EAD5A7"

// BN128 field prime — used to mod keccak hashes into the field
const FIELD_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
)

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_INPUTS = 4
const ZERO_HASH  = "0x0000000000000000000000000000000000000000000000000000000000000000"
const ZERO_BIG   = BigInt(0)

// Per-network relayer fee per batch:
//   monad        -> 0.5 MON,    retry extra -> 0.1 MON
//   sepolia      -> 0.003 ETH,  retry extra -> 0.002 ETH
//   base_sepolia -> 0.00005 ETH, retry extra -> 0.00003 ETH
function getFeePerCall(networkId: string): bigint {
  if (networkId === "base_sepolia") return ethers.parseEther("0.00005")
  if (networkId === "sepolia")      return ethers.parseEther("0.003")
  return ethers.parseEther("0.5")     // monad
}
function getFeeRetryExtra(networkId: string): bigint {
  if (networkId === "base_sepolia") return ethers.parseEther("0.00003")
  if (networkId === "sepolia")      return ethers.parseEther("0.002")
  return ethers.parseEther("0.1")     // monad
}
function feePerCall(isRetry = false, networkId = "monad"): bigint {
  return isRetry
    ? getFeePerCall(networkId) + getFeeRetryExtra(networkId)
    : getFeePerCall(networkId)
}

// ─── Planner (inherited from NoidSendModal — fee is PER BATCH) ────────────────
// Picks the fewest UTXOs to cover callValue + (fee × number_of_batches),
// then splits them into batches of MAX_INPUTS, distributing callValue across
// batches and charging the relayer fee in EACH batch.
function planExecute(
  unspent: any[], callValue: bigint, isRetry = false, networkId = "monad"
): { plans: any[]; numCalls: number; totalFee: bigint } | null {
  if (!unspent?.length || callValue < ZERO_BIG) return null
  const fee = feePerCall(isRetry, networkId)
  const sorted = [...unspent].sort((a, b) => {
    const d = BigInt(b.amount) - BigInt(a.amount)
    return d > 0n ? 1 : d < 0n ? -1 : 0
  })
  let N = 1
  for (let iter = 0; iter < 20; iter++) {
    const need = callValue + fee * BigInt(N)
    const sel: any[] = []; let acc = ZERO_BIG
    for (const u of sorted) { if (acc >= need) break; sel.push(u); acc += BigInt(u.amount) }
    if (acc < need) return null
    const calls = Math.ceil(sel.length / MAX_INPUTS)
    if (calls <= N) return buildPlans(sel, callValue, fee)
    N = calls
  }
  return null
}
function buildPlans(
  sel: any[], callValue: bigint, fee: bigint
): { plans: any[]; numCalls: number; totalFee: bigint } {
  const flat = [...sel]; const batches: any[][] = []
  while (flat.length > 0) batches.push(flat.splice(0, MAX_INPUTS))
  const plans: any[] = []; let rem = callValue
  for (const b of batches) {
    const tot    = b.reduce((s: bigint, u: any) => s + BigInt(u.amount), ZERO_BIG)
    const avail  = tot - fee
    const toCall = rem <= avail ? rem : avail
    const change = tot - fee - toCall
    rem -= toCall
    plans.push({ inputs: b, callAmt: toCall, changeAmt: change, feeAmt: fee })
  }
  if (rem > ZERO_BIG) return { plans: [], numCalls: 0, totalFee: 0n }
  return { plans, numCalls: batches.length, totalFee: fee * BigInt(batches.length) }
}

// ─── Noid phase types ─────────────────────────────────────────────────────────
type NoidPhase = "form" | "relayer" | "building" | "proving" | "sending" | "success" | "error"
const VOYAGE_STEPS = ["Relayer", "Build", "Prove", "Send", "Done"]
const WAVE_PATH = "M0 5 Q24 1 47 5 Q71 9 95 5 Q118 1 142 5 Q166 9 190 5 Q213 1 237 5 Q261 9 285 5 Q308 1 332 5 Q356 9 380 5"

function isNoidBusy(p: NoidPhase) {
  return p === "relayer" || p === "building" || p === "proving" || p === "sending"
}

function noidPhaseToProgress(p: NoidPhase): number {
  switch (p) {
    case "relayer":  return 0
    case "building": return 1 / 4
    case "proving":  return 2 / 4
    case "sending":  return 3 / 4
    case "success":  return 1
    default:         return 0
  }
}

const FLAVOR: Record<string, string[]> = {
  relayer:  ["Hailing the relayer…", "Seeking a trusted port…"],
  building: ["Charting the course…", "Assembling the ZK payload…"],
  proving:  ["Forging the zero-knowledge seal…", "No trace shall remain…", "The cryptographic tide rises…"],
  sending:  ["The call crosses the veil…", "Executing in shadow…"],
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function trunc(s: string, a = 6, b = 4) {
  if (!s) return "—"
  return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
}

function hexToDecimal(hex: string): string {
  try { return BigInt(hex).toString() } catch { return hex }
}

function formatValue(val: string | undefined): string {
  if (!val || val === "0x0" || val === "0x") return "0 MON"
  try {
    const wei = BigInt(val)
    if (wei === 0n) return "0 MON"
    const mon = Number(wei) / 1e18
    return `${mon.toFixed(mon < 0.001 ? 8 : 6)} MON`
  } catch { return val }
}

function formatGas(gas: string | undefined, gasPrice: string | undefined): string {
  if (!gas) return "—"
  try {
    const gasN = BigInt(gas)
    if (gasPrice) {
      const gp = BigInt(gasPrice)
      const fee = gasN * gp
      const gwei = Number(gp) / 1e9
      const feeEth = Number(fee) / 1e18
      return `${hexToDecimal(gas)} gas · ${gwei.toFixed(2)} Gwei · ~${feeEth.toFixed(8)} MON`
    }
    return `${hexToDecimal(gas)} gas`
  } catch { return gas }
}

function formatData(data: string | undefined): string {
  if (!data || data === "0x" || data === "0x0") return "None"
  if (data.length > 66) return `${data.slice(0, 34)}…${data.slice(-8)} (${Math.floor((data.length - 2) / 2)} bytes)`
  return data
}

const KNOWN_SELECTORS: Record<string, string> = {
  "0xa9059cbb": "transfer(address, uint256)",
  "0x23b872dd": "transferFrom(address, address, uint256)",
  "0x095ea7b3": "approve(address, uint256)",
  "0x40c10f19": "mint(address, uint256)",
  "0xfb37e883": "mintNFT(string)",
  "0x2db11544": "mint(uint256)",
  "0x6352211e": "ownerOf(uint256)",
  "0x42842e0e": "safeTransferFrom(address, address, uint256)",
  "0xe985e9c5": "isApprovedForAll(address, address)",
  "0xa22cb465": "setApprovalForAll(address, bool)",
  "0x1249c58b": "mint()",
  "0x3ccfd60b": "withdraw()",
  "0xd0e30db0": "deposit()",
  "0x2e1a7d4d": "withdraw(uint256)",
  "0x60806040": "constructor()",
  "0x38ed1739": "swapExactTokensForTokens(...)",
  "0x7ff36ab5": "swapExactETHForTokens(...)",
  "0x18cbafe5": "swapExactTokensForETH(...)",
  "0xe8e33700": "addLiquidity(...)",
  "0xf305d719": "addLiquidityETH(...)",
}

function decodeFunctionName(data: string | undefined): string | null {
  if (!data || data.length < 10) return null
  const selector = data.slice(0, 10).toLowerCase()
  return KNOWN_SELECTORS[selector] ?? null
}

// ── ZK helpers ────────────────────────────────────────────────────────────────
function toBytes32(v: string | bigint): string {
  return ethers.zeroPadValue(ethers.toBeHex(BigInt(v)), 32)
}
function randomR(): string {
  return ethers.toBigInt(ethers.randomBytes(31)).toString()
}

// ─── FlavorText ───────────────────────────────────────────────────────────────
function FlavorText({ phase }: { phase: NoidPhase }) {
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
      style={{ color: "rgba(251,241,217,0.35)", animation: "txaNoidFlavorFade 0.6s ease" }}>
      "{lines[idx]}"
    </p>
  )
}

// ─── PhaseImage (noid mode) ───────────────────────────────────────────────────
type ImgKey = "form" | "flight" | "success"
function PhaseImage({ phase }: { phase: NoidPhase }) {
  const want: ImgKey = phase === "success" ? "success" : isNoidBusy(phase) ? "flight" : "form"
  const [shown, setShown] = useState<ImgKey>(want)
  const [leaving, setLeaving] = useState<ImgKey | null>(null)
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
    <div className="relative w-full" style={{ height: 200, overflow: "hidden" }}>
      {(["form", "flight", "success"] as ImgKey[]).map(key => {
        const isShown    = key === shown && key !== leaving
        const isLeaving  = key === leaving
        const isEntering = key === entering
        const visible    = isShown || isLeaving || isEntering
        let animation = "none"
        if (isLeaving)  animation = "txaNoidImgOutLeft 380ms cubic-bezier(0.4,0,0.2,1) forwards"
        if (isEntering) animation = "txaNoidImgInRight 380ms cubic-bezier(0.4,0,0.2,1) forwards"
        const floatAnim = key === "flight" && isShown && !isLeaving && !isEntering
          ? "txaNoidNightFloat 3.5s ease-in-out infinite" : "none"
        return (
          <img key={key} src={srcMap[key]} alt=""
            style={{
              position: "absolute", inset: 0, width: "100%", maxWidth: 320,
              margin: "0 auto", height: "100%",
              objectFit: "cover", borderRadius: "16px",
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

// ─── ShipVoyage (noid in-flight / success tracker) ────────────────────────────
function ShipVoyage({ phase }: { phase: NoidPhase }) {
  const progress = noidPhaseToProgress(phase)
  const docked   = phase === "success"
  const SHIP_PX  = 44
  const [showAnchor, setShowAnchor] = useState(false)

  useEffect(() => {
    if (!docked) { setShowAnchor(false); return }
    const t = setTimeout(() => setShowAnchor(true), 950)
    return () => clearTimeout(t)
  }, [docked])

  return (
    <div className="relative pb-1 px-1">
      <div className="relative h-12">
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
              <linearGradient id="txaNoidWakeGrad" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="rgba(163,110,20,0.5)" />
                <stop offset="100%" stopColor="#DAA21C" />
              </linearGradient>
            </defs>
            <path d={WAVE_PATH} stroke="url(#txaNoidWakeGrad)" strokeWidth="2" fill="none" />
          </svg>
        </div>
        {VOYAGE_STEPS.map((_, i) => {
          const pp      = i / (VOYAGE_STEPS.length - 1)
          const reached = progress >= pp - 0.001
          const isCur   = !docked && Math.abs(progress - pp) < 0.02
          return (
            <div key={i} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `calc(12px + (100% - 24px) * ${pp})` }}>
              <div className={`relative h-2.5 w-2.5 rounded-full border transition-all duration-500 ${
                  reached ? "bg-amber-500 border-amber-500" : "bg-transparent border-white/20"
                } ${isCur ? "scale-125" : ""}`}>
                {isCur && <span className="absolute inset-0 rounded-full bg-amber-400/40 animate-ping" />}
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
          <div style={{ width: "100%", height: "100%", animation: docked ? "none" : "txaNoidShipBob 1.6s ease-in-out infinite" }}>
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
            <span className="absolute left-1/2 text-[12px] pointer-events-none"
              style={{ bottom: -4, transform: "translateX(-50%)", animation: "txaNoidAnchorDrop 0.6s cubic-bezier(0.22,1,0.36,1) forwards" }}>
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
    </div>
  )
}

// ── ShipSlider (shared for both open + noid form phase) ───────────────────────
function ShipSlider({
  canSubmit,
  disabled,
  onCommit,
  isNoid = false,
}: {
  canSubmit: boolean
  disabled: boolean
  onCommit: () => void
  isNoid?: boolean
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
  const isDisabled = disabled || !canSubmit || phase !== "idle"

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
  const thumbX  = progress * travelW

  // Colour scheme differs for noid (dark background) vs open (light background)
  const goldFill  = isNoid ? "rgba(218,162,28,0.22)" : "rgba(163,110,20,0.22)"
  const goldBord  = isNoid ? "rgba(232,174,58,0.4)"  : "rgba(163,110,20,0.4)"
  const goldBg    = isNoid ? "rgba(232,174,58,0.07)"  : "rgba(163,110,20,0.06)"
  const textIdle  = isNoid ? "rgba(251,241,217,0.4)"  : "rgba(23,19,17,0.4)"

  let fillColor = isNoid ? "rgba(232,174,58,0.07)" : "rgba(23,19,17,0.06)"
  let shipFilter = "none"
  if (phase === "submitting")         { fillColor = goldFill; shipFilter = `drop-shadow(0 0 6px ${isNoid ? "rgba(218,162,28,0.5)" : "rgba(163,110,20,0.5)"})` }
  else if (phase === "success")       { fillColor = "rgba(5,150,105,0.18)" }
  else if (canSubmit && progress > 0) { fillColor = isNoid ? `rgba(218,162,28,${0.08 + progress * 0.18})` : `rgba(163,110,20,${0.08 + progress * 0.16})` }

  let fillExtra = 0
  let trackLabel = ""
  if (disabled)                    { trackLabel = "Waiting…" }
  else if (phase === "submitting") { trackLabel = isNoid ? "Executing…" : "Signing…"; fillExtra = 9999 }
  else if (phase === "success")    { trackLabel = "Sent! ⚓"; fillExtra = 9999 }
  else if (!canSubmit)             { trackLabel = "Loading…" }
  else if (progress > 0.55)       { trackLabel = isNoid ? "Release to execute!" : "Release to sign!" }
  else                             { trackLabel = isNoid ? "Drag ship to execute →" : "Drag ship to sign →" }

  const labelColor = phase === "success"
    ? "rgba(5,150,105,0.8)"
    : phase === "submitting"
      ? isNoid ? "rgba(218,162,28,0.9)" : "rgba(163,110,20,0.9)"
      : textIdle

  const trackBorder = phase === "success"
    ? "1.5px solid rgba(5,150,105,0.35)"
    : canSubmit && !disabled ? `1.5px solid ${goldBord}` : `1.5px solid ${isNoid ? "rgba(251,241,217,0.1)" : "rgba(23,19,17,0.1)"}`

  const trackBg = phase === "success"
    ? "rgba(5,150,105,0.08)"
    : canSubmit && !disabled ? goldBg : isNoid ? "rgba(251,241,217,0.03)" : "rgba(23,19,17,0.04)"

  return (
    <div ref={trackRef} style={{
      position: "relative", width: "100%", height: 56, borderRadius: 28,
      border: trackBorder, background: trackBg, overflow: "hidden",
      cursor: isDisabled ? "not-allowed" : "default",
      userSelect: "none",
      transition: `border-color 500ms ${EASE}, background 500ms ${EASE}`,
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        background: fillColor,
        width: `${thumbX + fillExtra + 26 + THUMB_W / 2}px`,
        borderRadius: "inherit",
        transition: dragging ? "none" : "width 0.4s cubic-bezier(0.22,1,0.36,1), background 0.4s",
        pointerEvents: "none",
      }} />

      <svg style={{
        position: "absolute", bottom: 0, left: 0, width: "100%", height: 18,
        opacity: phase === "submitting" ? 0.45 : (canSubmit && !disabled) ? 0.15 : 0.06,
        pointerEvents: "none", transition: "opacity 0.5s",
        overflow: "hidden",
      }} viewBox="0 0 280 18" preserveAspectRatio="none">
        <g>
          <path d="M0 12 Q35 4 70 12 Q105 20 140 12 Q175 4 210 12 Q245 20 280 12 L280 18 L0 18 Z" fill="#A36E14" />
          <path d="M280 12 Q315 4 350 12 Q385 20 420 12 Q455 4 490 12 Q525 20 560 12 L560 18 L280 18 Z" fill="#A36E14" />
          {phase === "submitting" && (
            <animateTransform attributeName="transform" type="translate"
              from="0 0" to="-280 0" dur="2.4s" repeatCount="indefinite" />
          )}
        </g>
      </svg>

      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        pointerEvents: "none",
        paddingLeft: (phase === "success" || phase === "submitting") ? 16 : thumbX + THUMB_W + 4,
        paddingRight: 16, transition: "padding-left 0.1s",
      }}>
        <span style={{
          fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase",
          color: labelColor, fontWeight: 600, whiteSpace: "nowrap", transition: "color 0.3s",
        }}>{trackLabel}</span>
      </div>

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
        <img src={shipImg} alt="Drag to execute" draggable={false} style={{
          width: 46, height: 46, objectFit: "contain", pointerEvents: "none",
          opacity: isDisabled && phase === "idle" ? 0.3 : 1, transition: "opacity 0.3s",
          transform: dragging ? "scale(1.07) translateY(-2px)" : "scale(1)",
          animation: phase === "submitting"
            ? "txaShipSail 1.4s ease-in-out infinite"
            : dragging ? "none" : "txaShipFloat 3s ease-in-out infinite",
        }} />
      </div>
    </div>
  )
}

// ── TxRow ─────────────────────────────────────────────────────────────────────
function TxRow({ label, value, mono = false, accent = false, isNoid = false }: {
  label: string; value: string; mono?: boolean; accent?: boolean; isNoid?: boolean
}) {
  const textColor = isNoid
    ? (accent ? "#DAA21C" : "rgba(251,241,217,0.85)")
    : (accent ? GOLD_DEEP : INK)
  const labelColor = isNoid ? "rgba(251,241,217,0.38)" : "rgba(23,19,17,0.42)"
  const borderColor = isNoid ? "rgba(251,241,217,0.06)" : "rgba(23,19,17,0.06)"
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      padding: "7px 0", borderBottom: `1px solid ${borderColor}`,
    }}>
      <span style={{
        fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase",
        color: labelColor, flexShrink: 0, marginRight: 12, paddingTop: 1,
      }}>{label}</span>
      <span style={{
        fontSize: mono ? 11 : 12,
        fontFamily: mono ? "monospace" : "inherit",
        color: textColor, fontWeight: accent ? 600 : 400,
        textAlign: "right", wordBreak: "break-all", maxWidth: "65%",
      }}>{value}</span>
    </div>
  )
}

// ── Backdrop (compact open mode only) ─────────────────────────────────────────
function Backdrop() {
  return (
    <>
      <div className="absolute inset-0" style={{
        backgroundImage: `linear-gradient(160deg, ${BONE} 0%, #F4E7CC 55%, ${CREAM_LOW} 100%)`,
      }} />
      <div className="pointer-events-none absolute" style={{
        top: "-18%", right: "-12%", width: 240, height: 240, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(232,174,58,0.28) 0%, transparent 60%)",
        filter: "blur(42px)", animation: "txaOrb1 12s ease-in-out infinite",
      }} />
      <div className="pointer-events-none absolute" style={{
        bottom: "-15%", left: "-12%", width: 220, height: 220, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(163,110,20,0.16) 0%, transparent 60%)",
        filter: "blur(50px)", animation: "txaOrb2 10s ease-in-out infinite 2s",
      }} />
      <div className="pointer-events-none absolute inset-0 paper-grain" style={{ opacity: 0.18 }} />
    </>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PendingTx {
  host: string
  origin: string
  favicon: string
  tabId: number
  fromAddress: string
  txParams: {
    from?: string
    to?: string
    value?: string
    data?: string
    gas?: string
    gasPrice?: string
    maxFeePerGas?: string
    maxPriorityFeePerGas?: string
    nonce?: string
  }
  // Noid mode extras (present when the connection was via Noid Smart Account)
  isNoidMode?: boolean
}

interface Props {
  pendingTx: PendingTx
  onDone: () => void
  compact?: boolean
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function TxApprovalModal({ pendingTx, onDone, compact = true }: Props) {
  const { wallets, entries, activeIndex, activeNetwork, networkConfig } = useWallet()
  const { allUnspentUTXOs, getMerkleProof, forceSync, myNoidSmartAccounts } = usePool()

  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Noid mode state
  const [noidPhase, setNoidPhase] = useState<NoidPhase>("form")
  const [noidStatusMsg, setNoidStatusMsg] = useState("")
  const [noidTxHash, setNoidTxHash] = useState<string | null>(null)
  const [noidFatal, setNoidFatal] = useState<string | null>(null)
  // Retry state — when the relayer fee couldn't cover gas, we re-run with a
  // higher per-batch fee (+0.1 MON), mirroring NoidSendModal's retry flow.
  const [isRetry, setIsRetry] = useState(false)
  const [isRelayerFeeError, setIsRelayerFeeError] = useState(false)

  useEffect(() => { requestAnimationFrame(() => setMounted(true)) }, [])

  const wallet  = wallets[activeIndex]
  const entry   = entries[activeIndex]
  const { txParams } = pendingTx
  const isNoidMode = !!pendingTx.isNoidMode

  const canSubmit = !!wallet && !loading

  // ── Open mode: sign + broadcast ───────────────────────────────────────────
  async function handleApprove() {
    if (!wallet || !entry) return
    setLoading(true)
    setError(null)
    try {
      const provider = getProvider(activeNetwork)
      const signer = new ethers.Wallet(wallet.normalAccount.privateKey, provider)

      const txReq: ethers.TransactionRequest = {
        to:    txParams.to,
        value: txParams.value ? BigInt(txParams.value) : undefined,
        data:  txParams.data,
        gasLimit: txParams.gas ? BigInt(txParams.gas) : undefined,
        maxFeePerGas:         txParams.maxFeePerGas ? BigInt(txParams.maxFeePerGas) : undefined,
        maxPriorityFeePerGas: txParams.maxPriorityFeePerGas ? BigInt(txParams.maxPriorityFeePerGas) : undefined,
        gasPrice: (!txParams.maxFeePerGas && txParams.gasPrice) ? BigInt(txParams.gasPrice) : undefined,
        nonce: txParams.nonce ? Number(BigInt(txParams.nonce)) : undefined,
      }

      const tx = await signer.sendTransaction(txReq)

      await chrome.runtime.sendMessage({
        type: "MENOID_TX_RESULT",
        txHash: tx.hash,
        tabId: pendingTx.tabId,
      })

      // Wait for receipt to capture gasUsed, then save to tx log
      let gasUsed: string | null = null
      try {
        const receipt = await tx.wait()
        if (receipt) gasUsed = receipt.gasUsed.toString()
      } catch {}

      saveOpenTx(entry.openAddress ?? pendingTx.fromAddress, {
        type: "open",
        txHash: tx.hash,
        gasUsed,
        to: txParams.to ?? null,
        value: txParams.value ?? null,
        functionName: decodeFunctionName(txParams.data),
        timestamp: Date.now(),
      })

      setLoading(false)
      onDone()
    } catch (e: any) {
      console.error("[TxApproval] sign error:", e)
      setError(e?.message ?? "Transaction failed")
      setLoading(false)
    }
  }

  async function handleReject() {
    setLoading(true)
    try {
      await chrome.runtime.sendMessage({
        type: "MENOID_TX_REJECT",
        tabId: pendingTx.tabId,
      })
    } catch {}
    setLoading(false)
    onDone()
  }

  // ── Noid mode: build ZK proofs + call relayer ─────────────────────────────
  const handleNoidExecute = useCallback(async (retry = false) => {
    if (!wallet) return
    setNoidFatal(null)
    setIsRelayerFeeError(false)

    try {
      // ------------------------------------------------------------------
      // 0. Resolve noid account + tx parameters
      // ------------------------------------------------------------------
      const noidAcc = wallet.noidAccount
      if (!noidAcc) throw new Error("No Noid account available")

      const selectedAccount = myNoidSmartAccounts[0]
      if (!selectedAccount) throw new Error("No deployed Noid Smart Account found")

      const target   = txParams.to   ?? ""
      const valueWei = txParams.value ? BigInt(txParams.value) : 0n
      const calldata = txParams.data  ?? "0x"

      if (!target) throw new Error("Transaction has no target address")

      // ------------------------------------------------------------------
      // 1. Fetch relayer keys
      // ------------------------------------------------------------------
      setNoidPhase("relayer"); setNoidStatusMsg("Fetching relayer…")
      const relayerKeys = await fetchRelayerKeys()

      // ------------------------------------------------------------------
      // 2. Plan UTXOs — relayer fee PER BATCH (0.5, or 0.6 on retry)
      // ------------------------------------------------------------------
      setNoidPhase("building"); setNoidStatusMsg("Charting the course…")

      const plan = planExecute(allUnspentUTXOs, valueWei, retry, activeNetwork)
      if (!plan || plan.plans.length === 0) {
        throw new Error(
`Insufficient shadow balance. Need ${ethers.formatEther(valueWei)} + ${ethers.formatEther(feePerCall(retry, activeNetwork))} ${networkConfig.nativeCurrency} relayer fee per batch.`
        )
      }

      const { plans, numCalls } = plan

      // ------------------------------------------------------------------
      // 3. Build Poseidon + generate proofs per planned batch
      // ------------------------------------------------------------------
      const poseidon = await buildPoseidon()

      const sender = {
        zk: { secretKey: noidAcc.zkSecretKey, publicKey: noidAcc.zkPublicKey },
        privateWallet: { publicKey: noidAcc.publicKey },
      }

      const relayer = {
        zkPublicKey: relayerKeys.zkPublicKey,
        publicKey: relayerKeys.publicKey,
      }

      setNoidPhase("proving"); setNoidStatusMsg(`Forging ZK proof 1 of ${numCalls}…`)
      const executeCalls: any[] = []
      const zkProofs: any[]    = []

      for (let pi = 0; pi < plans.length; pi++) {
        const { inputs: batch, callAmt, changeAmt, feeAmt } = plans[pi]
        if (pi > 0) setNoidStatusMsg(`Forging ZK proof ${pi + 1} of ${numCalls}…`)

        // Randomness for the two output commitments (change + relayer fee)
        const rChange  = randomR()
        const rRelayer = randomR()

        // Output commitments
        const changeCom  = changeAmt > 0n
          ? await createCommitment(changeAmt.toString(), rChange, sender.zk.publicKey)
          : null
        const relayerCom = await createCommitment(
          feeAmt.toString(), rRelayer, relayer.zkPublicKey
        )

        // Encrypted notes
        const enc1 = changeCom
          ? encryptMessage(
              JSON.stringify({ amount: changeAmt.toString(), randomness: rChange }),
              sender.privateWallet.publicKey
            )
          : "0x"
        const enc2 = encryptMessage(
          JSON.stringify({ amount: feeAmt.toString(), randomness: rRelayer }),
          relayer.publicKey
        )

        // Build circuit inputs for each UTXO slot (pad to MAX_INPUTS)
        const enabled: number[]        = []
        const cIns: string[]           = []
        const aIns: string[]           = []
        const rIns: string[]           = []
        const roots: string[]          = []
        const pathElements: string[][] = []
        const pathIndices:  number[][] = []
        const nullifiers:   string[]   = []
        const rootsBytes32: string[]   = []
        const poolIds:      number[]   = []
        const nullsBytes32: string[]   = []

        for (let si = 0; si < MAX_INPUTS; si++) {
          if (si < batch.length) {
            const u = batch[si]

            // ✅ Correct signature: getMerkleProof(poolId, leafIndex)
            const mp = getMerkleProof(u.poolId, u.leafIndex)
            if (!mp) throw new Error(`No Merkle proof for leaf ${u.leafIndex} in pool ${u.poolId}`)

            const rootBig   = (mp as any).root.toString()
            const nullifier = poseidon.F.toString(
              poseidon([2n, BigInt(u.commitment), BigInt(u.randomness), BigInt(sender.zk.secretKey)])
            )

            enabled.push(1)
            cIns.push(BigInt(u.commitment).toString())
            aIns.push(u.amount.toString())
            rIns.push(u.randomness.toString())
            roots.push(rootBig)
            pathElements.push((mp as any).siblings.map((s: any) => s[0].toString()))
            pathIndices.push((mp as any).pathIndices)
            nullifiers.push(nullifier)
            rootsBytes32.push(toBytes32(rootBig))
            poolIds.push(typeof u.poolId === "number" ? u.poolId : parseInt(u.poolId) || 0)
            nullsBytes32.push(toBytes32(nullifier))
          } else {
            enabled.push(0)
            cIns.push("0"); aIns.push("0"); rIns.push("0"); roots.push("0")
            pathElements.push(Array(20).fill("0"))
            pathIndices.push(Array(20).fill(0))
            nullifiers.push("0")
            rootsBytes32.push(ZERO_HASH)
            poolIds.push(0)
            nullsBytes32.push(ZERO_HASH)
          }
        }

        const out_enabled = [changeCom ? 1 : 0, 1]
        const cOuts = [
          changeCom ? changeCom.decimal : "0",
          relayerCom.decimal,
        ]
        const aOuts = [changeAmt.toString(), feeAmt.toString()]
        const rOuts = [rChange, rRelayer]
        const receivers = [sender.zk.publicKey, relayer.zkPublicKey]

        const circuitInput = {
          sk:      sender.zk.secretKey,
          pk:      sender.zk.publicKey,
          relayer: relayer.zkPublicKey,
          enabled,
          c_ins:   cIns,
          a_ins:   aIns,
          r_ins:   rIns,
          roots,
          pathElements,
          pathIndices,
          nullifiers,
          out_enabled,
          a_outs:  aOuts,
          r_outs:  rOuts,
          c_outs:  cOuts,
          receivers,
          callValue: callAmt.toString(),
        }

        const { proof: zkProof, publicSignals } = await (snarkjs as any).groth16.fullProve(
          circuitInput,
          zkAssetUrl("execute_call_proof.wasm"),
          zkAssetUrl("execute_call_proof_final.zkey")
        )

        const calldata2 = await (snarkjs as any).groth16.exportSolidityCallData(zkProof, publicSignals)
        const argv = calldata2.replace(/["[\]\s]/g, "").split(",")

        executeCalls.push({
          a: [argv[0], argv[1]],
          b: [[argv[2], argv[3]], [argv[4], argv[5]]],
          c: [argv[6], argv[7]],
          inputs: {
            enabled: enabled.map(String),
            roots:   rootsBytes32,
            poolIds,
            nullifiers: nullsBytes32,
          },
          C1:             changeCom  ? changeCom.bytes32  : ZERO_HASH,
          C2:             relayerCom.bytes32,
          encryptedNote1: enc1,
          encryptedNote2: enc2,
          callValue:      callAmt.toString(),
        })

        zkProofs.push({
          pi_a: zkProof.pi_a,
          pi_b: zkProof.pi_b,
          pi_c: zkProof.pi_c,
          protocol: "groth16",
          curve:    "bn128",
        })
      }

      // ------------------------------------------------------------------
      // 4. Build NoidAccountOwnership proof
      // ------------------------------------------------------------------
      setNoidStatusMsg("Proving account ownership…")

      // Fetch current nonce from the NoidAccount contract
      const rpcProvider = getProvider(activeNetwork)
      const noidAccountAbi = ["function nonce() view returns (uint256)"]
      const noidAccountContract = new ethers.Contract(selectedAccount.account, noidAccountAbi, rpcProvider)
      const nonce = await noidAccountContract.nonce()

      // dataHash = keccak256(calldata) mod field prime
      const dataHashBig = BigInt(ethers.keccak256(calldata as `0x${string}`)) % FIELD_PRIME
      const dataHashStr = dataHashBig.toString()

      // actionHash = poseidon(target, value, dataHash)
      const actionHash = poseidon.F.toString(
        poseidon([
          BigInt(target),
          valueWei,
          dataHashBig,
        ])
      )

      // callCommitment = poseidon(commitment, nonce, actionHash)
      const callCommitmentBig = poseidon.F.toString(
        poseidon([
          BigInt(selectedAccount.commitment),
          BigInt(nonce.toString()),
          BigInt(actionHash),
        ])
      )

      const ownershipInput = {
        commitment:     selectedAccount.commitment,
        randomness:     selectedAccount.randomness,
        callCommitment: callCommitmentBig,
        nonce:          nonce.toString(),
        target:         BigInt(target).toString(),
        value:          valueWei.toString(),
        dataHash:       dataHashStr,
        sk:             noidAcc.zkSecretKey,
        pk:             noidAcc.zkPublicKey,
      }

      const { proof: ownershipProofRaw } =
        await (snarkjs as any).groth16.fullProve(
          ownershipInput,
          zkAssetUrl("noid_account_ownership.wasm"),
          zkAssetUrl("noid_account_ownership_final.zkey")
        )

      // Send the RAW snarkjs proof (pi_a/pi_b/pi_c) so the backend can call
      // snarkjs.groth16.verify on it. The backend re-derives the on-chain
      // a/b/c via exportSolidityCallData itself (matching the test flow).
      const ownershipProof = {
        pi_a:     ownershipProofRaw.pi_a,
        pi_b:     ownershipProofRaw.pi_b,
        pi_c:     ownershipProofRaw.pi_c,
        protocol: "groth16",
        curve:    "bn128",
      }

      // ------------------------------------------------------------------
      // 5. POST to relayer
      // ------------------------------------------------------------------
      setNoidPhase("sending"); setNoidStatusMsg("Broadcasting to Monad…")

      const res = await fetch(`${BASE_URL}/noidroutes/executefunction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calls:          executeCalls,
          target,
          value:          valueWei.toString(),
          data:           calldata,
          commitment:     toBytes32(selectedAccount.commitment),
          callCommitment: toBytes32(callCommitmentBig),
          ownershipProof,
          nonce:          nonce.toString(),
          noidAccount:    selectedAccount.account,
          zkProofs,
          dataHash:       dataHashStr,
        }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        const msg = errBody?.message || `Relayer responded with ${res.status}`
        // The backend returns this exact message when the fee can't cover gas.
        if (msg === "Relayer fee insufficient to cover gas") {
          const err: any = new Error(msg)
          err.isRelayerFeeError = true
          throw err
        }
        throw new Error(msg)
      }

      const { txHash, gasUsed, totalRelayerFee, estimatedCost } = await res.json()
      setNoidTxHash(txHash)

      // Resolve the dapp's pending promise with the tx hash
      try {
        await chrome.runtime.sendMessage({
          type: "MENOID_TX_RESULT",
          txHash,
          tabId: pendingTx.tabId,
        })
      } catch {}

      // Save to noid tx log (keyed by noid public key → smart account address)
      if (selectedAccount?.account && wallet?.noidAccount?.publicKey) {
        saveNoidTx(wallet.noidAccount.publicKey, selectedAccount.account, {
          type: "noid",
          txHash,
          noidSmartAccount: selectedAccount.account,
          gasUsed: gasUsed ?? null,
          totalRelayerFee: totalRelayerFee ?? null,
          estimatedCost: estimatedCost ?? null,
          to: target ?? null,
          value: txParams.value ?? null,
          functionName: decodeFunctionName(txParams.data),
          timestamp: Date.now(),
        })
      }

      setNoidPhase("success"); setNoidStatusMsg("Execution complete!")
      setTimeout(() => void forceSync(), 1500)

    } catch (e: any) {
      console.error("[TxApproval Noid]", e)
      setNoidFatal(e?.shortMessage || e?.reason || e?.message || "Execution failed.")
      if (e?.isRelayerFeeError) setIsRelayerFeeError(true)
      setNoidPhase("error")
    }
  }, [wallet, allUnspentUTXOs, getMerkleProof, myNoidSmartAccounts, txParams, pendingTx.tabId, forceSync])

  // Retry with a higher per-batch fee (+0.1 MON) to clear the gas shortfall.
  const handleNoidRetry = useCallback(() => {
    setIsRetry(true)
    setNoidPhase("form")
    setNoidFatal(null)
    setIsRelayerFeeError(false)
    // Kick off the re-run on the next tick so the phase reset lands first.
    setTimeout(() => void handleNoidExecute(true), 50)
  }, [handleNoidExecute])

  // ── Layout ────────────────────────────────────────────────────────────────
  const shellClass = compact
    ? "fixed inset-0 z-[100] flex flex-col overflow-hidden font-body"
    : "relative w-full flex flex-col overflow-hidden font-body rounded-[28px]"

  // ── Open mode render ──────────────────────────────────────────────────────
  if (!isNoidMode) {
    const shellStyle: React.CSSProperties = compact
      ? {
          color: INK,
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(24px)",
          transition: `opacity 350ms ${EASE}, transform 400ms ${SPRING}`,
        }
      : {
          color: INK,
          background: "linear-gradient(165deg, rgba(255,251,240,0.92) 0%, rgba(244,231,204,0.96) 100%)",
          backdropFilter: "blur(28px) saturate(160%)",
          WebkitBackdropFilter: "blur(28px) saturate(160%)",
          maxHeight: "min(780px, 90vh)",
          border: "1px solid rgba(23,19,17,0.08)",
          boxShadow: "0 40px 90px -28px rgba(92,58,33,0.45), inset 0 1px 0 rgba(255,255,255,0.7)",
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0) scale(1)" : "translateY(24px) scale(0.97)",
          transition: `opacity 450ms ${EASE}, transform 550ms ${SPRING}`,
        }

    return (
      <div className={shellClass} style={shellStyle}>
        {compact && <Backdrop />}
        <div className="relative z-10 shrink-0 flex items-center gap-3 px-5 pt-5 pb-4"
          style={{ borderBottom: "1px solid rgba(23,19,17,0.08)" }}>
          {pendingTx.favicon ? (
            <img src={pendingTx.favicon} alt="" className="h-9 w-9 rounded-xl shrink-0 object-contain"
              style={{ border: "1px solid rgba(23,19,17,0.12)" }} />
          ) : (
            <div className="h-9 w-9 flex items-center justify-center rounded-xl shrink-0 text-lg"
              style={{ background: "rgba(163,110,20,0.08)", border: "1px solid rgba(163,110,20,0.18)" }}>⛓</div>
          )}
          <div>
            <p style={{ fontSize: 9, letterSpacing: "0.45em", textTransform: "uppercase", color: "rgba(163,110,20,0.65)", marginBottom: 2 }}>
              Transaction Request
            </p>
            <p style={{ fontFamily: "var(--font-display, serif)", fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", color: INK }}>
              {pendingTx.host}
            </p>
            <p style={{ fontSize: 11, color: "rgba(23,19,17,0.45)" }}>wants to send a transaction</p>
          </div>
        </div>

        <div className="relative z-10 flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          <div className="px-5 py-4 space-y-3">
            <div style={{
              padding: "12px 14px", borderRadius: 16,
              background: "linear-gradient(145deg, rgba(163,110,20,0.12) 0%, rgba(232,174,58,0.08) 100%)",
              border: "1px solid rgba(163,110,20,0.28)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5), 0 4px 16px rgba(163,110,20,0.1)",
            }}>
              <p style={{ fontSize: 9, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(163,110,20,0.65)", marginBottom: 6 }}>
                Signing account
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 34, height: 34, borderRadius: "50%",
                  background: GOLD_DEEP, fontSize: 13, fontWeight: 700, color: BONE, flexShrink: 0,
                }}>
                  {(activeIndex ?? 0) + 1}
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: INK, marginBottom: 2 }}>
                    {entry?.name ?? "Account"}
                  </p>
                  <p style={{ fontFamily: "monospace", fontSize: 11, color: GOLD_DEEP }}>
                    {trunc(pendingTx.fromAddress, 10, 8)}
                  </p>
                </div>
              </div>
            </div>

            <div style={{
              padding: "12px 14px", borderRadius: 16,
              background: "rgba(23,19,17,0.03)", border: "1px solid rgba(23,19,17,0.08)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
            }}>
              <p style={{ fontSize: 9, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(23,19,17,0.38)", marginBottom: 8 }}>
                Transaction details
              </p>
              {txParams.to && <TxRow label="To" value={trunc(txParams.to, 10, 8)} mono />}
              {decodeFunctionName(txParams.data) && (
                <TxRow label="Function" value={decodeFunctionName(txParams.data)!} accent />
              )}
              <TxRow label="Value" value={formatValue(txParams.value)} accent={!!(txParams.value && txParams.value !== "0x0" && txParams.value !== "0x")} />
              <TxRow label="Network" value={networkConfig.label} />
              {(txParams.gas || txParams.gasPrice || txParams.maxFeePerGas) && (
                <TxRow label="Gas" value={formatGas(txParams.gas, txParams.maxFeePerGas ?? txParams.gasPrice)} mono />
              )}
              {txParams.nonce && <TxRow label="Nonce" value={hexToDecimal(txParams.nonce)} mono />}
              {txParams.data && txParams.data !== "0x" && (
                <TxRow label="Data" value={formatData(txParams.data)} mono />
              )}
            </div>

            {txParams.value && txParams.value !== "0x0" && txParams.value !== "0x" && (
              <div style={{
                padding: "10px 12px", borderRadius: 12,
                background: "rgba(163,110,20,0.08)", border: "1px solid rgba(163,110,20,0.22)",
                display: "flex", alignItems: "flex-start", gap: 8,
              }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
                <p style={{ fontSize: 11, color: GOLD_DEEP, lineHeight: 1.4 }}>
                  This transaction will send {formatValue(txParams.value)} from your wallet. Review carefully before signing.
                </p>
              </div>
            )}

            {txParams.data && txParams.data !== "0x" && (
              <div style={{
                padding: "10px 12px", borderRadius: 12,
                background: "rgba(23,19,17,0.04)", border: "1px solid rgba(23,19,17,0.1)",
                display: "flex", alignItems: "flex-start", gap: 8,
              }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>📄</span>
                <p style={{ fontSize: 11, color: "rgba(23,19,17,0.6)", lineHeight: 1.4 }}>
                  This transaction calls a smart contract. Make sure you trust this site before signing.
                </p>
              </div>
            )}

            {error && (
              <div style={{
                padding: "10px 12px", borderRadius: 12,
                background: "rgba(220,50,50,0.08)", border: "1px solid rgba(220,50,50,0.25)",
              }}>
                <p style={{ fontSize: 11, color: "rgba(180,30,30,0.9)" }}>{error}</p>
              </div>
            )}
          </div>
        </div>

        <div className="relative z-10 shrink-0 px-5 pt-3 pb-6"
          style={{ borderTop: "1px solid rgba(23,19,17,0.08)" }}>
          <ShipSlider canSubmit={canSubmit} disabled={loading} onCommit={handleApprove} isNoid={false} />
          <button
            onClick={handleReject}
            disabled={loading}
            className="w-full mt-3 py-2 text-[11px] tracking-[0.25em] uppercase font-semibold disabled:opacity-30"
            style={{ color: "rgba(220,50,50,0.72)", background: "none", border: "none", cursor: "pointer" }}>
            Cancel
          </button>
        </div>

        <style>{`
          @keyframes txaOrb1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-22px,15px) scale(1.1)} }
          @keyframes txaOrb2 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(28px,-20px) scale(1.12)} }
          @keyframes txaShipFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
          @keyframes txaShipSail {
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

  // ── Noid mode render ──────────────────────────────────────────────────────
  const isNoidInFlight    = isNoidBusy(noidPhase)
  const isNoidFormOrError = noidPhase === "form" || noidPhase === "error"
  const isNoidSuccess     = noidPhase === "success"

  const valueWeiPreview = txParams.value ? BigInt(txParams.value) : 0n
  const totalAvailable  = allUnspentUTXOs.reduce((s: bigint, u: any) => s + BigInt(u.amount), ZERO_BIG)

  // Plan for fee display (so the user sees the real per-batch total before sliding).
  // Uses the retry fee once we're in a retry so the displayed numbers are accurate.
  const previewPlan = planExecute(allUnspentUTXOs, valueWeiPreview, isRetry, activeNetwork)
  // Whether a retry (with the bumped fee) would even fit the available balance.
  const retryPlan      = planExecute(allUnspentUTXOs, valueWeiPreview, true, activeNetwork)
  const retryAffordable = !!retryPlan

  const noidCanSubmit = !!myNoidSmartAccounts[0] && !!previewPlan
  const perBatchFee   = ethers.formatEther(feePerCall(isRetry, activeNetwork))
  const totalFeeMon   = previewPlan
    ? ethers.formatEther(feePerCall(isRetry, activeNetwork) * BigInt(previewPlan.numCalls))
    : perBatchFee

  const noidEyebrow = isNoidSuccess ? "Execution Complete" : noidPhase === "error" ? "Storm Rolled In" : "Noid Smart Account"
  const noidTitle   = isNoidSuccess ? "Call executed privately. ⚓" : noidPhase === "error" ? "Execution failed." : "Execute via Noid"
  const noidSub     = isNoidSuccess
    ? "Your contract interaction was routed through the shadow pool"
    : previewPlan
      ? `${pendingTx.host} · ${totalFeeMon} ${networkConfig.nativeCurrency} fee (${previewPlan.numCalls} batch${previewPlan.numCalls > 1 ? "es" : ""} × ${perBatchFee})`
      : `${pendingTx.host} · Insufficient shadow balance`

  const noidShellStyle: React.CSSProperties = {
    color: BONE,
    background: "linear-gradient(160deg, #1A1410 0%, #0D0A07 60%, #171311 100%)",
    overflow: "hidden",
    opacity: mounted ? 1 : 0,
    transform: mounted ? "translateY(0)" : "translateY(24px)",
    transition: `opacity 350ms ${EASE}, transform 400ms ${SPRING}`,
    ...(compact ? {} : {
      borderRadius: 28,
      maxHeight: "min(780px, 90vh)",
      border: "1px solid rgba(251,241,217,0.07)",
      boxShadow: "0 40px 90px -28px rgba(0,0,0,0.7)",
    })
  }

  return (
    <div className={shellClass} style={noidShellStyle}>
      {/* Ambient orbs */}
      <div className="pointer-events-none absolute" style={{
        top: "-20%", right: "-10%", width: 240, height: 240, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(163,110,20,0.35) 0%, transparent 65%)",
        filter: "blur(42px)", animation: "txaNoidOrb1 12s ease-in-out infinite",
      }} />
      <div className="pointer-events-none absolute" style={{
        bottom: "-15%", left: "-10%", width: 200, height: 200, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(74,108,182,0.18) 0%, transparent 60%)",
        filter: "blur(50px)", animation: "txaNoidOrb2 10s ease-in-out infinite 2s",
      }} />

      {/* Header */}
      <div className="relative z-10 shrink-0 flex items-center gap-3 px-5 pt-5 pb-4"
        style={{ borderBottom: "1px solid rgba(251,241,217,0.08)" }}>
        {pendingTx.favicon ? (
          <img src={pendingTx.favicon} alt="" className="h-9 w-9 rounded-xl shrink-0 object-contain"
            style={{ border: "1px solid rgba(251,241,217,0.12)" }} />
        ) : (
          <div className="h-9 w-9 flex items-center justify-center rounded-xl shrink-0 text-lg"
            style={{ background: "rgba(163,110,20,0.12)", border: "1px solid rgba(163,110,20,0.25)" }}>◉</div>
        )}
        <div>
          <p style={{ fontSize: 9, letterSpacing: "0.45em", textTransform: "uppercase", color: "rgba(218,162,28,0.65)", marginBottom: 2 }}>
            {noidEyebrow}
          </p>
          <p style={{ fontFamily: "var(--font-display, serif)", fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", color: "rgba(251,241,217,0.9)" }}>
            {noidTitle}
          </p>
          <p style={{ fontSize: 11, color: "rgba(251,241,217,0.4)" }}>{noidSub}</p>
        </div>
      </div>

      {/* Phase image */}
      <div className="relative z-10 shrink-0 px-5 pt-3">
        <PhaseImage phase={noidPhase} />
      </div>

      {/* Voyage tracker */}
      <div className="relative z-10 shrink-0 px-5"
        style={{
          opacity:    (isNoidInFlight || isNoidSuccess) ? 1 : 0,
          maxHeight:  (isNoidInFlight || isNoidSuccess) ? 130 : 0,
          overflow:   "hidden",
          transition: "opacity 500ms ease, max-height 600ms cubic-bezier(0.22,1,0.36,1)",
          pointerEvents: (isNoidInFlight || isNoidSuccess) ? "auto" : "none",
        }}>
        <ShipVoyage phase={noidPhase} />
      </div>

      {/* In-flight status */}
      <div className="relative z-10 shrink-0 px-5 pb-2"
        style={{
          opacity:    isNoidInFlight ? 1 : 0,
          maxHeight:  isNoidInFlight ? 100 : 0,
          overflow:   "hidden",
          transition: "opacity 500ms ease, max-height 600ms cubic-bezier(0.22,1,0.36,1)",
        }}>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="text-[11px] tracking-[0.2em] uppercase" style={{ color: "rgba(218,162,28,0.85)" }}>
            {noidStatusMsg}
          </p>
          {noidPhase === "proving" && (
            <p className="text-[10px] max-w-[260px] leading-snug" style={{ color: "rgba(251,241,217,0.4)" }}>
              ZK proof runs in your browser. Keep this window open.
            </p>
          )}
          <FlavorText phase={noidPhase} />
        </div>
      </div>

      {/* Success card */}
      {isNoidSuccess && (
        <div className="relative z-10 shrink-0 px-5 pb-4">
          {noidTxHash && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-full rounded-2xl overflow-hidden"
                style={{ background: "rgba(251,241,217,0.04)", border: "1px solid rgba(251,241,217,0.1)" }}>
                <div className="flex justify-between items-center px-4 py-3">
                  <span className="text-[9px] tracking-[0.3em] uppercase" style={{ color: "rgba(251,241,217,0.4)" }}>
                    Tx Hash
                  </span>
                  <span className="font-mono text-[10px]" style={{ color: "rgba(218,162,28,0.8)" }}>
                    {noidTxHash.slice(0, 10)}…{noidTxHash.slice(-6)}
                  </span>
                </div>
              </div>
              <button
                onClick={onDone}
                className="w-full py-3.5 rounded-2xl text-[12px] tracking-[0.2em] uppercase font-semibold"
                style={{
                  background: "linear-gradient(135deg, rgba(163,110,20,0.22) 0%, rgba(218,162,28,0.18) 100%)",
                  border: "1px solid rgba(218,162,28,0.35)",
                  color: "#DAA21C",
                  backdropFilter: "blur(12px)",
                }}>
                Done ⚓
              </button>
              <a href={`${networkConfig.explorerUrl}/tx/${noidTxHash}`}
                target="_blank" rel="noreferrer"
                className="text-[10px] tracking-[0.2em] uppercase hover:opacity-60 transition-opacity"
                style={{ color: "rgba(251,241,217,0.35)" }}>
                View on explorer
              </a>
            </div>
          )}
        </div>
      )}

      {/* Scrollable form body (noid) */}
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-3"
        style={{
          opacity:       isNoidFormOrError ? 1 : 0,
          transition:    "opacity 400ms ease",
          pointerEvents: isNoidFormOrError ? "auto" : "none",
          display:       isNoidFormOrError ? undefined : "none",
        }}>

        {/* Executing account card */}
        <div style={{
          padding: "12px 14px", borderRadius: 16,
          background: "linear-gradient(145deg, rgba(163,110,20,0.14) 0%, rgba(232,174,58,0.08) 100%)",
          border: "1px solid rgba(218,162,28,0.3)",
        }}>
          <p style={{ fontSize: 9, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(218,162,28,0.65)", marginBottom: 6 }}>
            Noid Smart Account
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 34, height: 34, borderRadius: "50%",
              background: "rgba(218,162,28,0.2)", fontSize: 15, flexShrink: 0,
              border: "1px solid rgba(218,162,28,0.35)",
            }}>◉</div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(251,241,217,0.85)", marginBottom: 2 }}>
                {myNoidSmartAccounts[0] ? trunc(myNoidSmartAccounts[0].account, 10, 8) : "No account found"}
              </p>
              <p style={{ fontSize: 10, color: "rgba(251,241,217,0.35)" }}>
                Execution is ZK-private via shadow pool
              </p>
            </div>
          </div>
        </div>

        {/* Transaction details */}
        <div style={{
          padding: "12px 14px", borderRadius: 16,
          background: "rgba(251,241,217,0.03)", border: "1px solid rgba(251,241,217,0.08)",
        }}>
          <p style={{ fontSize: 9, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(251,241,217,0.3)", marginBottom: 8 }}>
            Transaction details
          </p>
          {txParams.to && <TxRow label="To" value={trunc(txParams.to, 10, 8)} mono isNoid />}
          {decodeFunctionName(txParams.data) && (
            <TxRow label="Function" value={decodeFunctionName(txParams.data)!} accent isNoid />
          )}
          <TxRow label="Value" value={formatValue(txParams.value)}
            accent={!!(txParams.value && txParams.value !== "0x0" && txParams.value !== "0x")} isNoid />
          <TxRow label="Relayer fee"
            value={previewPlan ? `${totalFeeMon} ${networkConfig.nativeCurrency} (${previewPlan.numCalls} × ${perBatchFee})` : `${perBatchFee} ${networkConfig.nativeCurrency} per batch`}
            accent={isRetry} isNoid />
          <TxRow label="Network" value={networkConfig.label} isNoid />
          {txParams.data && txParams.data !== "0x" && (
            <TxRow label="Data" value={formatData(txParams.data)} mono isNoid />
          )}
        </div>

        {/* Privacy note */}
        <div style={{
          padding: "10px 12px", borderRadius: 12,
          background: "rgba(163,110,20,0.08)", border: "1px solid rgba(163,110,20,0.22)",
          display: "flex", alignItems: "flex-start", gap: 8,
        }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>◉</span>
          <p style={{ fontSize: 11, color: "rgba(218,162,28,0.8)", lineHeight: 1.4 }}>
            This call is routed privately through your Noid Smart Account.
{`A ${perBatchFee} ${networkConfig.nativeCurrency} relayer fee is deducted per batch from your shadow balance.`}
          </p>
        </div>

        {/* Insufficient balance */}
        {!previewPlan && (
          <div style={{
            padding: "10px 12px", borderRadius: 12,
            background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)",
          }}>
            <p style={{ fontSize: 11, color: "rgba(248,113,113,0.85)" }}>
              Insufficient shadow balance to cover this call + relayer fee.
            </p>
          </div>
        )}

        {/* Relayer fee too low — gas exceeded the fee. Offer a bumped retry. */}
        {noidPhase === "error" && isRelayerFeeError && (
          <div style={{
            padding: "12px 14px", borderRadius: 12,
            background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.25)",
          }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(245,158,11,0.95)", marginBottom: 4 }}>
              Relayer Fee Too Low
            </p>
            <p style={{ fontSize: 10, lineHeight: 1.5, color: "rgba(251,241,217,0.6)" }}>
              {`Network gas cost came out higher than the ${ethers.formatEther(getFeePerCall(activeNetwork))} ${networkConfig.nativeCurrency} fee. Retry adds +${ethers.formatEther(getFeeRetryExtra(activeNetwork))} ${networkConfig.nativeCurrency} per batch`}
              {previewPlan
                ? ` (new total ~${ethers.formatEther(feePerCall(true, activeNetwork) * BigInt(retryPlan ? retryPlan.numCalls : previewPlan.numCalls))} ${networkConfig.nativeCurrency}).`
                : "."}
            </p>
            {!retryAffordable && (
              <p style={{ fontSize: 10, marginTop: 6, color: "rgba(248,113,113,0.85)" }}>
                {`Not enough shadow balance for the higher fee — mask more ${networkConfig.nativeCurrency}, then try again.`}
              </p>
            )}
          </div>
        )}

        {/* Generic error (non-fee) */}
        {noidPhase === "error" && !isRelayerFeeError && noidFatal && (
          <div style={{
            padding: "10px 12px", borderRadius: 12,
            background: "rgba(220,50,50,0.08)", border: "1px solid rgba(220,50,50,0.25)",
          }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(248,113,113,0.95)", marginBottom: 2 }}>
              Execution Failed
            </p>
            <p style={{ fontSize: 11, color: "rgba(248,113,113,0.85)", wordBreak: "break-word" }}>{noidFatal}</p>
          </div>
        )}

        <div style={{ height: 8 }} />
      </div>

      {/* Footer (noid form / error) */}
      {isNoidFormOrError && (
        <div className="relative z-10 shrink-0 px-5 pt-3 pb-6"
          style={{ borderTop: "1px solid rgba(251,241,217,0.08)" }}>

          {/* On a relayer-fee error, swap the slider for explicit Retry / Cancel */}
          {noidPhase === "error" && isRelayerFeeError ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleNoidRetry}
                disabled={!retryAffordable}
                className="rounded-2xl py-3.5 text-[11px] tracking-[0.2em] uppercase font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: "linear-gradient(135deg, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0.10) 100%)",
                  border: "1px solid rgba(245,158,11,0.35)",
                  color: "rgba(245,158,11,0.95)",
                }}>
                Retry (+{ethers.formatEther(getFeeRetryExtra(activeNetwork))})
              </button>
              <button
                onClick={handleReject}
                className="rounded-2xl py-3.5 text-[11px] tracking-[0.2em] uppercase font-semibold"
                style={{
                  background: "rgba(251,241,217,0.04)",
                  border: "1px solid rgba(251,241,217,0.1)",
                  color: "rgba(251,241,217,0.6)",
                }}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <ShipSlider canSubmit={noidCanSubmit} disabled={false} onCommit={() => void handleNoidExecute(isRetry)} isNoid />
              <button
                onClick={handleReject}
                className="w-full mt-3 py-2 text-[11px] tracking-[0.25em] uppercase font-semibold"
                style={{ color: "rgba(248,113,113,0.65)", background: "none", border: "none", cursor: "pointer" }}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      <style>{`
        @keyframes txaNoidOrb1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-22px,15px) scale(1.1)} }
        @keyframes txaNoidOrb2 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(28px,-20px) scale(1.12)} }
        @keyframes txaShipFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes txaShipSail {
          0%{transform:translateY(0) rotate(-6deg) scale(1.05)}
          25%{transform:translateY(-4px) rotate(0deg) scale(1.08)}
          50%{transform:translateY(0) rotate(6deg) scale(1.05)}
          75%{transform:translateY(-4px) rotate(0deg) scale(1.08)}
          100%{transform:translateY(0) rotate(-6deg) scale(1.05)}
        }
        @keyframes txaNoidShipBob {
          0%,100% { transform: translateY(-2px) rotate(-2deg); }
          50%     { transform: translateY(2px) rotate(2deg); }
        }
        @keyframes txaNoidAnchorDrop {
          0%   { transform: translateX(-50%) translateY(-8px); opacity: 0; }
          65%  { transform: translateX(-50%) translateY(2px);  opacity: 1; }
          100% { transform: translateX(-50%) translateY(0px);  opacity: 1; }
        }
        @keyframes txaNoidNightFloat {
          0%, 100% { transform: translateY(0px) rotate(-1deg); }
          50%       { transform: translateY(-8px) rotate(1deg); }
        }
        @keyframes txaNoidImgOutLeft {
          from { transform: translateX(0%);    opacity: 1; }
          to   { transform: translateX(-110%); opacity: 0; }
        }
        @keyframes txaNoidImgInRight {
          from { transform: translateX(110%);  opacity: 0; }
          to   { transform: translateX(0%);    opacity: 1; }
        }
        @keyframes txaNoidFlavorFade {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}