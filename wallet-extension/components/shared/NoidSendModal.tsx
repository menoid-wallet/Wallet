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
import { BASE_URL, fetchRelayerKeys } from "../../services/api"
import { saveNoidSendTx, saveUnmaskTx } from "../../lib/txStore"
import { executeUnmask } from "../../services/unmask"
import { CHAIN_BY_ID } from "../../lib/chains"
import { explorerTxUrl } from "../../lib/rpc"
import type { NetworkId } from "../../lib/networks"
import { encryptMessage } from "../../lib/crypto"
import LiquidSheet from "./LiquidSheet"
import AnimatedLogo from "../brand/AnimatedLogo"
import CloudChip from "../brand/CloudChip"
import CloudVoyage from "./CloudVoyage"
import { zkAssetUrl } from "~services/mask"
import { resolveRecipient } from "~services/register"
import bs58 from "bs58"

// BN254 scalar field prime (Fr) — addresses are reduced into this field to match
// on-chain reconstruction and the user-commitment derivation.
const SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n

/** Reduce a real wallet address into the BN254 scalar field (owner_address input). */
function addressToFieldElement(addr: string, networkId: NetworkId): string {
  if (networkId === "solana") {
    return (BigInt("0x" + Buffer.from(bs58.decode(addr)).toString("hex")) % SCALAR_FIELD).toString()
  }
  return (BigInt(addr) % SCALAR_FIELD).toString()
}
import { createCommitment } from "~crypto/commitment"

// ─── Constants ────────────────────────────────────────────────────────────────
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

function getFeePerCallMon(networkId: string): string {
  if (networkId === "monad") return "0"
  if (networkId === "base_sepolia") return "0.00005"
  if (networkId === "sepolia") return "0.003"
  return "0.0001" // solana, sui, aptos
}

function getFeeRetryExtraMon(networkId: string): string {
  if (networkId === "monad") return "0"
  if (networkId === "base_sepolia") return "0.00003"
  if (networkId === "sepolia") return "0.002"
  return "0.00005" // solana, sui, aptos
}

function getFeePerCall(networkId: string): bigint {
  const decs = DECIMALS[networkId] || 18
  return parseAmount(getFeePerCallMon(networkId), decs)
}

function getFeeRetryExtra(networkId: string): bigint {
  const decs = DECIMALS[networkId] || 18
  return parseAmount(getFeeRetryExtraMon(networkId), decs)
}

// Withdraw (unmask) fee — used when the recipient hasn't registered, so we send
// their funds straight to their real wallet instead of privately. Mirrors
// UnMaskModal's fee (monad 0.2).
function getWithdrawFeeMon(networkId: string): string {
  if (networkId === "monad") return "0.2"
  return ["sepolia", "base_sepolia"].includes(networkId) ? "0.5" : "0.0001"
}

const MAX_INPUTS = 4
const ZERO_HASH  = "0x0000000000000000000000000000000000000000000000000000000000000000"
const ZERO_BIG   = BigInt(0)

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
function encryptNote(data: object, pk: string, networkId: NetworkId): string {
  return encryptMessage(JSON.stringify(data), pk, networkId)
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
  sender: { zk: { secretKey: string; publicKey: string }; privateWallet: { publicKey: string }; ownerAddressField: string },
  relayer: { zkPublicKey: string; publicKey: string },
  getMerkleProof: (poolId: string, leafIndex: number) => any,
  networkId: NetworkId = "monad"
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
  const isMonad = networkId === "monad"
  const rR = randomR(), rC = randomR(), rRel = randomR()
  const rE = receiverAmt > ZERO_BIG ? 1 : 0
  const cE = changeAmt > ZERO_BIG ? 1 : 0
  const fE = feeAmt > ZERO_BIG ? 1 : 0
  const rCom = await createCommitment(receiverAmt.toString(), rR, receiver.zkPublicKey)
  const cCom = await createCommitment(changeAmt.toString(), rC, sender.zk.publicKey)
  const fCom = isMonad ? null : await createCommitment(feeAmt.toString(), rRel, relayer.zkPublicKey)
  const n1 = encryptNote({ amount: receiverAmt.toString(), randomness: rR }, receiver.ecPublicKey, networkId)
  const n2 = encryptNote({ amount: changeAmt.toString(), randomness: rC }, sender.privateWallet.publicKey, networkId)
  const n3 = isMonad ? "0x" : encryptNote({ amount: feeAmt.toString(), randomness: rRel }, relayer.publicKey, networkId)
  const ci: any = {
    sk: sender.zk.secretKey, owner_address: sender.ownerAddressField, relayer: relayer.zkPublicKey,
    enabled, c_ins, a_ins, r_ins, roots, pathElements, pathIndices, nullifiers,
    output_enabled: [rE, cE, fE],
    c_outs: [rE ? rCom.decimal:"0", cE ? cCom.decimal:"0", fE && fCom ? fCom.decimal:"0"],
    a_outs: [receiverAmt.toString(), changeAmt.toString(), feeAmt.toString()],
    r_outs: [rR, rC, rRel],
    // receivers are USER COMMITMENTS (receiver, sender/change, relayer)
    receivers: [receiver.zkPublicKey, sender.zk.publicKey, relayer.zkPublicKey]
  }
  // Sui's transfer circuit takes Poseidon hashes of the public arrays as the actual
  // public inputs (to shrink on-chain verification cost), so it needs 5 extra signals
  // the other chains' circuits don't have. The Move contract recomputes the same
  // hashes on-chain. Hash4(a,b,c,d)=H(H(a,b),H(c,d)); Hash3(a,b,c)=H(H(a,b),c).
  if (networkId === "sui") {
    const h2 = (a:any,b:any) => poseidon.F.toObject(poseidon([BigInt(a), BigInt(b)]))
    const h3 = (a:any,b:any,c:any) => h2(h2(a,b), c)
    const h4 = (a:any,b:any,c:any,d:any) => h2(h2(a,b), h2(c,d))
    ci.enabled_hash        = h4(enabled[0], enabled[1], enabled[2], enabled[3]).toString()
    ci.roots_hash          = h4(roots[0], roots[1], roots[2], roots[3]).toString()
    ci.nullifiers_hash     = h4(nullifiers[0], nullifiers[1], nullifiers[2], nullifiers[3]).toString()
    ci.output_enabled_hash = h3(ci.output_enabled[0], ci.output_enabled[1], ci.output_enabled[2]).toString()
    ci.c_outs_hash         = h3(ci.c_outs[0], ci.c_outs[1], ci.c_outs[2]).toString()
  }
  console.log("ci:",ci);
  const prefix = ["monad", "sepolia", "base_sepolia"].includes(networkId) ? "" : `${networkId}/`
  const { proof: zkProof, publicSignals } = await (snarkjs as any).groth16.fullProve(
    ci, zkAssetUrl(`${prefix}transfer_proof.wasm`), zkAssetUrl(`${prefix}transfer_proof_final.zkey`)
  )
  const calldata = await (snarkjs as any).groth16.exportSolidityCallData(zkProof, publicSignals)
  const argv = calldata.replace(/["[\]\s]/g,"").split(",")
  return {
    transferCall: {
      a: [argv[0],argv[1]], b: [[argv[2],argv[3]],[argv[4],argv[5]]], c: [argv[6],argv[7]],
      inputs: { enabled, roots: rootsBytes32, poolIds, nullifiers: nullifiersBytes32 },
      C1: rE ? rCom.bytes32 : ZERO_HASH, C2: cE ? cCom.bytes32 : ZERO_HASH, C3: fE && fCom ? fCom.bytes32 : ZERO_HASH,
      c1Decimal: rE ? rCom.decimal : "0",
      c2Decimal: cE ? cCom.decimal : "0",
      c3Decimal: fE && fCom ? fCom.decimal : "0",
      encryptedNote1: n1, encryptedNote2: n2, encryptedNote3: n3
    }, zkProof, publicSignals
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

function MaskGlyph() {
  return (
    <svg width="18" height="12" viewBox="0 0 20 14" fill="none" className="shrink-0 mt-0.5">
      <path d="M2 6 Q4 2 7 2 Q9 2 10 4 Q11 2 13 2 Q16 2 18 6 Q17 11 13 11 Q11 11 10 9 Q9 11 7 11 Q3 11 2 6 Z" fill="rgba(201,176,255,0.85)"/>
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
        color: "rgba(244,238,255,0.5)",
        animation: "flavorFadeIn 0.6s ease",
      }}
    >
      <style>{`@keyframes flavorFadeIn { from { opacity:0; transform: translateY(4px); } to { opacity:1; transform: translateY(0); } }`}</style>
      "{lines[idx]}"
    </p>
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
  const decs = DECIMALS[networkId] || 18
  const perCallLabel = formatAmount(feePerCall(false, networkId), decs)
  const perCallRetryLabel = formatAmount(feePerCall(true, networkId), decs)
  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor:"rgba(244,238,255,0.1)", background:"rgba(255,255,255,0.04)" }}>
      <div className="flex justify-between px-4 py-2.5">
        <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color:"rgba(244,238,255,0.55)" }}>Send</span>
        <span className="font-mono text-[11px]" style={{ color:"rgba(244,238,255,0.88)" }}>{formatAmount(parsedAmt, decs)} {nativeCurrency}</span>
      </div>
      <div className="h-px" style={{ background:"rgba(244,238,255,0.08)" }}/>
      <div className="flex justify-between items-start px-4 py-2.5">
        <div>
          <span className="block text-[10px] tracking-[0.2em] uppercase" style={{ color:"rgba(244,238,255,0.55)" }}>Txn fee</span>
          <span className="block text-[9px] mt-0.5" style={{ color:"rgba(244,238,255,0.4)" }}>
            {networkId === "monad" ? (
              "Free for private transfer"
            ) : (
              <>
                {numCalls} call{numCalls>1?"s":""} × {isRetry ? perCallRetryLabel : perCallLabel} {nativeCurrency}
                {isRetry && <span style={{ color:"rgba(245,158,11,0.7)" }}> (retry)</span>}
              </>
            )}
          </span>
        </div>
        {networkId === "monad" ? (
          <span className="font-mono text-[11px] font-semibold" style={{ color: "#4cc78e" }}>Free</span>
        ) : (
          <span className="font-mono text-[11px]" style={{ color:"rgba(244,238,255,0.5)" }}>− {formatAmount(totalFee, decs)} {nativeCurrency}</span>
        )}
      </div>
      <div className="h-px" style={{ background:"rgba(244,238,255,0.08)" }}/>
      <div className="flex justify-between px-4 py-2.5">
        <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color:"rgba(244,238,255,0.55)" }}>Total deducted</span>
        <span className="font-mono text-[11px]" style={{ color: insufficient?"#f87171":"rgba(244,238,255,0.88)" }}>{formatAmount(totalNeeded, decs)} {nativeCurrency}</span>
      </div>
      {!insufficient && (<>
        <div className="h-px" style={{ background:"rgba(244,238,255,0.08)" }}/>
        <div className="flex justify-between px-4 py-2.5">
          <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color:"#C9B0FF" }}>Receiver gets</span>
          <span className="font-mono text-[11px] font-semibold" style={{ color:"#C9B0FF" }}>{formatAmount(parsedAmt, decs)} {nativeCurrency}</span>
        </div>
      </>)}
      {insufficient && (
        <div className="px-4 py-3" style={{ background:"rgba(248,113,113,0.06)" }}>
          <p className="text-[10px] font-semibold text-red-400 mb-0.5">Insufficient balance</p>
          <p className="text-[10px] leading-relaxed" style={{ color:"rgba(244,238,255,0.5)" }}>
            Fee is {formatAmount(totalFee, decs)} {nativeCurrency} for {numCalls} call{numCalls>1?"s":""}. Reduce amount or deposit more.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
interface Props { open: boolean; onClose: () => void }

export default function NoidSendModal({ open, onClose }: Props) {
  const { wallet, activeNetwork, networkConfig }           = useWallet()
  const { allUnspentUTXOs, getMerkleProof, forceSync }     = usePool()
  const decs = DECIMALS[activeNetwork] || 18

  const [recipientAddr, setRecipientAddr] = useState("")
  const [resolving,     setResolving]     = useState(false)
  const [recipientInfo, setRecipientInfo] = useState<{ registered: boolean; userCommitment: string | null; ecPublicKey: string | null } | null>(null)
  const [resolveError,  setResolveError]  = useState<string | null>(null)
  // bumped by "Try again" — re-runs the resolve without touching the address
  const [resolveNonce,  setResolveNonce]  = useState(0)
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
    setPhase("form"); setAmountEth(""); setRecipientAddr("")
    setRecipientInfo(null); setResolveError(null); setResolving(false); setResolveNonce(0)
    setIsRetry(false); setTxHash(null); setErrorMsg(null)
    setIsRelayerFeeError(false); setProvenCount(0); setTotalProofs(0); setStatusMsg("")
  }

  const parsedAmt = useMemo(() => {
    try {
      return parseAmount(amountEth || "0", decs)
    } catch { return ZERO_BIG }
  }, [amountEth, decs])

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

  // ── Resolve the receiver's REAL address on-chain (debounced) ──────────────
  // Fetches the receiver's user commitment + encryption key; shows whether the
  // address is registered for private mode.
  useEffect(() => {
    const addr = recipientAddr.trim()
    setResolveError(null)
    if (!addr) { setRecipientInfo(null); setResolving(false); return }
    let cancelled = false
    setResolving(true)
    const id = setTimeout(async () => {
      try {
        const info = await resolveRecipient(activeNetwork, addr)
        if (cancelled) return
        setRecipientInfo({
          registered: info.registered,
          userCommitment: info.userCommitment,
          ecPublicKey: info.encryptionPublicKey
        })
      } catch (e: any) {
        if (cancelled) return
        /* Deliberately NOT treated as "unregistered": that would drop the send
           to a public withdraw on what may be a perfectly registered address.
           Unknown means unknown, and the send stays blocked. */
        setRecipientInfo(null)
        setResolveError(e?.message || "Couldn't check this address")
      } finally {
        if (!cancelled) setResolving(false)
      }
    }, 450)
    return () => { cancelled = true; clearTimeout(id) }
  }, [recipientAddr, activeNetwork, resolveNonce])

  const resolvedRecipient: ParsedRecipient|null = useMemo(() => {
    if (recipientInfo?.registered && recipientInfo.userCommitment && recipientInfo.ecPublicKey) {
      return { ecPublicKey: recipientInfo.ecPublicKey, zkPublicKey: recipientInfo.userCommitment }
    }
    return null
  }, [recipientInfo])

  // ── Unregistered-recipient fallback ───────────────────────────────────────
  // If the recipient hasn't registered for private mode we can't send a private
  // note, so we withdraw (unmask) the amount straight to their real wallet at the
  // withdraw fee — all still inside this modal.
  const isUnregistered = !!(recipientAddr.trim() && !resolving && recipientInfo && !recipientInfo.registered)
  const withdrawFeeWei = parseAmount(getWithdrawFeeMon(activeNetwork), decs)

  const realFromAddress = useMemo(() => {
    if (activeNetwork === "solana") return wallet?.solanaAccount?.address ?? ""
    if (activeNetwork === "sui") return wallet?.suiAccount?.address ?? ""
    if (activeNetwork === "aptos") return wallet?.aptosAccount?.address ?? ""
    return wallet?.normalAccount?.address ?? ""
  }, [wallet, activeNetwork])
  const realPrivateKey = useMemo(() => {
    if (activeNetwork === "solana") return wallet?.solanaAccount?.privateKey ?? ""
    if (activeNetwork === "sui") return wallet?.suiAccount?.privateKey ?? ""
    if (activeNetwork === "aptos") return wallet?.aptosAccount?.privateKey ?? ""
    return wallet?.normalAccount?.privateKey ?? ""
  }, [wallet, activeNetwork])
  const noidAcct = useMemo(() => {
    if (activeNetwork === "solana") return wallet?.solanaNoidAccount
    if (activeNetwork === "sui") return wallet?.suiNoidAccount
    if (activeNetwork === "aptos") return wallet?.aptosNoidAccount
    return wallet?.noidAccount
  }, [wallet, activeNetwork])

  const totalNeeded = feeResult ? parsedAmt + feeResult.totalFee : parsedAmt
  const canSubmit   = parsedAmt > ZERO_BIG && (
    isUnregistered
      ? totalAvailable >= parsedAmt + withdrawFeeWei
      : !!(resolvedRecipient && feeResult && totalAvailable >= totalNeeded)
  )

  const runTransfer = useCallback(async (retry: boolean) => {
    if (!wallet?.noidAccount) return
    setErrorMsg(null); setTxHash(null); setProvenCount(0); setTotalProofs(0); setIsRelayerFeeError(false)
    const recipient = resolvedRecipient; if (!recipient) return
    try {
      setPhase("relayer"); setStatusMsg("Hailing the relayer…")
      const relRes = await fetch(`${BASE_URL}/relayer/get?network=${activeNetwork}`)
      if (!relRes.ok) throw new Error("Could not fetch relayer info")
      const relayer = await relRes.json()
      setPhase("building"); setStatusMsg("Selecting inputs and building plan…")
      const plan = planTransfer(allUnspentUTXOs, parsedAmt, retry, activeNetwork)
      const decs = DECIMALS[activeNetwork] || 18
      if (!plan) throw new Error(`Insufficient balance. Have ${formatAmount(totalAvailable, decs)} ${networkConfig.nativeCurrency}.`)
      const { plans } = plan; setTotalProofs(plans.length)
      const noid = (() => {
        if (activeNetwork === "solana") return wallet.solanaNoidAccount
        if (activeNetwork === "sui") return wallet.suiNoidAccount
        if (activeNetwork === "aptos") return wallet.aptosNoidAccount
        return wallet.noidAccount
      })()
      if (!noid) throw new Error("ZK account not derived for active network")
      const sender = {
        zk: { secretKey: noid.zkSecretKey, publicKey: noid.zkPublicKey },
        privateWallet: { publicKey: noid.publicKey },
        ownerAddressField: addressToFieldElement(noid.address, activeNetwork),
      }
      setPhase("proving"); setStatusMsg(`Forging ZK proof${plans.length>1?"s":""}…`)

      if (["solana", "sui", "aptos"].includes(activeNetwork)) {
        let lastHash = ""
        for (let i = 0; i < plans.length; i++) {
          const p = plans[i]; setStatusMsg(`Generating ZK proof ${i+1} of ${plans.length}…`)
          const { transferCall, zkProof, publicSignals } = await buildTransferCall(
            p.inputs, p.receiverAmt, p.changeAmt, p.feeAmt, recipient, sender, relayer, getMerkleProof, activeNetwork
          )

          const outputEnabled = [p.receiverAmt > ZERO_BIG ? 1 : 0, p.changeAmt > ZERO_BIG ? 1 : 0, p.feeAmt > ZERO_BIG ? 1 : 0]
          const commitments = [transferCall.c1Decimal, transferCall.c2Decimal, transferCall.c3Decimal]
          const encNotes = [transferCall.encryptedNote1, transferCall.encryptedNote2, transferCall.encryptedNote3]

          const decRoots: string[] = []
          const decNullifiers: string[] = []
          const poseidon = await getPoseidon()
          
          for (const utxo of p.inputs) {
            const mp = getMerkleProof(utxo.poolId, utxo.leafIndex) as any
            decRoots.push(mp.root.toString())
            const nullifier = poseidon.F.toString(
              poseidon([2n, BigInt(utxo.commitment), BigInt(utxo.randomness), BigInt(sender.zk.secretKey)])
            )
            decNullifiers.push(nullifier)
          }
          while (decRoots.length < MAX_INPUTS) {
            decRoots.push("0")
            decNullifiers.push("0")
          }

          let res: Response
          if (activeNetwork === "solana") {
            const { formatProofForSolana } = await import("../../services/solanaTx")
            const solanaProof = formatProofForSolana(zkProof)
            const body = {
              proof: {
                pi_a: zkProof.pi_a,
                pi_b: zkProof.pi_b,
                pi_c: zkProof.pi_c,
                protocol: zkProof.protocol,
                curve: zkProof.curve,
                proofA: solanaProof.proofA,
                proofB: solanaProof.proofB,
                proofC: solanaProof.proofC,
              },
              publicSignals,
              enabled: transferCall.inputs.enabled,
              roots: decRoots,
              nullifiers: decNullifiers,
              outputEnabled,
              commitments,
              encNotes,
            }
            res = await fetch(`${BASE_URL}/solana/transfer`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body)
            })
          } else if (activeNetwork === "sui") {
            const { proofToBytes } = await import("../../services/suiTx")
            const proofBytes = proofToBytes(zkProof)
            const body = {
              proof: zkProof,
              publicSignals,
              proofBytes: Array.from(proofBytes),
              enabled: transferCall.inputs.enabled,
              poolIds: transferCall.inputs.poolIds,
              roots: decRoots,
              nullifiers: decNullifiers,
              outputEnabled,
              commitments,
              encNotes,
            }
            res = await fetch(`${BASE_URL}/sui/transfer`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body)
            })
          } else { // aptos
            const { proofToBytes } = await import("../../services/aptosTx")
            const aptosProof = proofToBytes(zkProof)
            const body = {
              proof: zkProof,
              publicSignals,
              aBytes: Array.from(aptosProof.aBytes),
              bBytes: Array.from(aptosProof.bBytes),
              cBytes: Array.from(aptosProof.cBytes),
              enabled: transferCall.inputs.enabled,
              poolIds: transferCall.inputs.poolIds,
              roots: decRoots,
              nullifiers: decNullifiers,
              outputEnabled,
              commitments,
              encNotes,
            }
            res = await fetch(`${BASE_URL}/aptos/transfer`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body)
            })
          }

          const data = await res.json()
          if (!res.ok || !data.success) {
            throw new Error(data.message || `${activeNetwork} transfer failed`)
          }
          lastHash = data.txHash
          setProvenCount(i+1)
        }

        setTxHash(lastHash); setPhase("success")
        saveNoidSendTx(noid.publicKey, {
          type: "noid_send",
          txHash: lastHash,
          senderNoidPublicKey: noid.publicKey,
          receiverNoidPublicKey: recipientAddr.trim(),
          amountMon: amountEth,
          totalRelayerFee: formatAmount(plan.totalFee, decs),
          timestamp: Date.now(),
        })
        forceSync()
        setTimeout(() => void forceSync(), 1500)
        return
      }

      const transferCalls: any[] = [], zkProofs: any[] = []
      for (let i = 0; i < plans.length; i++) {
        const p = plans[i]; setStatusMsg(`Generating ZK proof ${i+1} of ${plans.length}…`)
        const { transferCall, zkProof } = await buildTransferCall(
          p.inputs, p.receiverAmt, p.changeAmt, p.feeAmt, recipient, sender, relayer, getMerkleProof, activeNetwork
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
      saveNoidSendTx(noid.publicKey, {
        type: "noid_send",
        txHash: data.txHash,
        senderNoidPublicKey: noid.publicKey,
        receiverNoidPublicKey: recipientAddr.trim(),
        amountMon: amountEth,
        totalRelayerFee: formatAmount(plan.totalFee, decs),
        timestamp: Date.now(),
      })
      forceSync()
      setTimeout(() => void forceSync(), 1500)
    } catch (err: any) {
      console.error("[NoidSendModal]", err)
      setPhase("error"); setErrorMsg(err?.reason || err?.message || "Transfer failed")
      if (err.isRelayerFeeError) setIsRelayerFeeError(true)
    }
  }, [resolvedRecipient, parsedAmt, allUnspentUTXOs, getMerkleProof, forceSync, totalAvailable, wallet, activeNetwork, networkConfig])

  // Unregistered recipient → withdraw (unmask) straight to their real wallet.
  const runWithdrawFallback = useCallback(async () => {
    if (!noidAcct || !realPrivateKey || !realFromAddress) return
    setErrorMsg(null); setTxHash(null); setProvenCount(0); setTotalProofs(0); setIsRelayerFeeError(false)
    try {
      setPhase("relayer"); setStatusMsg("Hailing the relayer…")
      const relayerKeys = await fetchRelayerKeys(activeNetwork)
      setPhase("proving")
      const result = await executeUnmask({
        withdrawAmountMon: amountEth,
        toAddress: recipientAddr.trim(),
        ownerAddress: realFromAddress,
        normalPrivateKey: realPrivateKey,
        noidSecretKey: (noidAcct as any).zkSecretKey,
        noidPublicKey: noidAcct.publicKey,
        noidZkPublicKey: (noidAcct as any).zkPublicKey,
        relayerKeys, allUnspentUTXOs, getMerkleProof,
        networkId: activeNetwork,
        onBatchStart: (b: number, t: number) => { setTotalProofs(t); setStatusMsg(`Generating ZK proof ${b} of ${t}…`) },
        onProofStart: (b: number) => { setProvenCount(b); setStatusMsg(`Forging ZK proof ${b}…`) },
        onSendTx: (hash: string) => { setPhase("sending"); setStatusMsg(`Broadcasting to ${networkConfig.label}…`); setTxHash(hash) },
      })
      setTxHash(result.hash); setPhase("success")
      saveUnmaskTx(noidAcct.publicKey, {
        type: "unmask", txHash: result.hash, toAddress: recipientAddr.trim(),
        noidPublicKey: noidAcct.publicKey, amountMon: amountEth,
        relayerFeeMon: getWithdrawFeeMon(activeNetwork), timestamp: Date.now(),
      })
      forceSync(); setTimeout(() => void forceSync(), 1500)
    } catch (err: any) {
      console.error("[NoidSend→Withdraw]", err)
      setPhase("error"); setErrorMsg(err?.shortMessage || err?.message || "Withdraw failed")
    }
  }, [noidAcct, realPrivateKey, realFromAddress, amountEth, recipientAddr, activeNetwork, allUnspentUTXOs, getMerkleProof, forceSync, networkConfig])

  const handleSend  = useCallback(() => {
    if (isUnregistered) void runWithdrawFallback()
    else runTransfer(isRetry)
  }, [isUnregistered, runWithdrawFallback, runTransfer, isRetry])
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
      accent="rgba(159,125,249,0.28)"
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
          <p className="text-[9px] tracking-[0.45em] uppercase mb-1" style={{ color:"#C9B0FF" }}>
            {isSuccess ? "Veil Drawn" : phase==="error" ? "Storm Rolled In" : "Shadow Transfer"}
          </p>
          <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]" style={{ color:"rgba(251,241,217,0.92)" }}>
            {isSuccess ? "Treasure sent. ⚓" : phase==="error" ? "Transfer failed." : isInFlight ? "Sailing the Veil…" : `Send Private ${networkConfig.nativeCurrency}`}
          </h3>
          <p className="mt-1 text-[11px]" style={{ color:"rgba(251,241,217,0.5)", transition:"opacity 400ms" }}>
            {isSuccess
              ? `Your ${networkConfig.nativeCurrency} crossed into the shadow.`
              : `${allUnspentUTXOs.length} note${allUnspentUTXOs.length!==1?"s":""} · ${formatAmount(totalAvailable, decs)} ${networkConfig.nativeCurrency}`}
          </p>
        </div>

        {/* ── Crossfading image (always mounted, opacity switches) ── */}
        <div className="shrink-0 px-6 pt-1">
          <div className="flex justify-center py-1">
            <AnimatedLogo
              className="h-[116px] w-[116px]"
              trackPointer={false}
              expression={isSuccess ? "wink" : isInFlight ? "waiting" : (recipientAddr.trim() ? "awake" : "sleeping")}
            />
          </div>
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
          {isInFlight && <CloudVoyage tone="dark" rain />}
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
            <p className="text-[11px] tracking-[0.2em] uppercase" style={{ color:"#C9B0FF" }}>{statusMsg}</p>
            {phase==="proving" && totalProofs > 1 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl border"
                style={{ background:"rgba(251,241,217,0.03)", borderColor:"rgba(251,241,217,0.08)" }}>
                <span className="font-mono text-[11px] font-bold" style={{ color:"#C9B0FF" }}>{provenCount}/{totalProofs}</span>
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
                {`Retry mode active — fee increased to ${formatAmount(feePerCall(true, activeNetwork), decs)} ${networkConfig.nativeCurrency}/call.`}
              </p>
            </div>
          )}

          {/* Recipient — a real wallet address; we resolve its private identity */}
          <div>
            <label className="block text-[9px] tracking-[0.3em] uppercase mb-3" style={{ color:"rgba(251,241,217,0.5)" }}>
              Recipient address
            </label>
            <textarea value={recipientAddr} onChange={e => setRecipientAddr(e.target.value)}
              placeholder={"0x… / Sui / Aptos / Solana address"} rows={2}
              className="w-full rounded-xl px-3 py-2.5 text-[10px] font-mono focus:outline-none resize-none"
              style={{ background:"rgba(251,241,217,0.05)",
                border:`1px solid ${
                  isUnregistered ? "rgba(245,196,81,0.55)" :
                  resolvedRecipient ? "rgba(201,176,255,0.5)" : "rgba(251,241,217,0.12)"}`,
                color:"rgba(251,241,217,0.85)" }}/>

            {resolving && (
              <p className="mt-1.5 text-[10px] flex items-center gap-1.5" style={{ color:"rgba(251,241,217,0.5)" }}>
                <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[#C9B0FF] border-t-transparent animate-spin" />
                Checking registration on-chain…
              </p>
            )}
            {resolveError && !resolving && (
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <p className="text-[10px] text-red-400">{resolveError}</p>
                <button
                  type="button"
                  onClick={() => setResolveNonce((n) => n + 1)}
                  className="text-[10px] px-2 py-0.5 rounded-lg transition-colors"
                  style={{ background:"rgba(201,176,255,0.14)", border:"1px solid rgba(201,176,255,0.3)", color:"rgba(244,238,255,0.9)" }}>
                  Try again
                </button>
              </div>
            )}
            {!resolving && recipientInfo && recipientInfo.registered && resolvedRecipient && (
              <p className="mt-1.5 text-[10px]" style={{ color:"#6EE7A8" }}>✓ Registered — private identity found</p>
            )}
            {!resolving && recipientInfo && recipientInfo.registered && !resolvedRecipient && (
              <p className="mt-1.5 text-[10px] text-red-400">
                Registered on-chain, but no encryption key on record — the recipient must register through this wallet app to receive private notes.
              </p>
            )}
            {isUnregistered && (
              <p className="mt-1.5 text-[10px] leading-relaxed" style={{ color:"#F5C451" }}>
                The amount will be received directly to their {CHAIN_BY_ID[activeNetwork]?.name ?? activeNetwork} wallet because they didn't register.
              </p>
            )}
            <p className="mt-2 text-[9px] leading-relaxed" style={{ color:"rgba(244,238,255,0.55)" }}>
              Enter the recipient's normal wallet address — Menoid finds their private identity on-chain.
            </p>
          </div>

          {/* Amount */}
          <div>
            <div className="flex items-end justify-between mb-1.5">
              <label className="text-[9px] tracking-[0.3em] uppercase" style={{ color:"rgba(251,241,217,0.5)" }}>Amount ({networkConfig.nativeCurrency})</label>
            </div>
            <input value={amountEth}
              onChange={e => { const v = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"); try { const en = parseAmount(v||"0", decs); setAmountEth(en>maxTransferable?formatAmount(maxTransferable, decs):v) } catch { setAmountEth(v) }}}
              placeholder="0.00"
              className="w-full rounded-xl px-4 py-3 text-[15px] font-mono focus:outline-none"
              style={{ background:"rgba(251,241,217,0.05)", border:"1px solid rgba(251,241,217,0.1)", color:"rgba(251,241,217,0.9)" }}/>
            {/* Max transferable hint */}
            {maxTransferable > 0n ? (
               <p className="mt-1 text-[9px]" style={{ color:"rgba(245,158,11,0.7)" }}>
                 Max transferable: {formatAmount(maxTransferable, decs)} {networkConfig.nativeCurrency}
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
                      Your notes can't cover the txn fee yet. Add{" "}
                      <span className="font-semibold">{formatAmount(minDeposit, decs)} {networkConfig.nativeCurrency}</span>
                      {" "}({numBatches} call{numBatches > 1 ? "s" : ""} × {formatAmount(feePerCall(isRetry, activeNetwork), decs)} {networkConfig.nativeCurrency}) to transfer your balance.
                    </p>
                  </div>
                )
              })()
            ) : null}
          </div>

          {isUnregistered ? (
            parsedAmt > ZERO_BIG && (
              <div className="rounded-xl overflow-hidden border" style={{ borderColor:"rgba(245,196,81,0.28)", background:"rgba(245,196,81,0.06)" }}>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color:"rgba(244,238,255,0.55)" }}>Withdraw fee</span>
                  <span className="font-mono text-[11px]" style={{ color:"rgba(244,238,255,0.88)" }}>{getWithdrawFeeMon(activeNetwork)} {networkConfig.nativeCurrency}</span>
                </div>
                <div className="h-px" style={{ background:"rgba(245,196,81,0.14)" }}/>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color:"#F5C451" }}>They receive</span>
                  <span className="font-mono text-[11px] font-semibold" style={{ color:"#F5C451" }}>{amountEth || "0"} {networkConfig.nativeCurrency}</span>
                </div>
              </div>
            )
          ) : (
            <FeeBreakdown parsedAmt={parsedAmt} feeResult={feeResult} totalAvailable={totalAvailable} isRetry={isRetry} networkId={activeNetwork} nativeCurrency={networkConfig.nativeCurrency}/>
          )}

          <div className="flex items-start gap-2.5 p-3 rounded-xl border"
            style={{ background:"rgba(159,125,249,0.08)", borderColor:"rgba(201,176,255,0.16)" }}>
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
              <p className="text-[10px] font-semibold" style={{ color:"rgba(245,158,11,0.9)" }}>Txn Fee Too Low</p>
              <p className="text-[10px] leading-relaxed" style={{ color:"rgba(251,241,217,0.55)" }}>Gas cost exceeded. Retry with +{formatAmount(getFeeRetryExtra(activeNetwork), decs)} {networkConfig.nativeCurrency} per call.</p>
              {retryFeeResult && (
                <div className="rounded-lg overflow-hidden border" style={{ borderColor:"rgba(251,241,217,0.08)" }}>
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-[9px] uppercase tracking-widest" style={{ color:"rgba(251,241,217,0.4)" }}>Retry fee</span>
                    <span className="font-mono text-[10px]" style={{ color:"rgba(245,158,11,0.85)" }}>
                      {retryFeeResult.numCalls} × {formatAmount(feePerCall(true, activeNetwork), decs)} = {formatAmount(retryFeeResult.totalFee, decs)} {networkConfig.nativeCurrency}
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
                background:"linear-gradient(145deg, rgba(201,176,255,0.16) 0%, rgba(159,125,249,0.12) 100%)",
                backdropFilter:"blur(20px) saturate(180%)", WebkitBackdropFilter:"blur(20px) saturate(180%)",
                border:"1px solid rgba(201,176,255,0.35)",
                boxShadow:"inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 8px rgba(159,125,249,0.14)",
                color:"rgba(251,241,217,0.88)",
              }}>
              Done
            </button>
            {txHash && (
              <div className="flex justify-center mt-3">
                <a href={explorerTxUrl(txHash, activeNetwork)} target="_blank" rel="noreferrer"
                  className="text-[10px] tracking-[0.2em] uppercase hover:opacity-60 transition-opacity"
                  style={{ color:"rgba(201,176,255,0.7)" }}>
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
            <CloudChip
              as="button"
              tone="light"
              onClick={handleSend}
              disabled={!canSubmit}
              className="w-full py-3.5 text-[12px] font-bold tracking-[0.2em] uppercase transition-transform active:scale-[0.98]"
              style={{ color: "#3B2570" }}>
              {phase === "error" ? "Try Again" : isUnregistered ? "Send to Wallet" : "Send Privately"}
            </CloudChip>
          </div>
        )}

      </div>
    </LiquidSheet>
  )
}
