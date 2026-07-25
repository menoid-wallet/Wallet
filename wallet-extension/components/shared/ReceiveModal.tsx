/**
 * ReceiveModal.tsx
 *
 * Pirate-themed QR sheet that slides up from the bottom.
 *  - Open mode → encodes the wallet address
 *  - Noid mode → also encodes the SAME real wallet address. Under the
 *                register/user-commitment architecture a sender pays a
 *                real address (Menoid resolves the private identity on-chain),
 *                so there is no separate "noid key" to share anymore.
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
}

export default function ReceiveModal({
  open,
  onClose,
  mode,
  address
}: Props) {
  const [copied, setCopied] = useState(false)
  const t = useThemeTokens()

  // Both modes share the SAME real address; noid mode just shows it with the
  // dark theming. (publicKey / zkPublicKey are no longer surfaced.)
  const payload = address ?? ""

  const title = mode === "open" ? "Receive on Open" : "Receive on Noid"
  const subtitle =
    mode === "open"
      ? "Share this address to receive"
      : "Share this address — funds arrive privately"

  function handleCopy() {
    if (!payload) return
    navigator.clipboard.writeText(payload)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <LiquidSheet
      open={open}
      onClose={onClose}
      tone={t.isNoid ? "ink" : "cream"}>
      <div className="relative">
        <div className="relative px-6 pt-2 pb-2 text-center">
              <p className={`text-[9px] tracking-[0.45em] uppercase mb-1 ${t.isNoid ? "text-[#C9B0FF]" : "text-violetDeep/70"}`}>
                {mode === "open" ? "Open Mode" : "Noid Mode"}
              </p>
              <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]">
                {title}
              </h3>
              <p
                className={`mt-1 text-[11px] leading-snug ${
                  t.isNoid ? "text-white/65" : "text-violetDeep/60"
                }`}>
                {subtitle}
              </p>
            </div>

            {/* QR + center mark */}
            <div className="relative px-6 pt-4 flex justify-center">
              <div className="relative inline-block">
                <div className={`absolute -inset-4 rounded-2xl border border-dashed pointer-events-none ${t.isNoid ? "border-white/25" : "border-violetDeep/25"}`} />
                <div className={`absolute -inset-1 rounded-xl blur-2xl pointer-events-none ${t.isNoid ? "bg-white/10" : "bg-violetDeep/15"}`} />

                <div className="relative rounded-xl p-3 border shadow-[0_18px_40px_-20px_rgba(48,26,96,0.5)]" style={{ background: "#F4EEFF", borderColor: "rgba(78,47,142,0.12)" }}>
                  {payload ? (
                    <QRCanvas
                      data={payload}
                      size={220}
                      // Dark-violet code on a pale-lilac tile — stays high-contrast
                      // and scannable inside either sheet.
                      fg="#2B1A55"
                      bg="#F0E9FE"
                    />
                  ) : (
                    <div className="h-[220px] w-[220px] flex items-center justify-center text-[11px] text-violetDeep/40">
                      No data
                    </div>
                  )}

                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="relative flex items-center justify-center">
                      <div className="absolute h-12 w-12 rounded-full shadow-[0_2px_8px_rgba(48,26,96,0.22)] border" style={{ background: "#F0E9FE", borderColor: "rgba(78,47,142,0.12)" }} />
                      <img
                        src={menoHat}
                        alt=""
                        style={{ mixBlendMode: "multiply" }}
                        className="relative h-10 w-10 object-contain drop-shadow-[0_3px_6px_rgba(48,26,96,0.35)]"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* payload text — the real wallet address in both modes */}
            <div className="relative px-6 pt-5">
              <div className={`rounded-xl p-3 ${t.card}`}>
                <p
                  className={`text-[9px] tracking-[0.3em] uppercase mb-1 ${t.textFaint}`}>
                  Wallet Address
                </p>
                <p
                  className={`font-mono text-[12px] break-all leading-snug ${
                    t.isNoid ? "text-white/85" : "text-violetDeep/80"
                  }`}>
                  {address}
                </p>
              </div>
            </div>

            <div className="relative px-6 pt-4 pb-6">
              <button
                onClick={handleCopy}
                className="w-full rounded-2xl py-3.5 font-display text-[12px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[1px] flex items-center justify-center gap-2"
                style={t.isNoid
                  ? { background: "linear-gradient(145deg, #F4EEFF, #C9B0FF)", color: "#3B2570" }
                  : { background: "#4E2F8E", color: "#F6EFFF" }}>
                {copied ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M2 7L5.5 10.5L12 4"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Copied!
                  </>
                ) : (
                  "Copy Address"
                )}
              </button>
              <p className={`mt-3 text-center font-serif italic text-[11px]  ${mode === "open" ? "text-violetDeep/45" : "text-white/70"}`}>
                {mode === "open"
                  ? "Yer keys, yer kingdom."
                  : "Two keys, one secret port."}
              </p>
            </div>
      </div>
    </LiquidSheet>
  )
}