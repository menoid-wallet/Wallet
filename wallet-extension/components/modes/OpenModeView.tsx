/**
 * OpenModeView.tsx
 *
 * Public "open seas" wallet view.
 *  - Treasury card with live balance polled every 5s.
 *  - The balance display uses AnimatedNumber so each digit rolls into
 *    its new value when the polled balance changes.
 *  - Send / Receive / Swap action tiles.
 *  - Transaction history is intentionally a placeholder card right now
 *    (the explorer API was unreliable). The slot is reserved for when
 *    we wire up a real indexer.
 *
 * Polling lifecycle:
 *   - Poll every 5s while mounted.
 *   - Pause when document.hidden, refresh immediately when visible again.
 *   - Send modal calls onSent → we trigger an immediate refresh too.
 */

import React, { useCallback, useEffect, useRef, useState } from "react"
import { useWallet } from "../../context/WalletContext"
import { getBalance } from "../../lib/monadRpc"
import ActionTile from "../shared/ActionTile"
import AnimatedNumber from "../shared/AnimatedNumber"
import ComingSoonToast from "../shared/ComingSoonToast"
import ReceiveModal from "../shared/ReceiveModal"
import SendModal from "../shared/SendModal"

const POLL_MS = 5_000

export default function OpenModeView() {
  const { wallet } = useWallet()
  const account = wallet?.normalAccount

  const [balance, setBalance] = useState<string>("0")
  const [balanceLoading, setBalanceLoading] = useState(true)
  const [balanceErr, setBalanceErr] = useState(false)
  const [showReceive, setShowReceive] = useState(false)
  const [showSend, setShowSend] = useState(false)
  const [showSwapToast, setShowSwapToast] = useState(false)
  const [copiedAddr, setCopiedAddr] = useState(false)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  const refreshBalance = useCallback(async () => {
    if (!account) return
    try {
      const b = await getBalance(account.address)
      if (!mountedRef.current) return
      setBalance(b)
      setBalanceErr(false)
    } catch (e) {
      console.error("[OpenMode] balance fetch failed:", e)
      if (mountedRef.current) setBalanceErr(true)
    } finally {
      if (mountedRef.current) setBalanceLoading(false)
    }
  }, [account])

  useEffect(() => {
    mountedRef.current = true
    void refreshBalance()
    intervalRef.current = setInterval(() => {
      if (!document.hidden) void refreshBalance()
    }, POLL_MS)
    const onVis = () => {
      if (!document.hidden) void refreshBalance()
    }
    document.addEventListener("visibilitychange", onVis)
    return () => {
      mountedRef.current = false
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [refreshBalance])

  if (!account) return null

  function trunc(s: string, a = 6, b = 4) {
    return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
  }

  function copyAddress() {
    navigator.clipboard.writeText(account.address)
    setCopiedAddr(true)
    setTimeout(() => setCopiedAddr(false), 1500)
  }

  const formatted = formatBalance(balance)

  return (
    <>
      {/* Treasury card */}
      <div className="px-5 pt-5">
        <div className="relative rounded-3xl bg-ink text-bone overflow-hidden p-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_15%,_rgba(232,174,58,0.35),transparent_55%)]" />
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
              <div className="font-display font-bold tracking-[-0.025em] leading-none text-bone flex items-baseline">
                {balanceLoading ? (
                  <span
                    className="inline-block h-9 w-32 rounded-md bg-bone/10 animate-pulse"
                    aria-label="Loading balance"
                  />
                ) : (
                  <AnimatedNumber
                    value={formatted}
                    height={36}
                    className="text-[36px]"
                    duration={650}
                  />
                )}
                <span className="text-[18px] text-bone/50 ml-1.5">MON</span>
              </div>
            </div>
            <p className="text-[11px] text-bone/35">
              {balanceErr ? "Couldn't reach Monad RPC — retrying…" : "≈ $0.00 USD"}
            </p>
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

      {/* Ship's Log placeholder — real tx history coming soon */}
      <div className="px-5 mt-5 mb-6">
        <p className="text-[9px] tracking-[0.4em] uppercase text-ink/40 mb-3">
          Ship&apos;s Log
        </p>
        <div className="relative flex flex-col items-center justify-center py-10 rounded-2xl border border-dashed border-ink/15 overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,_rgba(232,174,58,0.12),transparent_60%)]" />
          <span className="relative text-3xl mb-2">📜</span>
          <p className="relative text-[12px] text-ink/50 font-serif italic">
            Transaction history coming soon
          </p>
          <p className="relative text-[10px] text-ink/35 mt-1 tracking-[0.2em] uppercase">
            Awaiting fair winds
          </p>
        </div>
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
          void refreshBalance()
        }}
      />
      <ComingSoonToast
        show={showSwapToast}
        onDone={() => setShowSwapToast(false)}
      />
    </>
  )
}

/** Format a wei-as-decimal-string into a UI string with stable digit count.
 *  The stable digit count matters because AnimatedNumber animates *positions*,
 *  so jumping from "0.50" to "1.2345" looks janky. We round to 4 decimals. */
function formatBalance(b: string): string {
  const n = Number(b)
  if (!Number.isFinite(n) || n === 0) return "0.0000"
  // For very small balances show 6 dp, otherwise 4
  if (n < 0.0001) return n.toFixed(6)
  return n.toFixed(4)
}