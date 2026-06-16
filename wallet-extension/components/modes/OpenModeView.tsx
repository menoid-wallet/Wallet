/**
 * OpenModeView.tsx — Liquid iOS Edition v2
 *
 * Same liquid design, refined transitions to feel more responsive.
 * The scroll feel is controlled by WalletHome's useLiquidScroll hook.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useWallet } from "../../context/WalletContext"
import { getBalance } from "../../lib/rpc"
import AnimatedNumber from "../shared/AnimatedNumber"
import ComingSoonToast from "../shared/ComingSoonToast"
import ReceiveModal from "../shared/ReceiveModal"
import SendModal from "../shared/SendModal"
import ShipsLogEntries from "../shared/ShipsLogEntries"
import { loadOpenTxns, TX_UPDATE_EVENT } from "../../lib/txStore"
import type { TxEntry } from "../../lib/txStore"

const POLL_MS = 5_000
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)"
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)"

/* ───────────────────────── Liquid press (spring physics) ───────────────────────── */
function LiquidPress({
  children,
  onClick,
  disabled,
  className = "",
  style = {}
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const [pressed, setPressed] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      className={className}
      style={{
        transform: pressed ? "scale(0.94)" : "scale(1)",
        transition: `transform 400ms ${SPRING}`,
        ...style
      }}>
      {children}
    </button>
  )
}

export default function OpenModeView() {
  const { wallet, entries, activeIndex, activeNetwork, networkConfig } = useWallet()
  const account = useMemo(() => {
    if (activeNetwork === "solana") return wallet?.solanaAccount
    if (activeNetwork === "sui") return wallet?.suiAccount
    if (activeNetwork === "aptos") return wallet?.aptosAccount
    return wallet?.normalAccount
  }, [wallet, activeNetwork])
  const noidAccount = wallet?.noidAccount

  const [balance, setBalance] = useState<string>("0")
  const [balanceErr, setBalanceErr] = useState(false)
  const [showReceive, setShowReceive] = useState(false)
  const [showSend, setShowSend] = useState(false)
  const [showSwapToast, setShowSwapToast] = useState(false)
  const [copiedAddr, setCopiedAddr] = useState(false)
  const [copiedNoid, setCopiedNoid] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [txEntries, setTxEntries] = useState<TxEntry[]>([])


  // Reset balance immediately when network switches so stale value doesn't linger
  useEffect(() => {
    setBalance("0")
    setBalanceErr(false)
  }, [activeNetwork])

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  const refreshBalance = useCallback(async () => {
    if (!account) return
    try {
      const b = await getBalance(account.address, activeNetwork)
      if (!mountedRef.current) return
      setBalance(b)
      setBalanceErr(false)
    } catch (e) {
      console.error("[OpenMode] balance fetch failed:", e)
      if (mountedRef.current) setBalanceErr(true)
    }
  }, [account, activeNetwork])

  useEffect(() => {
    mountedRef.current = true
    void refreshBalance()
    intervalRef.current = setInterval(() => {
      if (!document.hidden) void refreshBalance()
    }, POLL_MS)
    const onVis = () => { if (!document.hidden) void refreshBalance() }
    document.addEventListener("visibilitychange", onVis)
    requestAnimationFrame(() => setMounted(true))
    return () => {
      mountedRef.current = false
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [refreshBalance])

  // Load tx history — refresh on focus AND immediately after any save
  useEffect(() => {
    if (!account) return
    const load = () => setTxEntries(loadOpenTxns(account.address))
    load()
    window.addEventListener("focus", load)
    window.addEventListener(TX_UPDATE_EVENT, load)
    return () => {
      window.removeEventListener("focus", load)
      window.removeEventListener(TX_UPDATE_EVENT, load)
    }
  }, [account])

  function reloadTxEntries() {
    if (!account) return
    setTxEntries(loadOpenTxns(account.address))
  }

  if (!account) return null

  function trunc(s: string, a = 9, b = 5) {
    return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
  }

  function copyAddress() {
    navigator.clipboard.writeText(account.address)
    setCopiedAddr(true)
    setTimeout(() => setCopiedAddr(false), 1500)
  }

  function copyNoidKey() {
    if (!noidAccount) return
    const joined = `${noidAccount.publicKey}|${noidAccount.zkPublicKey}`
    navigator.clipboard.writeText(joined)
    setCopiedNoid(true)
    setTimeout(() => setCopiedNoid(false), 1500)
  }

  const activeEntry = entries[activeIndex]

  const formatted = formatBalance(balance)

  return (
    <div className="relative">
      {/* ── Background grid layer (mirrors ConnectApprovalModal open backdrop) ── */}
      <div className="pointer-events-none fixed inset-0 -z-10" style={{
        opacity: 0.035,
        backgroundImage: "linear-gradient(to right,#171311 1px,transparent 1px),linear-gradient(to bottom,#171311 1px,transparent 1px)",
        backgroundSize: "28px 28px",
      }} />
      <div className="pointer-events-none fixed inset-0 -z-10" style={{
        top: "-18%", right: "-12%", width: 260, height: 260,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(232,174,58,0.18) 0%, transparent 60%)",
        filter: "blur(48px)",
        animation: "openBgOrb1 14s ease-in-out infinite",
      }} />
      <div className="pointer-events-none fixed inset-0 -z-10" style={{
        bottom: "-15%", left: "-10%", width: 240, height: 240,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(163,110,20,0.14) 0%, transparent 60%)",
        filter: "blur(52px)",
        animation: "openBgOrb2 11s ease-in-out infinite 3s",
      }} />

      {/* ─── HERO TREASURY CARD ─── */}
      <div
        className="px-4 pt-5"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0) scale(1)" : "translateY(20px) scale(0.96)",
          filter: mounted ? "blur(0)" : "blur(8px)",
          transition: `all 700ms ${SPRING}`
        }}>
        <div
          className="relative rounded-[32px] overflow-hidden"
          style={{
            background: "linear-gradient(145deg, #1A1410 0%, #0D0A07 60%, #171311 100%)",
            boxShadow:
              "0 30px 60px -20px rgba(0,0,0,0.8), 0 8px 24px -8px rgba(232,174,58,0.15), inset 0 1px 0 rgba(251,241,217,0.08)"
          }}>
          <div
            className="pointer-events-none absolute"
            style={{
              top: "-30%",
              right: "-10%",
              width: 240,
              height: 240,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(232,174,58,0.4) 0%, transparent 60%)",
              filter: "blur(40px)",
              animation: "treasureOrb1 12s ease-in-out infinite"
            }}
          />
          <div
            className="pointer-events-none absolute"
            style={{
              bottom: "-20%",
              left: "-15%",
              width: 200,
              height: 200,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(163,110,20,0.3) 0%, transparent 60%)",
              filter: "blur(50px)",
              animation: "treasureOrb2 10s ease-in-out infinite 2s"
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              background:
                "linear-gradient(115deg, transparent 30%, rgba(251,241,217,0.06) 50%, transparent 70%)",
              animation: "treasureSheen 6s ease-in-out infinite"
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage:
                "linear-gradient(to right,#FBF1D9 1px,transparent 1px),linear-gradient(to bottom,#FBF1D9 1px,transparent 1px)",
              backgroundSize: "28px 28px"
            }}
          />
          <div className="pointer-events-none absolute inset-0 paper-grain opacity-[0.12]" />

          <div className="relative px-5 pt-5 pb-4">
            <div className="flex items-start justify-between mb-6">
              <div className="min-w-0 flex-1 pr-3">
                <p className="text-[8px] tracking-[0.5em] uppercase text-bone/30 mb-1.5">
                  Wallet Address
                </p>
                <LiquidPress
                  onClick={copyAddress}
                  className="flex items-center gap-2 group/addr">
                  <span className="font-mono text-[11px] text-bone/60 truncate">
                    {trunc(account.address)}
                  </span>
                  <span
                    className="shrink-0"
                    style={{
                      color: copiedAddr ? "#A36E14" : "rgba(250,245,233,0.3)",
                      transition: `color 400ms ${EASE}`
                    }}>
                    {copiedAddr ? (
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                        <path d="M2 6L4.5 8.5L9 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                        <rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1" />
                        <path d="M1 7.5V1.5a1 1 0 011-1h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                      </svg>
                    )}
                  </span>
                </LiquidPress>
              </div>
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full shrink-0"
                style={{
                  background: "rgba(251,241,217,0.07)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  border: "1px solid rgba(251,241,217,0.1)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)"
                }}>
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background: activeNetwork === "monad"
                      ? "rgb(99,102,241)"
                      : activeNetwork === "sepolia"
                      ? "rgb(232,174,58)"
                      : "rgb(0,130,255)",
                    boxShadow: activeNetwork === "monad"
                      ? "0 0 8px rgba(99,102,241,0.7)"
                      : activeNetwork === "sepolia"
                      ? "0 0 8px rgba(232,174,58,0.7)"
                      : "0 0 8px rgba(0,130,255,0.7)",
                    animation: "liquidPulseDot 2.4s ease-in-out infinite"
                  }}
                />
                <span className="text-[8px] tracking-[0.35em] uppercase text-bone/50">
                  {networkConfig.label}
                </span>
              </div>
            </div>

            <div className="mb-5">
              <p className="text-[8px] tracking-[0.5em] uppercase text-bone/30 mb-2">
                Treasure
              </p>
              <div className="flex items-baseline gap-2">
                <div
                  className="font-display font-bold tracking-[-0.03em] leading-none"
                  style={{
                    color: "#FBF1D9",
                    textShadow:
                      "0 0 40px rgba(232,174,58,0.25), 0 2px 8px rgba(0,0,0,0.5)"
                  }}>
                  <AnimatedNumber
                    value={formatted}
                    height={40}
                    className="text-[40px]"
                    duration={800}
                  />
                </div>
                <span className="text-[20px] font-display font-semibold text-bone/30">
                  {networkConfig.nativeCurrency}
                </span>
              </div>
              <p className="mt-1.5 text-[10px] text-bone/25">
                {balanceErr ? `Couldn't reach ${networkConfig.label} RPC — retrying…` : "≈ $0.00 USD"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <LiquidPress
                onClick={copyAddress}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[9px] tracking-[0.2em] uppercase"
                style={{
                  background: copiedAddr
                    ? "rgba(232,174,58,0.15)"
                    : "rgba(251,241,217,0.04)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  border: copiedAddr
                    ? "1px solid rgba(163,110,20,0.4)"
                    : "1px solid rgba(251,241,217,0.12)",
                  color: copiedAddr ? "#A36E14" : "rgba(250,245,233,0.45)",
                  boxShadow: copiedAddr
                    ? "inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 8px rgba(163,110,20,0.2)"
                    : "inset 0 1px 0 rgba(255,255,255,0.04)",
                  transition: `all 400ms ${SPRING}`
                }}>
                {copiedAddr ? (
                  <svg width="9" height="9" viewBox="0 0 11 11" fill="none">
                    <path d="M2 6L4.5 8.5L9 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="9" height="9" viewBox="0 0 11 11" fill="none">
                    <rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1" />
                    <path d="M1 7.5V1.5a1 1 0 011-1h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                  </svg>
                )}
                <span>{copiedAddr ? "Copied" : "Open addr"}</span>
              </LiquidPress>

              <LiquidPress
                onClick={copyNoidKey}
                disabled={!noidAccount}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[9px] tracking-[0.2em] uppercase disabled:opacity-40"
                style={{
                  background: copiedNoid
                    ? "rgba(232,174,58,0.15)"
                    : "rgba(251,241,217,0.04)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  border: copiedNoid
                    ? "1px solid rgba(163,110,20,0.4)"
                    : "1px solid rgba(251,241,217,0.12)",
                  color: copiedNoid ? "#A36E14" : "rgba(250,245,233,0.45)",
                  boxShadow: copiedNoid
                    ? "inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 8px rgba(163,110,20,0.2)"
                    : "inset 0 1px 0 rgba(255,255,255,0.04)",
                  transition: `all 400ms ${SPRING}`
                }}>
                {copiedNoid ? (
                  <svg width="9" height="9" viewBox="0 0 11 11" fill="none">
                    <path d="M2 6L4.5 8.5L9 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="9" height="9" viewBox="0 0 11 11" fill="none">
                    <rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1" />
                    <path d="M1 7.5V1.5a1 1 0 011-1h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                  </svg>
                )}
                <span>{copiedNoid ? "Copied" : "Noid key"}</span>
              </LiquidPress>
            </div>
          </div>
        </div>
      </div>

      {/* ─── WALLET ACTIONS ─── */}
      <div
        className="px-4 mt-5"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(20px)",
          transition: `all 700ms ${SPRING} 120ms`
        }}>
        <div className="flex items-center gap-2 mb-3">
          <div
            style={{
              height: "1px",
              flex: 1,
              background:
                "linear-gradient(to right, transparent, rgba(23,19,17,0.12), transparent)"
            }}
          />
          <p className="text-[8px] tracking-[0.5em] uppercase text-ink/40 shrink-0">
            Voyages
          </p>
          <div
            style={{
              height: "1px",
              flex: 1,
              background:
                "linear-gradient(to right, transparent, rgba(23,19,17,0.12), transparent)"
            }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <LiquidActionButton
            icon={<SendIcon />}
            label="Send"
            onClick={() => setShowSend(true)}
            delay={0}
          />
          <LiquidActionButton
            icon={<ReceiveIcon />}
            label="Receive"
            onClick={() => setShowReceive(true)}
            delay={60}
          />
          <LiquidActionButton
            icon={<SwapIcon />}
            label="Swap"
            muted
            onClick={() => setShowSwapToast(true)}
            delay={120}
          />
        </div>
      </div>

      {/* ─── SHIP'S LOG ─── */}
      <div
        className="px-4 mt-5 mb-6"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(20px)",
          transition: `all 700ms ${SPRING} 240ms`
        }}>
        <div className="flex items-center gap-2 mb-3">
          <div
            style={{
              height: "1px",
              flex: 1,
              background:
                "linear-gradient(to right, transparent, rgba(23,19,17,0.12), transparent)"
            }}
          />
          <p className="text-[8px] tracking-[0.5em] uppercase text-ink/40 shrink-0">
            Ship's Log
          </p>
          <div
            style={{
              height: "1px",
              flex: 1,
              background:
                "linear-gradient(to right, transparent, rgba(23,19,17,0.12), transparent)"
            }}
          />
        </div>

        <ShipsLogEntries entries={txEntries} isNoid={false} />
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
        onSent={() => { void refreshBalance(); reloadTxEntries() }}
      />
      <ComingSoonToast
        show={showSwapToast}
        onDone={() => setShowSwapToast(false)}
      />

      <style>{`
        @keyframes treasureOrb1 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 1; }
          50% { transform: translate(-30px, 20px) scale(1.15); opacity: 0.7; }
        }
        @keyframes treasureOrb2 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 1; }
          50% { transform: translate(40px, -30px) scale(1.2); opacity: 0.6; }
        }
        @keyframes treasureSheen {
          0%, 100% { transform: translateX(-30%); }
          50% { transform: translateX(30%); }
        }
        @keyframes liquidPulseDot {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.4); opacity: 0.6; }
        }
        @keyframes logScroll {
          0%, 100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }
        @keyframes openBgOrb1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-30px, 25px) scale(1.12); }
        }
        @keyframes openBgOrb2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(40px, -30px) scale(1.15); }
        }
      `}</style>
    </div>
  )
}

/* ───────────────────────── Liquid Action Button ───────────────────────── */
function LiquidActionButton({
  icon,
  label,
  onClick,
  muted,
  delay = 0
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  muted?: boolean
  delay?: number
}) {
  const [pressed, setPressed] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay)
    return () => clearTimeout(t)
  }, [delay])

  return (
    <button
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => { setPressed(false); setHovering(false) }}
      onPointerEnter={() => setHovering(true)}
      className="group relative overflow-hidden rounded-2xl text-left"
      style={{
        padding: "12px 12px 11px",
        background: muted
          ? "rgba(23,19,17,0.03)"
          : "linear-gradient(145deg, rgba(23,19,17,0.06) 0%, rgba(163,110,20,0.06) 100%)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: muted
          ? "1px solid rgba(23,19,17,0.06)"
          : hovering
            ? "1px solid rgba(163,110,20,0.4)"
            : "1px solid rgba(163,110,20,0.18)",
        boxShadow: muted
          ? "inset 0 1px 0 rgba(255,255,255,0.4)"
          : hovering
            ? "inset 0 1px 0 rgba(255,255,255,0.6), 0 8px 24px -6px rgba(163,110,20,0.25)"
            : "inset 0 1px 0 rgba(255,255,255,0.4), 0 2px 8px rgba(163,110,20,0.06)",
        transform: pressed
          ? "scale(0.93) translateY(0)"
          : mounted
            ? hovering
              ? "scale(1) translateY(-3px)"
              : "scale(1) translateY(0)"
            : "scale(0.9) translateY(10px)",
        opacity: mounted ? 1 : 0,
        transition: pressed
          ? `transform 200ms ${SPRING}`
          : `all 600ms ${SPRING}`
      }}>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(163,110,20,0.12) 0%, transparent 70%)",
          opacity: hovering && !muted ? 1 : 0,
          transition: `opacity 500ms ${EASE}`
        }}
      />

      <div className="relative">
        <div
          className="flex items-center justify-center rounded-xl mb-2 h-8 w-8"
          style={{
            background: muted ? "rgba(23,19,17,0.04)" : "rgba(163,110,20,0.14)",
            border: muted
              ? "1px solid rgba(23,19,17,0.07)"
              : "1px solid rgba(163,110,20,0.24)",
            boxShadow: muted
              ? "none"
              : "inset 0 1px 0 rgba(255,255,255,0.4)",
            transform: hovering && !muted ? "scale(1.08)" : "scale(1)",
            transition: `transform 500ms ${SPRING}, background 400ms ${EASE}`
          }}>
          <span style={{ color: muted ? "rgba(23,19,17,0.3)" : "#A36E14" }}>
            {icon}
          </span>
        </div>
        <p
          className="font-display font-bold tracking-[-0.01em] leading-none text-[11px]"
          style={{ color: muted ? "rgba(23,19,17,0.35)" : "rgba(23,19,17,0.8)" }}>
          {label}
        </p>
      </div>
    </button>
  )
}

/* ─── SVG icons ─── */
function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
      <path d="M4 14L14 4M14 4H7M14 4V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ReceiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
      <path d="M14 4L4 14M4 14H11M4 14V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SwapIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 18" fill="none">
      <path d="M3 6H15M15 6L12 3M15 6L12 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 12H5M5 12L8 9M5 12L8 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function formatBalance(b: string): string {
  const n = Number(b)
  if (!Number.isFinite(n) || n === 0) return "0.0000"
  if (n < 0.0001) return n.toFixed(6)
  return n.toFixed(4)
}