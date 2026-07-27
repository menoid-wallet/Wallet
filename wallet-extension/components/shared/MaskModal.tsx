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
import AnimatedLogo from "../brand/AnimatedLogo"
import CloudChip from "../brand/CloudChip"
import CloudVoyage from "./CloudVoyage"

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
  return networkId === "monad" ? "0.001" : "0.0001"
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
      style={{ color: "rgba(244,238,255,0.5)" }}>
      "{lines[idx]}"
    </p>
  )
}

// ─── Row helper ───────────────────────────────────────────────────────────────
function Row({ label, value, accent, isNoid }: { label:string; value:string; accent?:boolean; isNoid?:boolean }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className={`text-[10px] tracking-[0.3em] uppercase ${isNoid ? "text-bone/55" : "text-ink/50"}`}>{label}</span>
      <span className={`font-mono text-[12px] ${accent ? isNoid ? "text-[#C9B0FF] font-semibold" : "text-violetDeep font-semibold" : isNoid ? "text-white/85" : "text-ink/80"}`}>{value}</span>
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
      accent="rgba(159,125,249,0.28)"
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
          <p className="text-[9px] tracking-[0.45em] uppercase text-[#C9B0FF] mb-1">{eyebrow}</p>
          <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]">{title}</h3>
          <p className={`mt-1 text-[11px] leading-snug ${t.isNoid ? "text-bone/65" : "text-ink/55"}`}>{subtitle}</p>
        </div>

        {/* ── Phase image (slides left→right between phases) ── */}
        <div className="shrink-0 px-6 pt-1">
          <div className="flex justify-center py-1">
            <AnimatedLogo
              className="h-[116px] w-[116px]"
              trackPointer={false}
              expression={isSuccess ? "wink" : isInFlight ? "waiting" : (amount.trim() ? "awake" : "sleeping")}
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
        <div className="shrink-0 px-6"
          style={{
            opacity: isInFlight ? 1 : 0,
            maxHeight: isInFlight ? 130 : 0,
            overflow: "hidden",
            transition: "opacity 500ms ease, max-height 600ms cubic-bezier(0.22,1,0.36,1)",
            pointerEvents: isInFlight ? "auto" : "none",
          }}>
          <div className="flex flex-col items-center gap-2 text-center">
            <p className={`text-[11px] tracking-[0.2em] uppercase text-[#C9B0FF]`}>{statusMsg}</p>
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
                background: "linear-gradient(145deg, rgba(201,176,255,0.16) 0%, rgba(159,125,249,0.12) 100%)",
                backdropFilter: "blur(20px) saturate(180%)",
                WebkitBackdropFilter: "blur(20px) saturate(180%)",
                border: "1px solid rgba(201,176,255,0.35)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 8px rgba(159,125,249,0.14)",
                color: "rgba(244,238,255,0.92)",
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
            </div>
            <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
              placeholder="0.00" inputMode="decimal"
              className={`w-full rounded-xl border px-3 py-2.5 text-[14px] font-mono focus:outline-none transition-colors
                ${t.isNoid ? "bg-bone/[0.06] placeholder-bone/30 text-bone" : "bg-ink/[0.05] placeholder-ink/30 text-ink"}
                ${errors.amount ? "border-red-500/40 focus:border-red-500/60" : t.isNoid ? "border-white/15 focus:border-[#C9B0FF]/70" : "border-ink/12 focus:border-violetDeep/60"}`}
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
                ${errors.fee ? "border-red-500/40 focus:border-red-500/60" : t.isNoid ? "border-white/15 focus:border-[#C9B0FF]/70" : "border-ink/12 focus:border-violetDeep/60"}`}
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
            <CloudChip
              as="button"
              tone="light"
              onClick={handleMask}
              disabled={!canSubmit}
              className="w-full py-3.5 text-[12px] font-bold tracking-[0.2em] uppercase transition-transform active:scale-[0.98]"
              style={{ color: "#3B2570" }}>
              {phase === "error" ? "Try Again" : "Hide in the Noid"}
            </CloudChip>
          </div>
        )}

      </div>
    </LiquidSheet>
  )
}