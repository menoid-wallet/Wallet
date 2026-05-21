/**
 * OpenModeView.tsx
 *
 * The public, "open seas" wallet view.
 *  - Treasury card with live balance (polled every 5s)
 *  - Send / Receive / Swap action tiles
 *  - Recent transactions log with expandable rows
 *
 * Polling lifecycle:
 *  - We poll every 5s while mounted and visible.
 *  - On `visibilitychange`, we pause polling when hidden and refresh
 *    immediately when the tab comes back — this avoids hammering the
 *    RPC for popups that are open in the background.
 *  - We also expose a `bumpRefresh` callback that the Send modal calls
 *    after broadcast so the user sees their tx land without waiting.
 */

import React, { useCallback, useEffect, useRef, useState } from "react"
import { useWallet } from "../../context/WalletContext"
import ActionTile from "../shared/ActionTile"
import ComingSoonToast from "../shared/ComingSoonToast"
import ReceiveModal from "../shared/ReceiveModal"
import SendModal from "../shared/SendModal"
import TxHistoryList from "../shared/TxHistoryList"
import {
  getBalance,
  getTxHistory,
  type TxHistoryItem
} from "../../lib/monadRpc"

const POLL_MS = 5_000

export default function OpenModeView() {
  const { wallet } = useWallet()
  const account = wallet?.normalAccount

  const [balance, setBalance] = useState<string>("0")
  const [txs, setTxs] = useState<TxHistoryItem[]>([])
  const [txLoading, setTxLoading] = useState(true)
  const [showReceive, setShowReceive] = useState(false)
  const [showSend, setShowSend] = useState(false)
  const [showSwapToast, setShowSwapToast] = useState(false)
  const [copiedAddr, setCopiedAddr] = useState(false)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  const refreshAll = useCallback(async () => {
    if (!account) return
    try {
      const [b, h] = await Promise.all([
        getBalance(account.address),
        getTxHistory(account.address, 20)
      ])
      if (!mountedRef.current) return
      setBalance(b)
      setTxs(h)
    } catch {
      /* silent — UI keeps last good values */
    } finally {
      if (mountedRef.current) setTxLoading(false)
    }
  }, [account])

  // initial + polling
  useEffect(() => {
    mountedRef.current = true
    void refreshAll()
    intervalRef.current = setInterval(() => {
      if (!document.hidden) void refreshAll()
    }, POLL_MS)

    const onVis = () => {
      if (!document.hidden) void refreshAll()
    }
    document.addEventListener("visibilitychange", onVis)
    return () => {
      mountedRef.current = false
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [refreshAll])

  if (!account) return null

  function trunc(s: string, a = 6, b = 4) {
    return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
  }

  function copyAddress() {
    navigator.clipboard.writeText(account.address)
    setCopiedAddr(true)
    setTimeout(() => setCopiedAddr(false), 1500)
  }

  return (
    <>
      {/* Treasury card */}
      <div className="px-5 pt-5">
        <div className="relative rounded-3xl bg-ink text-bone overflow-hidden p-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_15%,_rgba(232,174,58,0.35),transparent_55%)]" />
          {/* subtle rope grid */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.03] [background-image:linear-gradient(to_right,#FBF1D9_1px,transparent_1px),linear-gradient(to_bottom,#FBF1D9_1px,transparent_1px)] [background-size:32px_32px]" />

          <div className="relative">
            <div className="flex items-start justify-between mb-5">
              <div>
                <p className="text-[9px] tracking-[0.4em] uppercase text-bone/45 mb-1">
                  Wallet Address
                </p>
                <button
                  onClick={copyAddress}
                  className="flex items-center gap-1.5 font-mono text-[12px] text-bone/80 hover:text-bone transition-colors">
                  {trunc(account.address)}
                  {copiedAddr ? (
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
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bone/10 border border-bone/15">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="text-[9px] tracking-[0.3em] uppercase text-bone/60">
                  Monad
                </span>
              </div>
            </div>

            <div className="mb-1">
              <p className="text-[9px] tracking-[0.35em] uppercase text-bone/40 mb-1">
                Treasury
              </p>
              <p className="font-display text-[36px] font-bold tracking-[-0.025em] leading-none">
                {formatBalance(balance)}
                <span className="text-[18px] text-bone/50 ml-1.5">MON</span>
              </p>
            </div>
            <p className="text-[11px] text-bone/35">≈ $0.00 USD</p>
          </div>
        </div>
      </div>

      {/* Action tiles */}
      <div className="px-5 mt-4 grid grid-cols-3 gap-2">
        <ActionTile
          label="Send"
          glyph="send"
          onClick={() => setShowSend(true)}
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
          onClick={() => setShowSwapToast(true)}
        />
      </div>

      {/* Activity */}
      <div className="px-5 mt-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[9px] tracking-[0.4em] uppercase text-ink/40">
            Ship&apos;s Log
          </p>
          <button
            onClick={() => {
              setTxLoading(true)
              void refreshAll()
            }}
            className="text-[9px] tracking-[0.3em] uppercase text-goldDeep hover:text-goldDeeper transition-colors">
            Refresh
          </button>
        </div>
        <TxHistoryList items={txs} loading={txLoading} />
      </div>

      <ReceiveModal
        open={showReceive}
        onClose={() => setShowReceive(false)}
        mode="open"
        address={account.address}
      />
      <SendModal
        open={showSend}
        onClose={() => setShowSend(false)}
        fromAddress={account.address}
        privateKey={account.privateKey}
        balance={balance}
        onSent={() => {
          // immediate refresh so the user sees their tx land
          void refreshAll()
        }}
      />
      <ComingSoonToast
        show={showSwapToast}
        onDone={() => setShowSwapToast(false)}
      />
    </>
  )
}

function formatBalance(b: string): string {
  const n = Number(b)
  if (!Number.isFinite(n)) return "0.00"
  if (n === 0) return "0.00"
  if (n < 0.0001) return n.toExponential(2)
  if (n < 1) return n.toFixed(4)
  if (n < 1000) return n.toFixed(2)
  return n.toFixed(2)
}