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
import { explorerTxUrl } from "~lib/rpc"
import { usePool } from "~context/PoolContext"
import { fetchRelayerKeys } from "~services/api"
import { executeUnmask, getWithdrawFeeMon, getWithdrawFeeWei } from "~services/unmask"
import { saveUnmaskTx } from "../../lib/txStore"
import LiquidSheet from "./LiquidSheet"
import AnimatedLogo from "../brand/AnimatedLogo"
import CloudChip from "../brand/CloudChip"
import CloudVoyage from "./CloudVoyage"

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

// The fee shown here IS the fee charged: both come from services/unmask.
const getRelayerFeeMon = getWithdrawFeeMon
const getRelayerFee = getWithdrawFeeWei

const ZERO_BIG = BigInt(0)

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
      style={{ color: "rgba(244,238,255,0.5)" }}>
      "{lines[idx]}"
    </p>
  )
}

// ─── Main UnMaskModal ─────────────────────────────────────────────────────────
export default function UnMaskModal({ open, onClose }: Props) {
  const { wallet, activeNetwork, networkConfig }  = useWallet()
  const { allUnspentUTXOs, getMerkleProof, forceSync } = usePool()

  const RELAYER_FEE = getRelayerFee(activeNetwork)
  const decs = DECIMALS[activeNetwork] || 18

  const fromAddress = useMemo(() => {
    if (activeNetwork === "solana") return wallet?.solanaAccount?.address ?? ""
    if (activeNetwork === "sui") return wallet?.suiAccount?.address ?? ""
    if (activeNetwork === "aptos") return wallet?.aptosAccount?.address ?? ""
    return wallet?.normalAccount?.address ?? ""
  }, [wallet, activeNetwork])

  const privateKey = useMemo(() => {
    if (activeNetwork === "solana") return wallet?.solanaAccount?.privateKey ?? ""
    if (activeNetwork === "sui") return wallet?.suiAccount?.privateKey ?? ""
    if (activeNetwork === "aptos") return wallet?.aptosAccount?.privateKey ?? ""
    return wallet?.normalAccount?.privateKey ?? ""
  }, [wallet, activeNetwork])

  const noidAccount = useMemo(() => {
    if (activeNetwork === "solana") return wallet?.solanaNoidAccount
    if (activeNetwork === "sui") return wallet?.suiNoidAccount
    if (activeNetwork === "aptos") return wallet?.aptosNoidAccount
    return wallet?.noidAccount
  }, [wallet, activeNetwork])

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
    try {
      const decs = DECIMALS[activeNetwork] || 18
      return parseAmount(amountEth || "0", decs)
    } catch { return ZERO_BIG }
  }, [amountEth, activeNetwork])

  const totalAvailable = useMemo(
    () => allUnspentUTXOs.reduce((s, u) => s + BigInt(u.amount), ZERO_BIG),
    [allUnspentUTXOs]
  )

  const maxWithdrawable = useMemo(
    () => totalAvailable > RELAYER_FEE ? totalAvailable - RELAYER_FEE : ZERO_BIG,
    [totalAvailable, RELAYER_FEE]
  )

  const insufficient  = parsedAmt > ZERO_BIG && (parsedAmt + RELAYER_FEE) > totalAvailable
  const totalDeducted = parsedAmt > ZERO_BIG ? parsedAmt + RELAYER_FEE : ZERO_BIG
  const canSubmit     = parsedAmt > ZERO_BIG && !!privateKey && !!noidAccount && !insufficient

  const handleUnmask = useCallback(async () => {
    if (!canSubmit || !noidAccount || !privateKey || !fromAddress) return
    setErrorMsg(null); setTxHash(null); setProvenCount(0); setTotalProofs(0)
    try {
      setPhase("relayer"); setStatusMsg("Hailing the relayer…")
      const relayerKeys = await fetchRelayerKeys(activeNetwork)
      setPhase("building"); setStatusMsg("Selecting inputs and building plan…")
      setPhase("proving")
      const result = await executeUnmask({
        withdrawAmountMon: amountEth, toAddress: fromAddress,
        ownerAddress: fromAddress,
        normalPrivateKey: privateKey,
        noidSecretKey: noidAccount.zkSecretKey,
        noidPublicKey: noidAccount.publicKey,
        noidZkPublicKey: noidAccount.zkPublicKey,
        relayerKeys, allUnspentUTXOs, getMerkleProof,
        networkId: activeNetwork,
        onBatchStart: (batchNum, total) => {
          setTotalProofs(total)
          setStatusMsg(`Generating ZK proof ${batchNum} of ${total}…`)
        },
        onProofStart: (batchNum) => {
          setProvenCount(batchNum)
          setStatusMsg(totalProofs === 1 ? "Forging ZK proof…" : `Generating ZK proof ${batchNum} of ${totalProofs}…`)
        },
        onSendTx: (hash) => {
          setPhase("sending"); setStatusMsg(`Broadcasting to ${networkConfig.label}…`); setTxHash(hash)
        }
      })
      setTxHash(result.hash); setPhase("success")
      saveUnmaskTx(noidAccount.publicKey, {
        type: "unmask",
        txHash: result.hash,
        toAddress: fromAddress,
        noidPublicKey: noidAccount.publicKey,
        amountMon: amountEth,
        relayerFeeMon: getRelayerFeeMon(activeNetwork),
        timestamp: Date.now(),
      })
      forceSync()
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
      accent="rgba(159,125,249,0.28)"
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
          <p className="text-[9px] tracking-[0.45em] uppercase mb-1" style={{ color: "#C9B0FF" }}>
            {isSuccess ? "Veil Lifted" : phase==="error" ? "Storm Rolled In" : "Emerge from shadow"}
          </p>
          <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]"
            style={{ color: "rgba(251,241,217,0.92)" }}>
            {isSuccess ? "Treasure reclaimed. ⚓" : phase==="error" ? "Unhide failed." : `Unhide ${networkConfig.nativeCurrency}`}
          </h3>
          <p className="mt-1 text-[11px] leading-snug" style={{ color: "rgba(251,241,217,0.5)" }}>
            {isSuccess
              ? `Your ${networkConfig.nativeCurrency} has returned to the open.`
              : `${allUnspentUTXOs.length} note${allUnspentUTXOs.length!==1?"s":""} · ${formatAmount(totalAvailable, decs)} ${networkConfig.nativeCurrency} private`}
          </p>
        </div>

        {/* ── Phase image (slides left→right between phases) ── */}
        <div className="shrink-0 px-6 pt-1">
          <div className="flex justify-center py-1">
            <AnimatedLogo
              className="h-[116px] w-[116px]"
              trackPointer={false}
              expression={isSuccess ? "wink" : isInFlight ? "waiting" : (amountEth.trim() ? "awake" : "sleeping")}
            />
          </div>
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
          {isInFlight && <CloudVoyage tone="dark" rain />}
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
            <p className="text-[11px] tracking-[0.2em] uppercase" style={{ color: "#C9B0FF" }}>{statusMsg}</p>
            {phase==="proving" && (
              <p className="text-[10px] max-w-[260px] leading-snug" style={{ color: "rgba(251,241,217,0.45)" }}>
                ZK proof runs in your browser. Keep this window open.
              </p>
            )}
            {phase==="proving" && totalProofs > 1 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl border"
                style={{ background:"rgba(251,241,217,0.03)", borderColor:"rgba(251,241,217,0.08)" }}>
                <span className="font-mono text-[11px] font-bold" style={{ color:"#C9B0FF" }}>{provenCount}/{totalProofs}</span>
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
                    {formatAmount(parsedAmt, decs)} {networkConfig.nativeCurrency} → <span className="font-mono">{fromAddress.slice(0,8)}…{fromAddress.slice(-6)}</span>
                  </p>
                  {txHash && <p className="font-mono text-[9px] mt-1 break-all" style={{ color:"rgba(251,241,217,0.4)" }}>{txHash}</p>}
                </div>
              </div>
            )}
            {/* Done button — same liquid glass as MaskModal */}
            <button onClick={onClose}
              className="w-full rounded-xl py-3 text-[11px] tracking-[0.25em] uppercase hover:-translate-y-[1px] transition-all"
              style={{
                background: "linear-gradient(145deg, rgba(201,176,255,0.16) 0%, rgba(159,125,249,0.12) 100%)",
                backdropFilter: "blur(20px) saturate(180%)",
                WebkitBackdropFilter: "blur(20px) saturate(180%)",
                border: "1px solid rgba(201,176,255,0.35)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 8px rgba(159,125,249,0.14)",
                color: "rgba(244,238,255,0.92)",
              }}>
              Done
            </button>
            {/* View on explorer — small text link */}
            {txHash && (
              <div className="flex justify-center mt-2">
                <a href={explorerTxUrl(txHash, activeNetwork)}
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
              style={{ background:"rgba(159,125,249,0.18)", border:"1px solid rgba(201,176,255,0.3)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C9B0FF" strokeWidth="1.5">
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
                Amount ({networkConfig.nativeCurrency})
              </label>
            </div>
            <input value={amountEth}
              onChange={e => {
                const v = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1")
                try {
                  const decs = DECIMALS[activeNetwork] || 18
                  const entered = parseAmount(v || "0", decs)
                  setAmountEth(entered > maxWithdrawable ? formatAmount(maxWithdrawable, decs) : v)
                } catch { setAmountEth(v) }
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
              <p className="mt-1 text-[9px]" style={{ color:"rgba(244,238,255,0.55)" }}>
                Max: {formatAmount(maxWithdrawable, DECIMALS[activeNetwork] || 18)} {networkConfig.nativeCurrency}
                <span className="ml-1" style={{ color:"rgba(251,241,217,0.2)" }}>
                  (after {getRelayerFeeMon(activeNetwork)} {networkConfig.nativeCurrency} fee)
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
                {parsedAmt > ZERO_BIG ? `${formatAmount(parsedAmt, DECIMALS[activeNetwork] || 18)} ${networkConfig.nativeCurrency}` : "—"}
              </span>
            </div>
            <div className="h-px" style={{ background:"rgba(251,241,217,0.06)" }}/>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color:"rgba(251,241,217,0.5)" }}>Relayer fee (flat)</span>
              <span className="font-mono text-[11px]" style={{ color:"rgba(251,241,217,0.4)" }}>
                − {getRelayerFeeMon(activeNetwork)} {networkConfig.nativeCurrency}
              </span>
            </div>
            <div className="h-px" style={{ background:"rgba(251,241,217,0.06)" }}/>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color:"rgba(251,241,217,0.5)" }}>Total deducted</span>
              <span className="font-mono text-[11px]"
                style={{ color: insufficient ? "#f87171" : "rgba(251,241,217,0.85)" }}>
                {parsedAmt > ZERO_BIG ? `${formatAmount(totalDeducted, DECIMALS[activeNetwork] || 18)} ${networkConfig.nativeCurrency}` : "—"}
              </span>
            </div>
            {parsedAmt > ZERO_BIG && !insufficient && (
              <>
                <div className="h-px" style={{ background:"rgba(251,241,217,0.06)" }}/>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color:"#C9B0FF" }}>You receive</span>
                  <span className="font-mono text-[11px] font-semibold" style={{ color:"#C9B0FF" }}>
                    {formatAmount(parsedAmt, DECIMALS[activeNetwork] || 18)} {networkConfig.nativeCurrency}
                  </span>
                </div>
              </>
            )}
            {insufficient && (
              <div className="px-4 py-3" style={{ background:"rgba(248,113,113,0.06)" }}>
                <p className="text-[10px] font-semibold text-red-400 mb-0.5">Insufficient balance</p>
                <p className="text-[10px] leading-relaxed" style={{ color:"rgba(251,241,217,0.45)" }}>
                  Need {formatAmount(parsedAmt + RELAYER_FEE, DECIMALS[activeNetwork] || 18)} {networkConfig.nativeCurrency} total. You have {formatAmount(totalAvailable, DECIMALS[activeNetwork] || 18)} {networkConfig.nativeCurrency}.
                </p>
              </div>
            )}
          </div>

          {/* Info note */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl border"
            style={{ background:"rgba(159,125,249,0.08)", borderColor:"rgba(201,176,255,0.16)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C9B0FF" strokeWidth="1.5" className="shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p className="text-[10px] leading-relaxed" style={{ color:"rgba(251,241,217,0.45)" }}>
              Funds return to your open address. A flat {getRelayerFeeMon(activeNetwork)} {networkConfig.nativeCurrency} fee covers the relayer.
              A ZK proof verifies ownership without exposing which notes you're spending.
            </p>
          </div>

          {/* Error block */}
          {phase==="error" && errorMsg && (
            <div className="p-3 rounded-xl border"
              style={{ background:"rgba(248,113,113,0.06)", borderColor:"rgba(248,113,113,0.25)" }}>
              <p className="text-[10px] font-semibold text-red-400 mb-0.5">Unhide Failed</p>
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

          <p className="text-center font-serif italic text-[11px]" style={{ color:"rgba(244,238,255,0.55)" }}>
            "Step out of the fog. The port awaits."
          </p>
          <div style={{ height: 8 }}/>
        </div>

        {/* ── Fixed footer slider ── */}
        {isFormOrError && (
          <div className="shrink-0 px-6 pt-3 pb-6"
            style={{ borderTop:"1px solid rgba(251,241,217,0.08)" }}>
            <CloudChip
              as="button"
              tone="light"
              onClick={handleUnmask}
              disabled={!canSubmit}
              className="w-full py-3.5 text-[12px] font-bold tracking-[0.2em] uppercase transition-transform active:scale-[0.98]"
              style={{ color: "#3B2570" }}>
              {phase === "error" ? "Try Again" : "Reveal to Open"}
            </CloudChip>
          </div>
        )}

      </div>
    </LiquidSheet>
  )
}