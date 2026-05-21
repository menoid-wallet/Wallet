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
import ModalPortal from "./ModalPortal"
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
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)

  // Two-phase enter/exit so the slide animation runs both ways
  useEffect(() => {
    if (open) {
      setMounted(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    } else if (mounted) {
      setVisible(false)
      const t = setTimeout(() => setMounted(false), 320)
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
    <ModalPortal>
      <div className="fixed inset-0 z-[2147483000] flex items-end justify-center overflow-hidden">
        {/* backdrop */}
        <button
          aria-label="Close"
          onClick={onClose}
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
                {mode === "open" ? "Open Mode" : "Noid Mode"}
              </p>
              <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]">
                {title}
              </h3>
              <p className="mt-1 text-[11px] text-ink/55 leading-snug">
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
                <div className="rounded-xl bg-ink/[0.05] border border-ink/10 p-3">
                  <p className="text-[9px] tracking-[0.3em] uppercase text-ink/40 mb-1">
                    Wallet Address
                  </p>
                  <p className="font-mono text-[12px] text-ink/80 break-all leading-snug">
                    {address}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="rounded-xl bg-ink/[0.05] border border-ink/10 p-3">
                    <p className="text-[9px] tracking-[0.3em] uppercase text-ink/40 mb-1">
                      Public Key
                    </p>
                    <p className="font-mono text-[11px] text-ink/80 break-all leading-snug">
                      {trunc(publicKey ?? "", 14, 14)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-ink/[0.05] border border-ink/10 p-3">
                    <p className="text-[9px] tracking-[0.3em] uppercase text-goldDeep mb-1">
                      ZK Public Key
                    </p>
                    <p className="font-mono text-[11px] text-ink/80 break-all leading-snug">
                      {trunc(zkPublicKey ?? "", 14, 14)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="relative px-6 pt-4 pb-6">
              <button
                onClick={handleCopy}
                className="w-full rounded-2xl bg-ink text-bone py-3.5 font-display text-[12px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[1px] flex items-center justify-center gap-2">
                {copied ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M2 7L5.5 10.5L12 4"
                        stroke="#E8AE3A"
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
                  "Copy Both Keys"
                )}
              </button>
              <p className="mt-3 text-center font-serif italic text-[11px] text-ink/40">
                {mode === "open"
                  ? "Yer keys, yer kingdom."
                  : "Two keys, one secret port."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}