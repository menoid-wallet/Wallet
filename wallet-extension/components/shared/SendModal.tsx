/**
 * SendModal.tsx (Open mode only)
 *
 * Layout (form phase):
 *   ┌─────────────────────────────┐  ← fullscreen sheet, no drag
 *   │  drag bar (decorative only) │
 *   │  header                     │
 *   │  ┌─ scrollable area ──────┐ │
 *   │  │  ship_send.png         │ │
 *   │  │  Menoid contacts       │ │
 *   │  │  recipient input       │ │
 *   │  │  amount input          │ │
 *   │  │  from row              │ │
 *   │  │  error message         │ │
 *   │  └────────────────────────┘ │
 *   │  ─── fixed footer ───────── │
 *   │  ship slider                │
 *   │  voyage hint                │
 *   └─────────────────────────────┘
 *
 * Success phase: normal partial sheet, ship_reached.png, full Done button,
 *   small "View on explorer" text link below.
 *
 * Images are preloaded at module level — no loading state needed.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { isAddress, ethers } from "ethers"
import { explorerTxUrl, sendNative } from "../../lib/rpc"
import { useWallet } from "../../context/WalletContext"
import { useThemeTokens } from "../../lib/useThemeTokens"

function isValidAddressForChain(address: string, network: string): boolean {
  const clean = address.trim()
  if (!clean) return false
  if (network === "solana") {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean)
  }
  if (network === "sui" || network === "aptos") {
    return /^0x[0-9a-fA-F]{1,64}$/.test(clean)
  }
  return isAddress(clean)
}
import { saveOpenTx, updateOpenTx } from "../../lib/txStore"
import LiquidSheet from "./LiquidSheet"
import AnimatedLogo from "../brand/AnimatedLogo"
import CloudChip from "../brand/CloudChip"
import CloudVoyage from "./CloudVoyage"

interface Props {
  open: boolean
  onClose: () => void
  fromAddress: string
  privateKey: string
  balance: string
  onSent?: (hash: string) => void
}

type Phase       = "form" | "submitting" | "success" | "error"
type AmountStatus = "" | "ok" | "over" | "bad"
type AddrStatus   = "" | "ok" | "bad"

// ─── Main Modal ───────────────────────────────────────────────────────────────
export default function SendModal({ open, onClose, fromAddress, privateKey, balance, onSent }: Props) {
  const { activeNetwork } = useWallet()
  const tokens = useThemeTokens()

  const [phase,     setPhase]     = useState<Phase>("form")
  const [to,        setTo]        = useState("")
  const [amount,    setAmount]    = useState("")
  const [submitErr, setSubmitErr] = useState("")
  const [txHash,    setTxHash]    = useState("")

  // Reset form after LiquidSheet exit animation
  useEffect(() => {
    if (open) return
    const t = setTimeout(() => {
      setPhase("form"); setTo(""); setAmount("")
      setSubmitErr(""); setTxHash("")
    }, 320)
    return () => clearTimeout(t)
  }, [open])

  // Live validation
  const addrStatus: AddrStatus = useMemo(() => {
    const v = to.trim(); if (!v) return ""
    return isValidAddressForChain(v, activeNetwork) ? "ok" : "bad"
  }, [to, activeNetwork])

  const amountStatus: AmountStatus = useMemo(() => {
    const v = amount.trim(); if (!v) return ""
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return "bad"
    const bal = Number(balance)
    if (Number.isFinite(bal) && n > bal) return "over"
    return "ok"
  }, [amount, balance])

  const canSubmit = addrStatus === "ok" && amountStatus === "ok"

  async function handleSend() {
    if (!canSubmit) return
    setSubmitErr(""); setPhase("submitting")
    try {
      const r = await sendNative(privateKey, to.trim(), amount.trim(), activeNetwork)
      setTxHash(r.hash); setPhase("success")
      onSent?.(r.hash)
      
      const parsedAmount = (() => {
        let decimals = 18
        if (activeNetwork === "solana" || activeNetwork === "sui") decimals = 9
        else if (activeNetwork === "aptos") decimals = 8
        return ethers.parseUnits(amount.trim(), decimals)
      })()

      // Save immediately so the log updates right away
      saveOpenTx(fromAddress, {
        type: "open",
        txHash: r.hash,
        gasUsed: null,
        to: to.trim(),
        value: "0x" + parsedAmount.toString(16),
        functionName: "Transfer",
        timestamp: Date.now(),
      })
      // Update with gasUsed once receipt arrives
      r.wait().then(receipt => {
        if (!receipt) return
        updateOpenTx(fromAddress, r.hash, { gasUsed: receipt.gasUsed.toString() })
      }).catch(() => {})
    } catch (e: any) {
      console.error("[SendModal] send failed:", e)
      setSubmitErr(e?.shortMessage ?? e?.message ?? "Transaction failed. Try again.")
      setPhase("error")
    }
  }

  function setMax() {
    const num = Number(balance)
    if (!Number.isFinite(num) || num <= 0) { setAmount("0"); return }
    const max = Math.max(0, num - 0.001)
    setAmount(max.toFixed(6).replace(/\.?0+$/, ""))
  }

  const isSuccess    = phase === "success"
  const isSubmitting = phase === "submitting"

  return (
    <LiquidSheet
      open={open}
      onClose={onClose}
      tone="cream"                           // open mode → light lilac sheet
      disableDrag={isSubmitting}             // hides X + blocks backdrop during tx
      lockDrag={!isSuccess}                  // grab handle completely dead during form
      defaultFullscreen={phase === "form" || phase === "error"} // fullscreen for form; shrinks to a partial sheet for loading/success
    >
      {isSuccess ? (
        /* ════════════════════════ SUCCESS (partial sheet) ════════════════════ */
        <div className="relative">
          <div className="px-6 pt-2 pb-2 text-center">
            <p className="text-[9px] tracking-[0.45em] uppercase text-violetDeep/70 mb-1">Send Treasure</p>
            <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]">Delivered! ✦</h3>
            <p className="mt-1 text-[11px] leading-snug text-violetDeep/60">
              Your treasure reached the port.
            </p>
          </div>

          <div className="px-6 pt-2 pb-6 flex flex-col items-center">
            {/* the mark, winking at a job well done */}
            <AnimatedLogo className="h-[118px] w-[118px] mb-4" trackPointer={false} expression="wink" />

            {/* Tx card */}
            <div className="w-full rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-4 flex items-start gap-3 mb-5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 7L5.5 10.5L12 4" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-emerald-700">Transaction broadcast</p>
                <p className="font-mono text-[10px] mt-1 break-all text-violetDeep/60">
                  {txHash}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-full rounded-xl py-3 text-[11px] tracking-[0.25em] uppercase hover:-translate-y-[1px] transition"
              style={{ background: "#4E2F8E", color: "#F4EEFF" }}>
              Done
            </button>

            <a
              href={explorerTxUrl(txHash, activeNetwork)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 text-[10px] tracking-[0.2em] uppercase transition-opacity hover:opacity-60 text-violetDeep/50">
              View on explorer
            </a>
          </div>
        </div>

      ) : isSubmitting ? (
        /* ═══════════════════════ LOADING (compact partial sheet) ══════════════ */
        <div className="relative">
          <div className="px-6 pt-1 pb-1 text-center">
            <p className="text-[9px] tracking-[0.45em] uppercase text-violetDeep/70 mb-1">Send Treasure</p>
            <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]">Sending…</h3>
            <p className="mt-1 text-[11px] leading-snug text-violetDeep/60">Your treasure is on its way.</p>
          </div>
          <div className="flex flex-col items-center px-6 pt-2 pb-5 gap-5">
            {/* the mark waits and watches the voyage cloud drift below */}
            <AnimatedLogo className="h-[116px] w-[116px]" trackPointer={false} expression="waiting" />
            <div className="w-full max-w-[300px]">
              <CloudVoyage tone="light" label="Voyage in progress…" />
            </div>
          </div>
        </div>

      ) : (
        /* ══════════════════════════ FORM (fullscreen) ════════════════════════ */
        <div className="flex flex-col h-full">

          {/* Header — fixed, never scrolls */}
          <div className="shrink-0 px-6 pt-2 pb-2 text-center">
            <p className="text-[9px] tracking-[0.45em] uppercase text-violetDeep/70 mb-1">Send Treasure</p>
            <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]">
              {phase === "error" ? "Storm rolled in." : "Send MON"}
            </h3>
            <p className="mt-1 text-[11px] leading-snug text-violetDeep/60">
              Balance: {Number(balance).toFixed(4)} MON
            </p>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto no-scrollbar px-6 pt-2 pb-2 space-y-4">

            {/* the mark dozes (floating, snoring) until an address is typed,
                then wakes up and just blinks */}
            <div className="w-full flex justify-center py-1">
              <AnimatedLogo
                className="h-[104px] w-[104px]"
                trackPointer={false}
                expression={to.trim() ? "idle" : "sleeping"}
              />
            </div>

            {/* Recipient */}
            <div>
              <label className="block text-[9px] tracking-[0.3em] uppercase mb-1.5 text-violetDeep/55">
                Recipient address
              </label>
              <input
                value={to}
                onChange={(e) => { setTo(e.target.value) }}
                placeholder="0x…"
                className={`w-full rounded-xl border px-3 py-2.5 text-[12px] font-mono focus:outline-none transition-colors bg-violetDeep/6 placeholder-violetDeep/30 text-violetDeep
                  ${addrStatus === "bad"   ? "border-red-500/40 focus:border-red-500/60"
                  : addrStatus === "ok"    ? "border-emerald-500/30 focus:border-emerald-500/60"
                  :                          "border-violetDeep/12 focus:border-violetDeep/60"}`}
              />
              {addrStatus === "bad" && <p className="mt-1 text-[10px] text-red-600">Not a valid address.</p>}
            </div>

            {/* Amount */}
            <div>
              <div className="flex items-end justify-between mb-1.5">
                <label className="block text-[9px] tracking-[0.3em] uppercase text-violetDeep/55">
                  Amount (MON)
                </label>
                <button onClick={setMax}
                  className="text-[9px] tracking-[0.3em] uppercase text-violetDeep/80 hover:text-violetDeep transition-colors">
                  Max
                </button>
              </div>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                className={`w-full rounded-xl border px-3 py-2.5 text-[14px] font-mono focus:outline-none transition-colors bg-violetDeep/6 placeholder-violetDeep/30 text-violetDeep
                  ${amountStatus === "bad" || amountStatus === "over" ? "border-red-500/40 focus:border-red-500/60"
                  : amountStatus === "ok" ? "border-emerald-500/30 focus:border-emerald-500/60"
                  :                         "border-violetDeep/12 focus:border-violetDeep/60"}`}
              />
              {amountStatus === "bad" && <p className="mt-1 text-[10px] text-red-600">Enter a positive number.</p>}
              {amountStatus === "over" && (
                <p className="mt-1 text-[10px] text-red-600 flex items-center gap-1.5">
                  <span className="inline-block h-1 w-1 rounded-full bg-red-500" />
                  Exceeds balance ({Number(balance).toFixed(4)} MON available).
                </p>
              )}
            </div>

            {/* From row */}
            <div className={`flex items-center justify-between p-2.5 rounded-xl ${tokens.card}`}>
              <span className="text-[10px] tracking-[0.3em] uppercase text-violetDeep/55">From</span>
              <span className="font-mono text-[11px] text-violetDeep/75">
                {fromAddress.slice(0, 6)}…{fromAddress.slice(-4)}
              </span>
            </div>

            {submitErr && (
              <p className="text-[11px] text-red-600 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
                {submitErr}
              </p>
            )}

            <div style={{ height: 8 }} />
          </div>

          {/* ── Fixed footer: cloud confirm button ── */}
          <div className="shrink-0 px-6 pt-3 pb-6" style={{ borderTop: "1px solid rgba(78,47,142,0.1)" }}>
            <CloudChip
              as="button"
              tone="violet"
              onClick={handleSend}
              disabled={!canSubmit}
              className="w-full py-3.5 text-[12px] font-bold tracking-[0.2em] uppercase transition-transform active:scale-[0.98]"
              style={{ color: "#F4EEFF" }}>
              {phase === "error" ? "Try Again" : "Send"}
            </CloudChip>
            {phase === "error" && !submitErr && (
              <p className="mt-2 text-center text-[10px] text-red-600">The seas were rough. Try again.</p>
            )}
          </div>

        </div>
      )}
    </LiquidSheet>
  )
}