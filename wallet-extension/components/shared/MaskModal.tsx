/**
 * MaskModal.tsx
 *
 * Pirate-themed "Mask" (deposit-into-ZK-pool) sheet.
 *
 * Reuses the design language already established by SendModal/ReceiveModal:
 *   - portalled slide-up sheet, ink/cream/gold palette, paper grain
 *   - close button top-right, drag handle pill at top
 *   - inline validation under each input, no surprise modals
 *
 * Step-bar lifecycle:
 *   form        → user enters amount + fee
 *   validate    → quick local checks (balance, fee minimum)
 *   relayer     → fetch relayer keys
 *   proving     → ~20s zk proof generation (the heavy step)
 *   sending     → tx broadcast
 *   success     → confirmed, with explorer link
 *   error       → fatal — show message + back-to-form
 *
 * We call forceSync() from PoolContext on success so the new commitment
 * decrypts into a UTXO within the next poll instead of waiting 10s.
 *
 * The balance shown is the OPEN balance (from openBalance prop) because
 * mask spends MON from the public account.
 */

import React, { useCallback, useEffect, useState } from "react"
import { ethers } from "ethers"
import { explorerTxUrl } from "../../lib/monadRpc"
import { fetchRelayerKeys } from "../../services/api"
import { executeMask } from "../../services/mask"
import { useWallet } from "../../context/WalletContext"
import { usePool } from "../../context/PoolContext"
import ModalPortal from "./ModalPortal"

const MIN_FEE_MON = "0.5"
const MIN_FEE_WEI = ethers.parseEther(MIN_FEE_MON)

type Phase =
  | "form"
  | "relayer"
  | "proving"
  | "sending"
  | "success"
  | "error"

const STEPS = ["Validate", "Generate Proof", "Send Transaction", "Done"]

interface Props {
  open: boolean
  onClose: () => void
  /** open-mode (public) balance as decimal MON string */
  openBalance: string
}

export default function MaskModal({ open, onClose, openBalance }: Props) {
  const { wallet } = useWallet()
  const { forceSync } = usePool()

  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  const [amount, setAmount] = useState("")
  const [fee, setFee] = useState(MIN_FEE_MON)
  const [touched, setTouched] = useState(false)
  const [errors, setErrors] = useState<{ amount?: string; fee?: string }>({})

  const [phase, setPhase] = useState<Phase>("form")
  const [statusMsg, setStatusMsg] = useState("")
  const [txHash, setTxHash] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)

  // enter/exit animation
  useEffect(() => {
    if (open) {
      setMounted(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    } else if (mounted) {
      setVisible(false)
      const t = setTimeout(() => {
        setMounted(false)
        // reset for next open
        setPhase("form")
        setAmount("")
        setFee(MIN_FEE_MON)
        setErrors({})
        setTouched(false)
        setFatal(null)
        setTxHash(null)
        setStatusMsg("")
      }, 320)
      return () => clearTimeout(t)
    }
  }, [open, mounted])

  // esc to close (only when not busy)
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isBusy(phase)) onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose, phase])

  // ── validation ────────────────────────────────────────────────────────
  const validate = useCallback(() => {
    const errs: { amount?: string; fee?: string } = {}
    let depositWei: bigint | null = null
    let feeWei: bigint | null = null
    let openWei: bigint = 0n

    try {
      depositWei = ethers.parseEther(amount || "0")
    } catch {
      errs.amount = "Invalid amount"
    }
    try {
      feeWei = ethers.parseEther(fee || "0")
    } catch {
      errs.fee = "Invalid fee"
    }
    try {
      openWei = ethers.parseEther(openBalance || "0")
    } catch {
      /* ignore */
    }

    if (!errs.amount && depositWei !== null && depositWei <= 0n) {
      errs.amount = "Enter an amount greater than 0"
    }
    if (!errs.amount && depositWei !== null && depositWei > openWei) {
      errs.amount = `Exceeds open balance (${Number(openBalance).toFixed(4)} MON)`
    }
    if (!errs.fee && feeWei !== null && feeWei < MIN_FEE_WEI) {
      errs.fee = `Minimum fee is ${MIN_FEE_MON} MON`
    }
    if (
      !errs.amount &&
      !errs.fee &&
      depositWei !== null &&
      feeWei !== null &&
      feeWei >= depositWei
    ) {
      errs.fee = "Fee must be less than deposit"
    }

    setErrors(errs)
    return Object.keys(errs).length === 0
  }, [amount, fee, openBalance])

  useEffect(() => {
    if (touched) validate()
  }, [amount, fee, touched, validate])

  // ── derived: what the user actually masks ────────────────────────────
  const youReceive = (() => {
    try {
      const d = ethers.parseEther(amount || "0")
      const f = ethers.parseEther(fee || "0")
      if (d > f) return ethers.formatEther(d - f)
    } catch {
      /* ignore */
    }
    return "—"
  })()

  // ── submit ───────────────────────────────────────────────────────────
  async function handleMask() {
    setTouched(true)
    if (!validate()) return
    if (!wallet) return

    setFatal(null)

    try {
      setPhase("relayer")
      setStatusMsg("Hailing the relayer...")
      const relayerKeys = await fetchRelayerKeys()

      setPhase("proving")
      setStatusMsg("Forging zero-knowledge proof — this takes ~20s.")

      const { hash } = await executeMask({
        depositAmountMon: amount,
        feeMon: fee,
        normalPrivateKey: wallet.normalAccount.privateKey,
        noidPublicKey: wallet.noidAccount.publicKey,
        noidZkPublicKey: wallet.noidAccount.zkPublicKey,
        relayerKeys,
        onProofStart: () => {},
        onSendTx: (h) => {
          setTxHash(h)
          setPhase("sending")
          setStatusMsg("Broadcasting transaction to Monad...")
        }
      })

      setTxHash(hash)
      setPhase("success")
      setStatusMsg("Funds masked successfully.")

      // pull the new commitment into PoolContext ASAP
      setTimeout(() => void forceSync(), 1500)
    } catch (e: any) {
      console.error(e)
      const msg =
        e?.shortMessage ||
        e?.reason ||
        e?.message ||
        "Mask failed. Check console for details."
      setFatal(msg)
      setPhase("error")
    }
  }

  if (!mounted) return null

  const stepIdx = phaseToStepIdx(phase)

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[2147483000] flex items-end justify-center overflow-hidden">
        {/* backdrop */}
        <button
          aria-label="Close"
          onClick={() => {
            if (!isBusy(phase)) onClose()
          }}
          className={`absolute inset-0 bg-ink/45 backdrop-blur-sm transition-opacity duration-300 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* sheet */}
        <div
          className={`relative w-full max-w-[420px] mx-auto transition-all duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            visible
              ? "translate-y-0 opacity-100"
              : "translate-y-full opacity-0"
          }`}>
          <div className="relative rounded-t-[28px] bg-cream border border-b-0 border-ink/15 overflow-hidden shadow-[0_-30px_60px_-20px_rgba(23,19,17,0.4)]">
            <div className="pointer-events-none absolute inset-0 paper-grain opacity-30" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-10%,_rgba(74,108,182,0.28)_0%,_rgba(246,233,208,0)_55%)]" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_115%,_rgba(232,174,58,0.24)_0%,_rgba(246,233,208,0)_55%)]" />

            <div className="relative flex justify-center pt-3">
              <span className="h-1 w-10 rounded-full bg-ink/20" />
            </div>

            {!isBusy(phase) && (
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
            )}

            {/* header */}
            <div className="relative px-6 pt-4 pb-2 text-center">
              <p className="text-[9px] tracking-[0.45em] uppercase text-goldDeep mb-1">
                {phase === "success"
                  ? "Veil Drawn"
                  : phase === "error"
                    ? "Storm Rolled In"
                    : "Slip into shadow"}
              </p>
              <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]">
                {phase === "success"
                  ? "Your treasure is masked. ⚓"
                  : phase === "error"
                    ? "Mask failed."
                    : "Mask MON"}
              </h3>
              <p className="mt-1 text-[11px] text-ink/55 leading-snug">
                {phase === "success"
                  ? "Your MON has crossed into the private waters."
                  : `Open balance: ${Number(openBalance).toFixed(4)} MON`}
              </p>
            </div>

            {/* step bar (visible whenever we're past form OR errored) */}
            {(phase === "relayer" ||
              phase === "proving" ||
              phase === "sending" ||
              phase === "success") && (
              <div className="relative px-6 pt-3">
                <StepBar current={stepIdx} />
              </div>
            )}

            {/* ── form ── */}
            {phase === "form" || phase === "error" ? (
              <div className="relative px-6 pt-4 pb-6 space-y-4">
                {/* amount */}
                <div>
                  <div className="flex items-end justify-between mb-1.5">
                    <label className="block text-[9px] tracking-[0.3em] uppercase text-ink/50">
                      Amount to Mask (MON)
                    </label>
                    <button
                      onClick={() => {
                        // max = balance - fee
                        try {
                          const o = ethers.parseEther(openBalance || "0")
                          const f = ethers.parseEther(fee || "0")
                          if (o > f) {
                            setAmount(ethers.formatEther(o - f))
                          }
                        } catch {
                          /* ignore */
                        }
                      }}
                      className="text-[9px] tracking-[0.3em] uppercase text-goldDeep hover:text-goldDeeper transition-colors">
                      Max
                    </button>
                  </div>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    inputMode="decimal"
                    className={`w-full rounded-xl bg-ink/[0.05] border px-3 py-2.5 text-[14px] font-mono placeholder-ink/30 focus:outline-none transition-colors ${
                      errors.amount
                        ? "border-red-500/40 focus:border-red-500/60"
                        : "border-ink/12 focus:border-goldDeep/60"
                    }`}
                  />
                  {errors.amount && (
                    <p className="mt-1 text-[10px] text-red-600">
                      {errors.amount}
                    </p>
                  )}
                </div>

                {/* fee */}
                <div>
                  <div className="flex items-end justify-between mb-1.5">
                    <label className="block text-[9px] tracking-[0.3em] uppercase text-ink/50">
                      Relayer Fee (MON)
                    </label>
                    <span className="text-[9px] tracking-[0.2em] uppercase text-ink/40">
                      min {MIN_FEE_MON}
                    </span>
                  </div>
                  <input
                    value={fee}
                    onChange={(e) => setFee(e.target.value)}
                    placeholder={MIN_FEE_MON}
                    inputMode="decimal"
                    className={`w-full rounded-xl bg-ink/[0.05] border px-3 py-2.5 text-[14px] font-mono placeholder-ink/30 focus:outline-none transition-colors ${
                      errors.fee
                        ? "border-red-500/40 focus:border-red-500/60"
                        : "border-ink/12 focus:border-goldDeep/60"
                    }`}
                  />
                  {errors.fee && (
                    <p className="mt-1 text-[10px] text-red-600">
                      {errors.fee}
                    </p>
                  )}
                </div>

                {/* breakdown */}
                {amount && fee && !errors.amount && !errors.fee && (
                  <div className="rounded-xl bg-ink/[0.04] border border-ink/10 p-3 space-y-1.5">
                    <Row label="You deposit" value={`${amount} MON`} />
                    <Row label="Relayer fee" value={`− ${fee} MON`} />
                    <div className="h-px bg-ink/10 my-1" />
                    <Row
                      label="You mask"
                      value={`${youReceive} MON`}
                      accent
                    />
                  </div>
                )}

                {phase === "error" && fatal && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/25">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      className="text-red-600 mt-0.5 flex-shrink-0">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <p className="text-[11px] text-red-700 leading-relaxed">
                      {fatal}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    onClick={onClose}
                    className="rounded-xl bg-ink/[0.05] border border-ink/10 hover:bg-ink/[0.1] py-3 text-[11px] tracking-[0.25em] uppercase text-ink/70 transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={handleMask}
                    className="rounded-xl bg-ink text-bone py-3 text-[11px] tracking-[0.25em] uppercase hover:-translate-y-[1px] transition-all flex items-center justify-center gap-2">
                    <MaskGlyph />
                    Mask
                  </button>
                </div>

                <p className="text-center font-serif italic text-[11px] text-ink/40 pt-1">
                  "Hide yer gold in the fog."
                </p>
              </div>
            ) : null}

            {/* ── busy ── */}
            {(phase === "relayer" ||
              phase === "proving" ||
              phase === "sending") && (
              <div className="relative px-6 pb-6 pt-2">
                <div className="flex flex-col items-center gap-4 py-6">
                  <Spinner size={32} />
                  <p className="font-display text-[12px] text-goldDeep tracking-[0.2em] uppercase text-center leading-relaxed max-w-xs">
                    {statusMsg}
                  </p>
                  {phase === "proving" && (
                    <p className="text-[11px] text-ink/40 text-center max-w-[260px] leading-snug">
                      The ZK proof generates entirely in your browser. Keep
                      this window open.
                    </p>
                  )}
                  {phase === "sending" && txHash && (
                    <p className="font-mono text-[10px] text-ink/40 break-all max-w-[280px] text-center">
                      {txHash}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── success ── */}
            {phase === "success" && (
              <div className="relative px-6 pt-2 pb-6">
                <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-4 flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none">
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
                      Mask confirmed
                    </p>
                    <p className="font-mono text-[10px] text-ink/60 mt-1 break-all">
                      {txHash}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {txHash && (
                    <a
                      href={explorerTxUrl(txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl bg-ink/[0.05] border border-ink/10 hover:bg-ink/[0.1] py-3 text-[11px] tracking-[0.25em] uppercase text-ink/70 text-center transition-colors">
                      View in Explorer
                    </a>
                  )}
                  <button
                    onClick={onClose}
                    className="rounded-xl bg-ink text-bone py-3 text-[11px] tracking-[0.25em] uppercase hover:-translate-y-[1px] transition">
                    Done
                  </button>
                </div>
                <p className="mt-3 text-center font-serif italic text-[11px] text-ink/40">
                  "The veil holds. Yer coins sail uncharted seas."
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

// ─── helpers ───────────────────────────────────────────────────────────
function isBusy(p: Phase) {
  return p === "relayer" || p === "proving" || p === "sending"
}

function phaseToStepIdx(p: Phase): number {
  // STEPS = ["Validate", "Generate Proof", "Send Transaction", "Done"]
  switch (p) {
    case "form":
    case "error":
      return -1
    case "relayer":
      return 0
    case "proving":
      return 1
    case "sending":
      return 2
    case "success":
      return 3
  }
}

function Row({
  label,
  value,
  accent
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-[10px] tracking-[0.3em] uppercase text-ink/50">
        {label}
      </span>
      <span
        className={`font-mono text-[12px] ${
          accent ? "text-goldDeep font-semibold" : "text-ink/80"
        }`}>
        {value}
      </span>
    </div>
  )
}

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="inline-block border-2 border-goldDeep border-t-transparent rounded-full animate-spin"
    />
  )
}

function MaskGlyph() {
  return (
    <svg width="14" height="10" viewBox="0 0 20 14" fill="none">
      <path
        d="M2 6 Q4 2 7 2 Q9 2 10 4 Q11 2 13 2 Q16 2 18 6 Q17 11 13 11 Q11 11 10 9 Q9 11 7 11 Q3 11 2 6 Z"
        fill="#FBF1D9"
        opacity="0.95"
      />
    </svg>
  )
}

// ─── step bar ──────────────────────────────────────────────────────────
function StepBar({ current }: { current: number }) {
  const STEP_LABELS = STEPS
  return (
    <div className="flex items-center gap-0 mb-2">
      {STEP_LABELS.map((label, i) => {
        const done = i < current
        const active = i === current
        return (
          <React.Fragment key={label}>
            <div className="flex flex-col items-center gap-1 flex-1">
              <div
                className={`w-6 h-6 flex items-center justify-center rounded-full border text-[10px] font-display transition-all duration-300 ${
                  done
                    ? "border-goldDeep bg-goldDeep text-bone"
                    : active
                      ? "border-goldDeep text-goldDeep animate-pulse"
                      : "border-ink/20 text-ink/30"
                }`}>
                {done ? (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span>{i + 1}</span>
                )}
              </div>
              <span
                className={`text-[8px] tracking-[0.2em] uppercase transition-colors duration-300 hidden sm:block ${
                  done || active ? "text-goldDeep" : "text-ink/30"
                }`}>
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div
                className={`h-px flex-1 mb-3 transition-colors duration-500 ${
                  i < current ? "bg-goldDeep" : "bg-ink/15"
                }`}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}