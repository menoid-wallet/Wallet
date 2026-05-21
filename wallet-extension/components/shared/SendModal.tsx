/**
 * SendModal.tsx (Open mode only)
 *
 * Slides up from the bottom (same animation as ReceiveModal for visual
 * consistency). Validates the address + amount, then signs and broadcasts
 * a native MON transfer via the project's monadRpc helper.
 *
 * States: form → submitting → success | error
 *  - success shows the tx hash + a "View in explorer" link
 *  - on success we call `onSent(hash)` so the parent can refresh balance
 *    and the tx-history list right away
 */

import React, { useEffect, useState } from "react"
import { ethers } from "ethers"
import { explorerTxUrl, sendNative } from "../../lib/monadRpc"

interface Props {
  open: boolean
  onClose: () => void
  fromAddress: string
  privateKey: string
  balance: string
  onSent?: (hash: string) => void
}

type Phase = "form" | "submitting" | "success" | "error"

export default function SendModal({
  open,
  onClose,
  fromAddress,
  privateKey,
  balance,
  onSent
}: Props) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<Phase>("form")
  const [to, setTo] = useState("")
  const [amount, setAmount] = useState("")
  const [err, setErr] = useState("")
  const [txHash, setTxHash] = useState("")

  useEffect(() => {
    if (open) {
      setMounted(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    } else if (mounted) {
      setVisible(false)
      const t = setTimeout(() => {
        setMounted(false)
        // reset for next time
        setPhase("form")
        setTo("")
        setAmount("")
        setErr("")
        setTxHash("")
      }, 320)
      return () => clearTimeout(t)
    }
  }, [open, mounted])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  if (!mounted) return null

  function validate(): string | null {
    if (!ethers.isAddress(to.trim())) return "Enter a valid recipient address."
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) return "Enter a valid amount."
    if (amt > Number(balance)) return "Amount exceeds available balance."
    return null
  }

  async function handleSend() {
    const v = validate()
    if (v) {
      setErr(v)
      return
    }
    setErr("")
    setPhase("submitting")
    try {
      const r = await sendNative(privateKey, to.trim(), amount.trim())
      setTxHash(r.hash)
      setPhase("success")
      onSent?.(r.hash)
      // fire-and-forget wait so the user can see "confirmed" UI later if you add it
      r.wait().catch(() => {})
    } catch (e: any) {
      console.error("[SendModal] send failed:", e)
      setErr(
        e?.shortMessage ?? e?.message ?? "Transaction failed. Try again."
      )
      setPhase("error")
    }
  }

  function setMax() {
    // leave a tiny dust for gas — purely cosmetic; real gas is estimated by RPC
    const num = Number(balance)
    if (!Number.isFinite(num) || num <= 0) {
      setAmount("0")
      return
    }
    const max = Math.max(0, num - 0.001)
    setAmount(max.toFixed(6).replace(/\.?0+$/, ""))
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-hidden">
      <button
        aria-label="Close"
        onClick={onClose}
        className={`absolute inset-0 bg-ink/45 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className={`relative w-full max-w-[420px] mx-auto transition-all duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          visible ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"
        }`}>
        <div className="relative rounded-t-[28px] bg-cream border border-b-0 border-ink/15 overflow-hidden shadow-[0_-30px_60px_-20px_rgba(23,19,17,0.4)]">
          <div className="pointer-events-none absolute inset-0 paper-grain opacity-30" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-10%,_rgba(232,174,58,0.32)_0%,_rgba(246,233,208,0)_55%)]" />

          <div className="relative flex justify-center pt-3">
            <span className="h-1 w-10 rounded-full bg-ink/20" />
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-ink/[0.07] hover:bg-ink/[0.14] border border-ink/10 transition-colors">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 2L10 10M10 2L2 10"
                stroke="#171311"
                strokeOpacity="0.7"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className="relative px-6 pt-4 pb-2 text-center">
            <p className="text-[9px] tracking-[0.45em] uppercase text-goldDeep mb-1">
              Send Treasure
            </p>
            <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]">
              {phase === "success"
                ? "Aweigh! Tx broadcast."
                : phase === "error"
                  ? "Storm rolled in."
                  : "Send MON"}
            </h3>
            <p className="mt-1 text-[11px] text-ink/55 leading-snug">
              {phase === "success"
                ? "Your transaction was sent to the network."
                : `Balance: ${Number(balance).toFixed(4)} MON`}
            </p>
          </div>

          {phase === "success" ? (
            <div className="relative px-6 pt-4 pb-6">
              <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-4 flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M2 7L5.5 10.5L12 4"
                      stroke="#059669"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-emerald-700">
                    Transaction broadcast
                  </p>
                  <p className="font-mono text-[10px] text-ink/60 mt-1 break-all">
                    {txHash}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <a
                  href={explorerTxUrl(txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl bg-ink/[0.05] border border-ink/10 hover:bg-ink/[0.1] py-3 text-[11px] tracking-[0.25em] uppercase text-ink/70 text-center transition-colors">
                  View in Explorer
                </a>
                <button
                  onClick={onClose}
                  className="rounded-xl bg-ink text-bone py-3 text-[11px] tracking-[0.25em] uppercase hover:-translate-y-[1px] transition">
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="relative px-6 pt-4 pb-6 space-y-4">
              <div>
                <label className="block text-[9px] tracking-[0.3em] uppercase text-ink/50 mb-1.5">
                  Recipient address
                </label>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  disabled={phase === "submitting"}
                  placeholder="0x…"
                  className="w-full rounded-xl bg-ink/[0.05] border border-ink/12 px-3 py-2.5 text-[12px] font-mono placeholder-ink/30 focus:outline-none focus:border-goldDeep/60 transition-colors disabled:opacity-50"
                />
              </div>
              <div>
                <div className="flex items-end justify-between mb-1.5">
                  <label className="block text-[9px] tracking-[0.3em] uppercase text-ink/50">
                    Amount (MON)
                  </label>
                  <button
                    onClick={setMax}
                    disabled={phase === "submitting"}
                    className="text-[9px] tracking-[0.3em] uppercase text-goldDeep hover:text-goldDeeper transition-colors disabled:opacity-50">
                    Max
                  </button>
                </div>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={phase === "submitting"}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="w-full rounded-xl bg-ink/[0.05] border border-ink/12 px-3 py-2.5 text-[14px] font-mono placeholder-ink/30 focus:outline-none focus:border-goldDeep/60 transition-colors disabled:opacity-50"
                />
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-ink/[0.04] border border-ink/10">
                <span className="text-[10px] tracking-[0.3em] uppercase text-ink/50">
                  From
                </span>
                <span className="font-mono text-[11px] text-ink/70">
                  {fromAddress.slice(0, 6)}…{fromAddress.slice(-4)}
                </span>
              </div>

              {err && (
                <p className="text-[11px] text-red-600 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
                  {err}
                </p>
              )}

              <button
                disabled={phase === "submitting"}
                onClick={handleSend}
                className="w-full rounded-2xl bg-ink text-bone py-3.5 font-display text-[12px] font-semibold tracking-[0.12em] uppercase transition-all hover:-translate-y-[1px] disabled:opacity-50 disabled:cursor-wait flex items-center justify-center gap-2">
                {phase === "submitting" ? (
                  <>
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-bone/30 border-t-bone animate-spin" />
                    Hoisting sails…
                  </>
                ) : (
                  "Set Sail — Send"
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}