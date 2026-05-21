/**
 * NoidModeView.tsx
 *
 * Private "shadow waters" wallet view.
 *
 * Layout mirrors Open mode for consistency:
 *   - Top card with one labeled identifier ("Noid Key") + a static 0
 *     MON balance. The identifier shown is `publicKey|zkPublicKey`
 *     truncated like an address. Tapping it copies the FULL joined
 *     string (no truncation) — that's the same payload encoded by the
 *     receive QR, so a counterparty scanning gets both keys at once.
 *   - Top row: Mask / Unmask (placeholders).
 *   - Bottom row: Send (placeholder), Receive (QR), Swap (toast).
 *
 * Balance is intentionally static "0 MON" until the ZK accounting layer
 * lands.
 */

import React, { useState } from "react"
import { useWallet } from "../../context/WalletContext"
import ActionTile from "../shared/ActionTile"
import ComingSoonToast from "../shared/ComingSoonToast"
import ReceiveModal from "../shared/ReceiveModal"

export default function NoidModeView() {
  const { wallet } = useWallet()
  const noid = wallet?.noidAccount as
    | {
        address: string
        privateKey: string
        publicKey: string
        zkSecretKey?: string
        zkPublicKey?: string
      }
    | undefined

  const [showReceive, setShowReceive] = useState(false)
  const [toast, setToast] = useState<{ show: boolean; msg?: string }>({
    show: false
  })
  const [copied, setCopied] = useState(false)

  if (!noid) return null

  // The "Noid key" is the publicKey + zkPublicKey concatenated with "|".
  // This is what we copy AND what we encode in the receive QR.
  const joinedKey = `${noid.publicKey}|${noid.zkPublicKey ?? ""}`

  function copyJoined() {
    navigator.clipboard.writeText(joinedKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function truncJoined(): string {
    // Mirror an Ethereum-address truncation: first few + ellipsis + last few.
    // Since the joined string is much longer than an address we keep more
    // chars so it's still visually distinctive.
    if (joinedKey.length <= 18) return joinedKey
    return `${joinedKey.slice(0, 10)}…${joinedKey.slice(-6)}`
  }

  function fireToast(msg: string) {
    setToast({ show: true, msg })
  }

  return (
    <>
      {/* Noid Key card — same shape as Open's treasury card */}
      <div className="px-5 pt-5">
        <div className="relative rounded-3xl bg-ink text-bone overflow-hidden p-5">
          {/* indigo glow signals "noid waters" */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_15%,_rgba(74,108,182,0.35),transparent_55%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_85%,_rgba(232,174,58,0.22),transparent_55%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.03] [background-image:linear-gradient(to_right,#FBF1D9_1px,transparent_1px),linear-gradient(to_bottom,#FBF1D9_1px,transparent_1px)] [background-size:32px_32px]" />

          <div className="relative">
            <div className="flex items-start justify-between mb-5">
              <div className="min-w-0">
                <p className="text-[9px] tracking-[0.4em] uppercase text-bone/45 mb-1">
                  Noid Key
                </p>
                <button
                  onClick={copyJoined}
                  title={joinedKey}
                  className="flex items-center gap-1.5 font-mono text-[12px] text-bone/80 hover:text-bone transition-colors">
                  {truncJoined()}
                  {copied ? (
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                      <path
                        d="M2 6L4.5 8.5L9 3"
                        stroke="#E8AE3A"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                      <rect
                        x="3"
                        y="3"
                        width="7"
                        height="7"
                        rx="1.2"
                        stroke="currentColor"
                        strokeOpacity="0.6"
                        strokeWidth="1"
                      />
                      <path
                        d="M1 7.5V1.5a1 1 0 011-1h6"
                        stroke="currentColor"
                        strokeOpacity="0.6"
                        strokeWidth="1"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </button>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bone/10 border border-bone/15 shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-goldDeep" />
                <span className="text-[9px] tracking-[0.3em] uppercase text-bone/60">
                  Private
                </span>
              </div>
            </div>

            <div className="mb-1">
              <p className="text-[9px] tracking-[0.35em] uppercase text-bone/40 mb-1">
                Treasury
              </p>
              <p className="font-display text-[36px] font-bold tracking-[-0.025em] leading-none">
                0.00
                <span className="text-[18px] text-bone/50 ml-1.5">MON</span>
              </p>
            </div>
            <p className="text-[11px] text-bone/35">
              Private balance — coming soon
            </p>
          </div>
        </div>
      </div>

      {/* ZK ops row */}
      <div className="px-5 mt-4">
        <p className="text-[9px] tracking-[0.4em] uppercase text-ink/40 mb-2">
          ZK Operations
        </p>
        <div className="grid grid-cols-2 gap-2">
          <ActionTile
            label="Mask"
            glyph="mask"
            tone="ink"
            onClick={() => fireToast("Mask flow is coming soon.")}
          />
          <ActionTile
            label="Unmask"
            glyph="unmask"
            tone="ink"
            onClick={() => fireToast("Unmask flow is coming soon.")}
          />
        </div>
      </div>

      {/* Wallet actions */}
      <div className="px-5 mt-4">
        <p className="text-[9px] tracking-[0.4em] uppercase text-ink/40 mb-2">
          Wallet
        </p>
        <div className="grid grid-cols-3 gap-2">
          <ActionTile
            label="Send"
            glyph="send"
            tone="muted"
            onClick={() => fireToast("Noid Send is coming soon.")}
          />
          <ActionTile
            label="Receive"
            glyph="receive"
            onClick={() => setShowReceive(true)}
          />
          <ActionTile
            label="Swap"
            glyph="swap"
            tone="muted"
            onClick={() => fireToast("Swap is on the horizon. Coming soon.")}
          />
        </div>
      </div>

      {/* Noid info card */}
      <div className="px-5 mt-5 mb-6">
        <div className="relative rounded-2xl bg-ink/[0.04] border border-ink/10 p-4 overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_10%_0%,_rgba(232,174,58,0.18),transparent_55%)]" />
          <div className="relative flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-goldDeep/15 border border-goldDeep/25">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 1.5C5 1.5 3 3.5 3 6.2c0 1.7 1 3 1.8 3.6.4.3.7.7.7 1.2v0.5c0 .8.7 1.5 1.5 1.5h4c.8 0 1.5-.7 1.5-1.5V11c0-.5.3-.9.7-1.2C13 9.2 14 7.9 14 6.2 14 3.5 11 1.5 8 1.5Z"
                  stroke="#A36E14"
                  strokeWidth="1.2"
                />
                <circle cx="6" cy="6.5" r="0.8" fill="#A36E14" />
                <circle cx="10" cy="6.5" r="0.8" fill="#A36E14" />
                <path
                  d="M7 9.5l1 1 1-1"
                  stroke="#A36E14"
                  strokeWidth="1"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-[9px] tracking-[0.35em] uppercase text-goldDeep mb-1">
                Private Waters
              </p>
              <p className="text-[12px] text-ink/70 leading-snug">
                Noid mode uses Poseidon-derived ZK keys. Mask, unmask, and
                private receive — your transactions sail uncharted seas.
              </p>
            </div>
          </div>
        </div>
      </div>

      <ReceiveModal
        open={showReceive}
        onClose={() => setShowReceive(false)}
        mode="noid"
        publicKey={noid.publicKey}
        zkPublicKey={noid.zkPublicKey}
      />
      <ComingSoonToast
        show={toast.show}
        onDone={() => setToast({ show: false })}
        message={toast.msg}
      />
    </>
  )
}