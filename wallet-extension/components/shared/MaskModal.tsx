/**
 * MaskModal.tsx
 *
 * Pirate-themed "Mask" (deposit-into-ZK-pool) sheet.
 *
 * The progress indicator is a ship sailing along a track between
 * 4 ports: Validate → Generate Proof → Send Transaction → Done.
 * The ship glides smoothly between ports rather than snapping, and
 * a gold wake fills in behind it as it progresses. On success the
 * ship docks at the final port and a small anchor glyph drops.
 *
 * Step-bar lifecycle:
 *   form     → user enters amount + fee (ship hidden)
 *   relayer  → port 0 active (Validate)
 *   proving  → port 1 active (Generate Proof)
 *   sending  → port 2 active (Send Transaction)
 *   success  → port 3 reached, ship docked
 *   error    → fatal — back to form
 *
 * We call forceSync() from PoolContext on success so the new commitment
 * decrypts into a UTXO within the next poll instead of waiting 10s.
 */

import React, { useCallback, useEffect, useState } from "react"
import { ethers } from "ethers"
import { explorerTxUrl } from "../../lib/monadRpc"
import { fetchRelayerKeys } from "../../services/api"
import { executeMask } from "../../services/mask"
import { useWallet } from "../../context/WalletContext"
import { usePool } from "../../context/PoolContext"
import ModalPortal from "./ModalPortal"
import shipImg from "../../assets/ship/ship.png"

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

            {/* ship voyage progress (only while in flight or done) */}
            {(phase === "relayer" ||
              phase === "proving" ||
              phase === "sending" ||
              phase === "success") && (
              <div className="relative px-6 pt-4">
                <ShipVoyage phase={phase} />
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
                    <Row label="You mask" value={`${youReceive} MON`} accent />
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
              <div className="relative px-6 pb-6 pt-4">
                <div className="flex flex-col items-center gap-3 py-2">
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
              <div className="relative px-6 pt-4 pb-6">
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

// ─── ship voyage ──────────────────────────────────────────────────────
// Maps each phase to a "ship progress" value in [0..1] across the track.
// The ship sits AT each port checkpoint, not between, so:
//   relayer  → port 0 (0.0)
//   proving  → port 1 (1/3)
//   sending  → port 2 (2/3)
//   success  → port 3 (1.0)
//
// We tween via CSS transition on `left` so the ship glides smoothly
// each time the phase changes. The wake (gold fill) follows behind it.
function ShipVoyage({ phase }: { phase: Phase }) {
  const progress = phaseToProgress(phase)
  const portCount = STEPS.length
  const docked = phase === "success"

  // Ship size kept identical in transit AND when docked. The bob lives
  // on an inner wrapper so we can stop it without changing layout. The
  // outer wrapper handles horizontal positioning + the gold glow on dock.
  const SHIP_PX = 60

  return (
    <div className="relative pb-1">
      {/* Track + ports + ship live in one fixed-height row. Height must
          comfortably contain the ship at full size, so we use h-16 (64px)
          rather than h-12 — otherwise the ship gets clipped or visually
          drifts when its size differs from the track height. */}
      <div className="relative h-16">
        {/* Background track (full gray line) */}
        <div className="absolute left-3 right-3 top-1/2 -translate-y-1/2 h-[2px] bg-ink/15 rounded-full" />

        {/* Wake — gold fill from start up to the ship's current x */}
        <div
          className="absolute left-3 top-1/2 -translate-y-1/2 h-[2px] bg-goldDeep rounded-full transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{
            width: `calc((100% - 24px) * ${progress})`
          }}
        />

        {/* Port checkpoints */}
        {STEPS.map((_, i) => {
          const portProg = i / (portCount - 1)
          const reached = progress >= portProg - 0.001
          const isCurrent =
            Math.abs(progress - portProg) < 0.01 && !docked
          return (
            <div
              key={i}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `calc(12px + (100% - 24px) * ${portProg})` }}>
              <div
                className={`relative h-3 w-3 rounded-full border transition-all duration-300 ${
                  reached
                    ? "bg-goldDeep border-goldDeep"
                    : "bg-cream border-ink/25"
                } ${isCurrent ? "scale-125" : ""}`}>
                {isCurrent && (
                  <span className="absolute inset-0 rounded-full bg-goldDeep/40 animate-ping" />
                )}
              </div>
            </div>
          )
        })}

        {/* Ocean wave decoration under the track */}
        <svg
          className="absolute bottom-0 left-0 w-full pointer-events-none opacity-30"
          height="6"
          viewBox="0 0 380 6"
          preserveAspectRatio="none">
          <path
            d="M0 3 Q47 0 95 3 Q142 6 190 3 Q237 0 285 3 Q332 6 380 3"
            stroke="#1a6b8a"
            strokeWidth="1"
            fill="none"
          />
        </svg>

        {/*
          Ship wrapper is split into THREE layers so each concern is
          independent and can't interfere with the others:
            1. outermost: horizontal position + the "glide" tween on `left`.
               Width/height match the ship so translate(-50%) actually
               centers on the port dot.
            2. middle: the bob animation (transform on an inner div, not
               on the <img>). When docked, animation:none simply stops the
               bob without changing the wrapper's box, so the ship stays
               put instead of shifting/shrinking.
            3. innermost: the <img> itself — fixed size in BOTH states,
               only the `filter` (glow) changes between transit and dock.
        */}
        <div
          className="absolute top-1/2 transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{
            left: `calc(12px + (100% - 24px) * ${progress})`,
            width: SHIP_PX,
            height: SHIP_PX,
            transform: "translate(-50%, -50%)"
          }}>
          <div
            style={{
              width: "100%",
              height: "100%",
              animation: docked
                ? "none"
                : "shipBob 1.6s ease-in-out infinite",
              transformOrigin: "center center"
            }}>
            <img
              src={shipImg}
              alt="ship"
              style={{
                width: SHIP_PX,
                height: SHIP_PX,
                display: "block",
                filter: docked
                  ? "drop-shadow(0 0 8px rgba(218,162,28,0.75)) drop-shadow(0 0 16px rgba(218,162,28,0.35))"
                  : "drop-shadow(0 1px 2px rgba(23,19,17,0.4))",
                transition: "filter 400ms ease"
              }}
              className="select-none pointer-events-none object-contain"
            />
          </div>

          {/*
            Anchor drop — positioned relative to the OUTER wrapper (not
            the bobbing inner) so it stays put after dropping. Bottom-
            anchored just under the ship's hull, sized to match the
            larger ship.
          */}
          {docked && (
            <span
              className="absolute left-1/2 text-[16px] pointer-events-none"
              style={{
                bottom: -8,
                transform: "translateX(-50%)",
                animation: "anchorDrop 0.7s cubic-bezier(0.22,1,0.36,1)",
                filter: "drop-shadow(0 1px 2px rgba(23,19,17,0.5))"
              }}>
              ⚓
            </span>
          )}
        </div>
      </div>

      {/* Port labels */}
      <div className="relative mt-1 flex">
        {STEPS.map((label, i) => {
          const portProg = i / (portCount - 1)
          const reached = progress >= portProg - 0.001
          return (
            <span
              key={label}
              className={`absolute -translate-x-1/2 text-[8px] tracking-[0.18em] uppercase transition-colors duration-300 ${
                reached ? "text-goldDeep" : "text-ink/30"
              }`}
              style={{ left: `calc(12px + (100% - 24px) * ${portProg})` }}>
              {label}
            </span>
          )
        })}
      </div>

      {/* keyframes — embedded so we don't need a tailwind config change.
          shipBob lives on the INNER wrapper (a div) instead of the <img>
          so that disabling it on dock doesn't reset image positioning. */}
      <style>{`
        @keyframes shipBob {
          0%, 100% { transform: translateY(-2px) rotate(-2deg); }
          50%      { transform: translateY( 1px) rotate( 2deg); }
        }
        @keyframes anchorDrop {
          0%   { transform: translateX(-50%) translateY(-10px); opacity: 0; }
          60%  { transform: translateX(-50%) translateY(  3px); opacity: 1; }
          100% { transform: translateX(-50%) translateY(  0);   opacity: 1; }
        }
      `}</style>

      {/* extra bottom space so port labels don't overlap content below */}
      <div className="h-4" />
    </div>
  )
}
// Map phase → ship position along the track.
//   relayer  → 0/3   (Validate port — first checkpoint)
//   proving  → 1/3   (Generate Proof)
//   sending  → 2/3   (Send Transaction)
//   success  → 3/3   (Done)
function phaseToProgress(p: Phase): number {
  switch (p) {
    case "relayer":
      return 0
    case "proving":
      return 1 / 3
    case "sending":
      return 2 / 3
    case "success":
      return 1
    default:
      return 0
  }
}

// ─── helpers ───────────────────────────────────────────────────────────
function isBusy(p: Phase) {
  return p === "relayer" || p === "proving" || p === "sending"
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