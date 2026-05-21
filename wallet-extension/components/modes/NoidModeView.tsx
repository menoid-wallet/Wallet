/**
 * NoidModeView.tsx
 *
 * Private "shadow waters" wallet view.
 *
 * NEW in this revision:
 *   - Balance is now LIVE, sourced from PoolContext.formattedBalance and
 *     animated with the same odometer component as Open mode. The card
 *     also surfaces a tiny sync indicator (a soft gold pulse when a
 *     /state/latest poll is in flight) and a relative "last synced" line.
 *   - The Mask button now opens MaskModal instead of firing a coming-soon
 *     toast. Unmask is still a placeholder pending the withdraw circuit.
 *   - We need the OPEN balance (public MON in the normal account) to know
 *     how much the user can mask. We fetch it here with the existing
 *     monadRpc.getBalance helper. Lightweight — refreshed when the modal
 *     opens or after a successful mask.
 *
 * Layout matches Open mode for consistency.
 */

import React, { useCallback, useEffect, useRef, useState } from "react"
import { useWallet } from "../../context/WalletContext"
import { usePool } from "../../context/PoolContext"
import { getBalance } from "../../lib/monadRpc"
import ActionTile from "../shared/ActionTile"
import AnimatedNumber from "../shared/AnimatedNumber"
import ComingSoonToast from "../shared/ComingSoonToast"
import MaskModal from "../shared/MaskModal"
import ReceiveModal from "../shared/ReceiveModal"

const OPEN_BALANCE_POLL_MS = 8_000

export default function NoidModeView() {
  const { wallet } = useWallet()
  const noid = wallet?.noidAccount
  const normal = wallet?.normalAccount

  const {
    formattedBalance,
    syncing,
    lastSyncedAt,
    allUnspentUTXOs,
    error: poolError
  } = usePool()

  const [openBalance, setOpenBalance] = useState<string>("0")
  const [showReceive, setShowReceive] = useState(false)
  const [showMask, setShowMask] = useState(false)
  const [toast, setToast] = useState<{ show: boolean; msg?: string }>({
    show: false
  })
  const [copied, setCopied] = useState(false)
  const mountedRef = useRef(true)

  // Pull open balance (we need it to know how much the user can mask).
  const refreshOpenBalance = useCallback(async () => {
    if (!normal) return
    try {
      const b = await getBalance(normal.address)
      if (mountedRef.current) setOpenBalance(b)
    } catch (e) {
      console.error("[NoidMode] open balance fetch failed:", e)
    }
  }, [normal])

  useEffect(() => {
    mountedRef.current = true
    void refreshOpenBalance()
    const id = setInterval(() => {
      if (!document.hidden) void refreshOpenBalance()
    }, OPEN_BALANCE_POLL_MS)
    return () => {
      mountedRef.current = false
      clearInterval(id)
    }
  }, [refreshOpenBalance])

  if (!noid) return null

  const joinedKey = `${noid.publicKey}|${noid.zkPublicKey ?? ""}`

  function copyJoined() {
    navigator.clipboard.writeText(joinedKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function truncJoined(): string {
    if (joinedKey.length <= 18) return joinedKey
    return `${joinedKey.slice(0, 10)}…${joinedKey.slice(-6)}`
  }

  function fireToast(msg: string) {
    setToast({ show: true, msg })
  }

  // "Synced 4s ago" — pithy and matches the parchment vibe
  function syncedLabel(): string {
    if (!lastSyncedAt) return "Awaiting first sync…"
    const sec = Math.max(1, Math.round((Date.now() - lastSyncedAt) / 1000))
    if (sec < 60) return `Synced ${sec}s ago`
    const min = Math.round(sec / 60)
    return `Synced ${min}m ago`
  }

  // Tick the "synced Xs ago" label every 5s without forcing PoolContext
  // re-renders. Cheap local timer just for cosmetics.
  const [, forceTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      {/* ─── Treasury card ─── */}
      <div className="px-5 pt-5">
        <div className="relative rounded-3xl bg-inkSoft text-bone border border-bone/10 overflow-hidden p-5 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.7)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_15%,_rgba(232,174,58,0.32),transparent_55%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_85%,_rgba(163,110,20,0.22),transparent_55%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:linear-gradient(to_right,#FBF1D9_1px,transparent_1px),linear-gradient(to_bottom,#FBF1D9_1px,transparent_1px)] [background-size:32px_32px]" />

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
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 11 11"
                      fill="none">
                      <path
                        d="M2 6L4.5 8.5L9 3"
                        stroke="#E8AE3A"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 11 11"
                      fill="none">
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
                <span
                  className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                    syncing ? "bg-goldDeep animate-pulse" : "bg-goldDeep"
                  }`}
                />
                <span className="text-[9px] tracking-[0.3em] uppercase text-bone/60">
                  Private
                </span>
              </div>
            </div>

            <div className="mb-1">
              <p className="text-[9px] tracking-[0.35em] uppercase text-bone/40 mb-1">
                Treasury
              </p>
              <div className="font-display font-bold tracking-[-0.025em] leading-none text-bone flex items-baseline">
                <AnimatedNumber
                  value={formattedBalance}
                  height={36}
                  className="text-[36px]"
                  duration={650}
                />
                <span className="text-[18px] text-bone/50 ml-1.5">MON</span>
              </div>
            </div>
            <p className="text-[11px] text-bone/35">
              {poolError
                ? "Couldn't reach indexer — retrying…"
                : `${syncedLabel()} · ${allUnspentUTXOs.length} note${
                    allUnspentUTXOs.length === 1 ? "" : "s"
                  }`}
            </p>
          </div>
        </div>
      </div>

      {/* ─── ZK ops row ─── */}
      <div className="px-5 mt-4">
        <p className="text-[9px] tracking-[0.4em] uppercase text-bone/45 mb-2">
          ZK Operations
        </p>
        <div className="grid grid-cols-2 gap-2">
          <ActionTile
            label="Mask"
            glyph="mask"
            tone="bone"
            onClick={() => {
              void refreshOpenBalance()
              setShowMask(true)
            }}
          />
          <ActionTile
            label="Unmask"
            glyph="unmask"
            tone="bone"
            onClick={() => fireToast("Unmask flow is coming soon.")}
          />
        </div>
      </div>

      {/* ─── Wallet actions ─── */}
      <div className="px-5 mt-4">
        <p className="text-[9px] tracking-[0.4em] uppercase text-bone/45 mb-2">
          Wallet
        </p>
        <div className="grid grid-cols-3 gap-2">
          <ActionTile
            label="Send"
            glyph="send"
            tone="boneSoft"
            onClick={() => fireToast("Noid Send is coming soon.")}
          />
          <ActionTile
            label="Receive"
            glyph="receive"
            tone="bone"
            onClick={() => setShowReceive(true)}
          />
          <ActionTile
            label="Swap"
            glyph="swap"
            tone="boneSoft"
            onClick={() => fireToast("Swap is on the horizon. Coming soon.")}
          />
        </div>
      </div>

      {/* ─── Open balance hint (so user knows what they have to mask) ─── */}
      <div className="px-5 mt-4">
        <div className="rounded-2xl bg-bone/[0.05] border border-bone/15 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            <span className="text-[10px] tracking-[0.3em] uppercase text-bone/60">
              Open Balance
            </span>
          </div>
          <span className="font-mono text-[12px] text-bone/85">
            {Number(openBalance).toFixed(4)} MON
          </span>
        </div>
      </div>

      {/* ─── Noid info card ─── */}
      <div className="px-5 mt-4 mb-6">
        <div className="relative rounded-2xl bg-bone/[0.04] border border-bone/15 p-4 overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_10%_0%,_rgba(232,174,58,0.18),transparent_55%)]" />
          <div className="relative flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/15 border border-gold/30">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 1.5C5 1.5 3 3.5 3 6.2c0 1.7 1 3 1.8 3.6.4.3.7.7.7 1.2v0.5c0 .8.7 1.5 1.5 1.5h4c.8 0 1.5-.7 1.5-1.5V11c0-.5.3-.9.7-1.2C13 9.2 14 7.9 14 6.2 14 3.5 11 1.5 8 1.5Z"
                  className="goldDeep-stroke"
                  strokeWidth="1.2"
                />
                <circle cx="6" cy="6.5" r="0.8" className="goldDeep-fill" />
                <circle cx="10" cy="6.5" r="0.8" className="goldDeep-fill" />
                <path
                  d="M7 9.5l1 1 1-1"
                  className="goldDeep-stroke"
                  strokeWidth="1"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-[9px] tracking-[0.35em] uppercase text-gold mb-1">
                Private Waters
              </p>
              <p className="text-[12px] text-bone/70 leading-snug">
                Mask MON from the open account to slip into shadow. Each
                masked note is a Poseidon commitment only you can spend.
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

      <MaskModal
        open={showMask}
        onClose={() => {
          setShowMask(false)
          void refreshOpenBalance()
        }}
        openBalance={openBalance}
      />

      <ComingSoonToast
        show={toast.show}
        onDone={() => setToast({ show: false })}
        message={toast.msg}
      />
    </>
  )
}