/**
 * NoidModeView.tsx
 *
 * The private, "shadow waters" wallet view.
 *
 * The card heading is "NOID ADDRESS" but the displayed payload is the
 * pair (publicKey, zkPublicKey). A single "Copy" action copies both
 * joined by "|", which mirrors what the QR encodes in receive mode so
 * a wallet on the other side can scan one code and obtain both keys.
 *
 * Layout differs from Open Mode on purpose — Noid is a separate product
 * surface, so its primary action row is Mask / Unmask (placeholders for
 * the ZK ops you said are coming), and the wallet actions (Send /
 * Receive / Swap) sit underneath as a secondary row. Swap is "coming
 * soon"; Send is intentionally non-functional in Noid for now (per spec
 * "no other activities implemented for noid mode").
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

  const joinedKeys = `${noid.publicKey}|${noid.zkPublicKey ?? ""}`

  function copyJoinedKeys() {
    navigator.clipboard.writeText(joinedKeys)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function trunc(s: string, a = 10, b = 8) {
    if (!s) return ""
    return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
  }

  function fireToast(msg: string) {
    setToast({ show: true, msg })
  }

  return (
    <>
      {/* Noid address card — paired (publicKey + zkPublicKey) */}
      <div className="px-5 pt-5">
        <div className="relative rounded-3xl bg-ink text-bone overflow-hidden p-5">
          {/* indigo glow signals "noid waters" */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_15%,_rgba(74,108,182,0.35),transparent_55%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_85%,_rgba(232,174,58,0.22),transparent_55%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.03] [background-image:linear-gradient(to_right,#FBF1D9_1px,transparent_1px),linear-gradient(to_bottom,#FBF1D9_1px,transparent_1px)] [background-size:32px_32px]" />

          <div className="relative">
            <div className="flex items-start justify-between mb-4">
              <div className="min-w-0">
                <p className="text-[9px] tracking-[0.4em] uppercase text-bone/45 mb-1">
                  Noid Address
                </p>
                <p className="font-serif italic text-[10px] text-bone/40">
                  PublicKey · ZkPublicKey
                </p>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bone/10 border border-bone/15 shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-goldDeep" />
                <span className="text-[9px] tracking-[0.3em] uppercase text-bone/60">
                  Private
                </span>
              </div>
            </div>

            {/* paired keys */}
            <div className="space-y-2 mb-5">
              <div className="rounded-xl bg-bone/[0.06] border border-bone/12 p-2.5">
                <p className="text-[8px] tracking-[0.35em] uppercase text-bone/40 mb-0.5">
                  Public Key
                </p>
                <p className="font-mono text-[11px] text-bone/85 break-all leading-snug">
                  {trunc(noid.publicKey, 12, 10)}
                </p>
              </div>
              <div className="rounded-xl bg-goldDeep/[0.08] border border-goldDeep/25 p-2.5">
                <p className="text-[8px] tracking-[0.35em] uppercase text-goldDeep mb-0.5">
                  ZK Public Key
                </p>
                <p className="font-mono text-[11px] text-bone/85 break-all leading-snug">
                  {trunc(noid.zkPublicKey ?? "", 12, 10)}
                </p>
              </div>
            </div>

            {/* single copy action — copies both joined */}
            <button
              onClick={copyJoinedKeys}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-bone/10 hover:bg-bone/15 border border-bone/15 py-2 text-[10px] tracking-[0.3em] uppercase text-bone/85 transition-colors">
              {copied ? (
                <>
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path
                      d="M2 6L4.5 8.5L9 3"
                      stroke="#E8AE3A"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Copied both keys
                </>
              ) : (
                <>
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <rect
                      x="3"
                      y="3"
                      width="7"
                      height="7"
                      rx="1.2"
                      stroke="currentColor"
                      strokeOpacity="0.8"
                      strokeWidth="1"
                    />
                    <path
                      d="M1 7.5V1.5a1 1 0 011-1h6"
                      stroke="currentColor"
                      strokeOpacity="0.8"
                      strokeWidth="1"
                      strokeLinecap="round"
                    />
                  </svg>
                  Copy both keys
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mask / Unmask row — Noid-only top actions */}
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

      {/* Wallet actions — Send disabled in Noid per spec */}
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
              {/* skull ZK glyph */}
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