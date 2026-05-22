/**
 * ReceiveModal.tsx
 *
 * Pirate-themed QR sheet that slides up from the bottom.
 *  - Open mode → encodes the wallet address
 *  - Noid mode → encodes "publicKey|zkPublicKey" so a scanner gets both
 *                in one read. The pair is also shown as text; "Copy"
 *                copies the joined string.
 *
 * Portalled to <body> so it always covers the top/bottom navbars
 * regardless of any overflow-hidden / transform on the wallet root
 * (that's what was clipping it before).
 *
 * The meno_hat_icon overlays the QR center; QR is generated at
 * error-correction level "H" so the central occlusion stays scannable.
 */

import React, { useEffect, useState } from "react"
import menoHat from "data-base64:~assets/meno_hat_icon.png"
import { useThemeTokens } from "../../lib/useThemeTokens"
import LiquidSheet from "./LiquidSheet"
import QRCanvas from "./QRCanvas"

type Mode = "open" | "noid"

interface Props {
  open: boolean
  onClose: () => void
  mode: Mode
  address?: string
  publicKey?: string
  zkPublicKey?: string
}

export default function ReceiveModal({
  open,
  onClose,
  mode,
  address,
  publicKey,
  zkPublicKey
}: Props) {
  const [copied, setCopied] = useState(false)
  const t = useThemeTokens()

  const payload =
    mode === "open"
      ? address ?? ""
      : `${publicKey ?? ""}|${zkPublicKey ?? ""}`

  const title = mode === "open" ? "Receive on Open" : "Receive on Noid"
  const subtitle =
    mode === "open"
      ? "Share this address to receive MON"
      : "Share both keys — scanners receive the pair"

  function handleCopy() {
    if (!payload) return
    navigator.clipboard.writeText(payload)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  function trunc(s: string, a = 8, b = 6) {
    if (!s) return ""
    return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
  }

  return (
    <LiquidSheet
      open={open}
      onClose={onClose}
      tone={t.isNoid ? "ink" : "cream"}>
      <div className="relative">
        <div className="relative px-6 pt-2 pb-2 text-center">
              <p className="text-[9px] tracking-[0.45em] uppercase text-goldDeep mb-1">
                {mode === "open" ? "Open Mode" : "Noid Mode"}
              </p>
              <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]">
                {title}
              </h3>
              <p
                className={`mt-1 text-[11px] leading-snug ${
                  t.isNoid ? "text-bone/65" : "text-ink/55"
                }`}>
                {subtitle}
              </p>
            </div>

            {/* QR + center hat */}
            <div className="relative px-6 pt-4 flex justify-center">
              <div className="relative inline-block">
                <div className="absolute -inset-4 rounded-2xl border border-dashed border-goldDeep/25 pointer-events-none" />
                <div className="absolute -inset-1 rounded-xl bg-goldDeep/15 blur-2xl pointer-events-none" />

                <div className="relative rounded-xl bg-bone p-3 border border-ink/10 shadow-[0_18px_40px_-20px_rgba(23,19,17,0.45)]">
                  {payload ? (
                    <QRCanvas
                      data={payload}
                      size={220}
                      // QR stays printed on a bone tile in both modes so it
                      // remains scannable; the bone tile inside the dark
                      // sheet doubles as a deliberate scan target.
                      fg="#171311"
                      bg="#FBF1D9"
                    />
                  ) : (
                    <div className="h-[220px] w-[220px] flex items-center justify-center text-[11px] text-ink/40">
                      No data
                    </div>
                  )}

                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="relative flex items-center justify-center">
                      <div className="absolute h-12 w-12 rounded-full bg-cream shadow-[0_2px_8px_rgba(23,19,17,0.18)] border border-ink/10" />
                      <img
                        src={menoHat}
                        alt=""
                        style={{ mixBlendMode: "multiply" }}
                        className="relative h-10 w-10 object-contain drop-shadow-[0_3px_6px_rgba(28,20,12,0.35)]"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* payload text */}
            <div className="relative px-6 pt-5">
              {mode === "open" ? (
                <div className={`rounded-xl p-3 ${t.card}`}>
                  <p
                    className={`text-[9px] tracking-[0.3em] uppercase mb-1 ${t.textFaint}`}>
                    Wallet Address
                  </p>
                  <p
                    className={`font-mono text-[12px] break-all leading-snug ${
                      t.isNoid ? "text-bone/85" : "text-ink/80"
                    }`}>
                    {address}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className={`rounded-xl p-3 ${t.card}`}>
                    <p
                      className={`text-[9px] tracking-[0.3em] uppercase mb-1 ${
                        t.isNoid ? "text-gold" : "text-goldDeep"
                      }`}>
                      Noid Key
                    </p>

                    <p
                      className={`font-mono text-[11px] break-all leading-snug ${
                        t.isNoid ? "text-bone/85" : "text-ink/80"
                      }`}>
                      {trunc(`${publicKey ?? ""}|${zkPublicKey ?? ""}`, 18, 18)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="relative px-6 pt-4 pb-6">
              <button
                onClick={handleCopy}
                className={`w-full rounded-2xl py-3.5 font-display text-[12px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[1px] flex items-center justify-center gap-2 ${
                  t.isNoid ? "bg-bone text-ink" : "bg-ink text-bone"
                }`}>
                {copied ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M2 7L5.5 10.5L12 4"
                        className="gold-stroke"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Copied!
                  </>
                ) : mode === "open" ? (
                  "Copy Address"
                ) : (
                  "Copy Noid Key"
                )}
              </button>
              <p className="mt-3 text-center font-serif italic text-[11px] text-ink/40">
                {mode === "open"
                  ? "Yer keys, yer kingdom."
                  : "Two keys, one secret port."}
              </p>
            </div>
      </div>
    </LiquidSheet>
  )
}