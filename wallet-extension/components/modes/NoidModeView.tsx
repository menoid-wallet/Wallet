/**
 * NoidModeView.tsx — Liquid iOS Edition
 *
 * Shadow waters private wallet view, redesigned with liquid iOS language:
 *   - Spring physics on all interactions
 *   - Glass morphism cards with backdrop blur
 *   - Floating gold orbs in treasury card (dark mode)
 *   - Liquid press feedback on every button
 *   - Staggered entrance animations
 *   - Smooth balance transitions
 *
 * Color palette preserved: dark luxury with gold accents.
 */

import React, { useCallback, useEffect, useRef, useState } from "react"
import { useWallet } from "../../context/WalletContext"
import { usePool } from "../../context/PoolContext"
import { getBalance } from "../../lib/monadRpc"
import AnimatedNumber from "../shared/AnimatedNumber"
import ComingSoonToast from "../shared/ComingSoonToast"
import MaskModal from "../shared/MaskModal"
import ReceiveModal from "../shared/ReceiveModal"
import NoidSendModal from "~components/shared/NoidSendModal"
import UnMaskModal from "~components/shared/UnMaskModal"
import NoidSmartAccountsModal from "~components/shared/NoidSmartAccountsModal"

const OPEN_BALANCE_POLL_MS = 8_000
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)"
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)"

/* ───────────────────────── Liquid press ───────────────────────── */
function LiquidPress({
  children,
  onClick,
  disabled,
  className = "",
  style = {},
  title
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  title?: string
}) {
  const [pressed, setPressed] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
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

export default function NoidModeView() {
  const { wallet, selectedNoidAccount, setSelectedNoidAccount } = useWallet()
  const noid = wallet?.noidAccount
  const normal = wallet?.normalAccount

  const { formattedBalance, syncing, lastSyncedAt, allUnspentUTXOs, error: poolError, myNoidSmartAccounts } = usePool()

  const [openBalance, setOpenBalance] = useState<string>("0")
  const [showReceive, setShowReceive] = useState(false)
  const [showMask, setShowMask] = useState(false)
  const [showSend, setShowSend] = useState(false)
  const [toast, setToast] = useState<{ show: boolean; msg?: string }>({ show: false })
  const [copiedNoid, setCopiedNoid] = useState(false)
  const [copiedOpen, setCopiedOpen] = useState(false)
  const [showUnmask, setShowUnmask] = useState(false)
  const [showSmartAccounts, setShowSmartAccounts] = useState(false)
  const [mounted, setMounted] = useState(false)
  const mountedRef = useRef(true)

  const refreshOpenBalance = useCallback(async () => {
    if (!normal) return
    try {
      const b = await getBalance(normal.address)
      if (mountedRef.current) setOpenBalance(b)
    } catch {}
  }, [normal])

  useEffect(() => {
    mountedRef.current = true
    void refreshOpenBalance()
    const id = setInterval(() => { if (!document.hidden) void refreshOpenBalance() }, OPEN_BALANCE_POLL_MS)
    requestAnimationFrame(() => setMounted(true))
    return () => { mountedRef.current = false; clearInterval(id) }
  }, [refreshOpenBalance])

  if (!noid) return null

  const joinedKey = `${noid.publicKey}|${noid.zkPublicKey ?? ""}`

  function copyJoined() {
    navigator.clipboard.writeText(joinedKey)
    setCopiedNoid(true)
    setTimeout(() => setCopiedNoid(false), 1500)
  }

  function copyOpenAddress() {
    if (!normal) return
    navigator.clipboard.writeText(normal.address)
    setCopiedOpen(true)
    setTimeout(() => setCopiedOpen(false), 1500)
  }

  function truncKey(k: string): string {
    return k.length > 16 ? `${k.slice(0, 9)}…${k.slice(-5)}` : k
  }

  function syncedLabel(): string {
    if (!lastSyncedAt) return "Awaiting sync"
    const sec = Math.max(1, Math.round((Date.now() - lastSyncedAt) / 1000))
    if (sec < 60) return `${sec}s ago`
    return `${Math.round(sec / 60)}m ago`
  }

  const [, forceTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      {/* ─── HERO TREASURY CARD (light/cream over dark backdrop) ─── */}
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
            background: "linear-gradient(145deg, #FBF1D9 0%, #F0E0B6 55%, #EAD5A7 100%)",
            boxShadow:
              "0 30px 60px -20px rgba(163,110,20,0.4), 0 8px 24px -8px rgba(232,174,58,0.25), inset 0 1px 0 rgba(255,255,255,0.7)"
          }}>
          {/* Floating gold orb top-right */}
          <div
            className="pointer-events-none absolute"
            style={{
              top: "-25%",
              right: "-15%",
              width: 220,
              height: 220,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(232,174,58,0.55) 0%, transparent 60%)",
              filter: "blur(40px)",
              animation: "noidOrb1 12s ease-in-out infinite"
            }}
          />
          {/* Floating amber orb bottom-left */}
          <div
            className="pointer-events-none absolute"
            style={{
              bottom: "-30%",
              left: "-20%",
              width: 240,
              height: 240,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(163,110,20,0.35) 0%, transparent 60%)",
              filter: "blur(50px)",
              animation: "noidOrb2 10s ease-in-out infinite 2s"
            }}
          />
          {/* Liquid sheen */}
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              background:
                "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)",
              animation: "noidSheen 6s ease-in-out infinite"
            }}
          />
          {/* Grid texture */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                "linear-gradient(to right,#171311 1px,transparent 1px),linear-gradient(to bottom,#171311 1px,transparent 1px)",
              backgroundSize: "28px 28px"
            }}
          />
          <div className="pointer-events-none absolute inset-0 paper-grain opacity-[0.3]" />

          <div className="relative px-5 pt-5 pb-4">
            {/* Top row: key + network badge */}
            <div className="flex items-start justify-between mb-6">
              <div className="min-w-0 flex-1 pr-3">
                <p className="text-[8px] tracking-[0.5em] uppercase text-ink/35 mb-1.5">
                  Noid Key
                </p>
                <LiquidPress
                  onClick={copyJoined}
                  title={joinedKey}
                  className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-ink/60 truncate">
                    {truncKey(joinedKey)}
                  </span>
                  <span
                    className="shrink-0"
                    style={{
                      color: copiedNoid ? "#A36E14" : "rgba(23,19,17,0.3)",
                      transition: `color 400ms ${EASE}`
                    }}>
                    {copiedNoid ? (
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
              {/* Liquid network badge */}
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full shrink-0"
                style={{
                  background: "rgba(23,19,17,0.06)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  border: "1px solid rgba(23,19,17,0.1)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)"
                }}>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${syncing ? "bg-gold" : "bg-goldDeep"}`}
                  style={{
                    boxShadow: "0 0 6px rgba(163,110,20,0.5)",
                    animation: syncing
                      ? "noidPulseDot 1.2s ease-in-out infinite"
                      : "noidPulseDot 2.4s ease-in-out infinite"
                  }}
                />
                <span className="text-[8px] tracking-[0.35em] uppercase text-ink/50">
                  Private
                </span>
              </div>
            </div>

            {/* Balance — centerpiece */}
            <div className="mb-5">
              <p className="text-[8px] tracking-[0.5em] uppercase text-ink/35 mb-2">
                Hidden Treasure
              </p>
              <div className="flex items-baseline gap-2">
                <div
                  className="font-display font-bold tracking-[-0.03em] leading-none"
                  style={{
                    color: "#171311",
                    textShadow:
                      "0 0 40px rgba(163,110,20,0.25), 0 2px 8px rgba(163,110,20,0.1)"
                  }}>
                  <AnimatedNumber value={formattedBalance} height={40} className="text-[40px]" duration={800} />
                </div>
                <span className="text-[20px] font-display font-semibold text-ink/30">
                  MON
                </span>
              </div>
              <p className="mt-1.5 text-[10px] text-ink/30">
                {poolError ? "Couldn't reach indexer — retrying…" : (
                  <>
                    <span>{allUnspentUTXOs.length} note{allUnspentUTXOs.length !== 1 ? "s" : ""}</span>
                    <span className="mx-1.5 text-ink/15">·</span>
                    <span>Synced {syncedLabel()}</span>
                  </>
                )}
              </p>
            </div>

            {/* Liquid copy chips */}
            <div className="flex items-center gap-2">
              <LiquidPress
                onClick={copyOpenAddress}
                disabled={!normal}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[9px] tracking-[0.2em] uppercase disabled:opacity-40"
                style={{
                  background: copiedOpen
                    ? "rgba(163,110,20,0.15)"
                    : "rgba(23,19,17,0.05)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  border: copiedOpen
                    ? "1px solid rgba(163,110,20,0.4)"
                    : "1px solid rgba(23,19,17,0.12)",
                  color: copiedOpen ? "#A36E14" : "rgba(23,19,17,0.5)",
                  boxShadow: copiedOpen
                    ? "inset 0 1px 0 rgba(255,255,255,0.3), 0 2px 8px rgba(163,110,20,0.2)"
                    : "inset 0 1px 0 rgba(255,255,255,0.3)",
                  transition: `all 400ms ${SPRING}`
                }}>
                {copiedOpen ? (
                  <svg width="9" height="9" viewBox="0 0 11 11" fill="none">
                    <path d="M2 6L4.5 8.5L9 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="9" height="9" viewBox="0 0 11 11" fill="none">
                    <rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1" />
                    <path d="M1 7.5V1.5a1 1 0 011-1h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                  </svg>
                )}
                <span>{copiedOpen ? "Copied" : "Open addr"}</span>
              </LiquidPress>

              <LiquidPress
                onClick={copyJoined}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[9px] tracking-[0.2em] uppercase"
                style={{
                  background: copiedNoid
                    ? "rgba(163,110,20,0.15)"
                    : "rgba(23,19,17,0.05)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  border: copiedNoid
                    ? "1px solid rgba(163,110,20,0.4)"
                    : "1px solid rgba(23,19,17,0.12)",
                  color: copiedNoid ? "#A36E14" : "rgba(23,19,17,0.5)",
                  boxShadow: copiedNoid
                    ? "inset 0 1px 0 rgba(255,255,255,0.3), 0 2px 8px rgba(163,110,20,0.2)"
                    : "inset 0 1px 0 rgba(255,255,255,0.3)",
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

          {/* Divider */}
          <div style={{
            height: "1px",
            background: "linear-gradient(to right, transparent, rgba(23,19,17,0.08) 30%, rgba(163,110,20,0.2) 50%, rgba(23,19,17,0.08) 70%, transparent)"
          }} />

          {/* Open balance row */}
          <div className="relative px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 rounded-full bg-goldDeep/60"
                style={{
                  boxShadow: "0 0 6px rgba(163,110,20,0.4)",
                  animation: "noidPulseDot 3s ease-in-out infinite"
                }}
              />
              <span className="text-[9px] tracking-[0.4em] uppercase text-ink/40">
                Open Balance
              </span>
            </div>
            <span className="font-mono text-[11px] text-ink/55">
              {Number(openBalance).toFixed(4)} MON
            </span>
          </div>
        </div>
      </div>

      {/* ─── NOID SMART ACCOUNTS ─── */}
      <div
        className="px-4 mt-5"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(20px)",
          transition: `all 700ms ${SPRING} 60ms`
        }}>
        <div className="flex items-center gap-2 mb-3">
          <div style={{
            height: "1px",
            flex: 1,
            background: "linear-gradient(to right, transparent, rgba(251,241,217,0.1), transparent)"
          }} />
          <p className="text-[8px] tracking-[0.5em] uppercase text-bone/35 shrink-0">
            Noid Smart Account
          </p>
          <div style={{
            height: "1px",
            flex: 1,
            background: "linear-gradient(to right, transparent, rgba(251,241,217,0.1), transparent)"
          }} />
        </div>

        <button
          onClick={() => setShowSmartAccounts(true)}
          className="w-full text-left relative overflow-hidden rounded-2xl"
          style={{
            padding: "12px 14px",
            background: selectedNoidAccount
              ? "linear-gradient(145deg, rgba(232,174,58,0.10) 0%, rgba(163,110,20,0.08) 100%)"
              : "rgba(251,241,217,0.03)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            border: selectedNoidAccount
              ? "1px solid rgba(232,174,58,0.28)"
              : "1px solid rgba(251,241,217,0.08)",
            boxShadow: selectedNoidAccount
              ? "inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 16px rgba(232,174,58,0.1)"
              : "inset 0 1px 0 rgba(255,255,255,0.04)"
          }}>
          {selectedNoidAccount ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[8px] tracking-[0.4em] uppercase mb-1"
                   style={{ color: "rgba(232,174,58,0.6)" }}>
                  Active Smart Account
                </p>
                <p className="font-mono text-[11px] truncate"
                   style={{ color: "rgba(251,241,217,0.75)" }}>
                  {selectedNoidAccount.account.slice(0, 10)}…{selectedNoidAccount.account.slice(-8)}
                </p>
                <p className="font-mono text-[9px] mt-0.5 truncate"
                   style={{ color: "rgba(251,241,217,0.3)" }}>
                  cmx {selectedNoidAccount.commitment.slice(0, 12)}…
                </p>
              </div>
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                style={{
                  background: "rgba(163,110,20,0.18)",
                  border: "1px solid rgba(163,110,20,0.3)"
                }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="2" width="5.5" height="5.5" rx="1.5" stroke="#A36E14" strokeWidth="1.2" />
                  <rect x="8.5" y="2" width="5.5" height="5.5" rx="1.5" stroke="#A36E14" strokeWidth="1.2" />
                  <rect x="2" y="8.5" width="5.5" height="5.5" rx="1.5" stroke="#A36E14" strokeWidth="1.2" />
                  <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.5" stroke="#A36E14" strokeWidth="1.2" />
                </svg>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-display"
                   style={{ color: "rgba(251,241,217,0.4)" }}>
                  Select Noid Account
                </p>
                <p className="text-[9px] mt-0.5"
                   style={{ color: "rgba(251,241,217,0.2)" }}>
                  No smart account linked
                </p>
              </div>
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                style={{
                  background: "rgba(251,241,217,0.04)",
                  border: "1px solid rgba(251,241,217,0.08)"
                }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v10M3 8h10" stroke="rgba(251,241,217,0.3)" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
            </div>
          )}
        </button>
      </div>

      {/* ─── ZK OPERATIONS (Voyages) ─── */}
      <div
        className="px-4 mt-5"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(20px)",
          transition: `all 700ms ${SPRING} 120ms`
        }}>
        <div className="flex items-center gap-2 mb-3">
          <div style={{
            height: "1px",
            flex: 1,
            background: "linear-gradient(to right, transparent, rgba(251,241,217,0.1), transparent)"
          }} />
          <p className="text-[8px] tracking-[0.5em] uppercase text-bone/35 shrink-0">
            Voyages
          </p>
          <div style={{
            height: "1px",
            flex: 1,
            background: "linear-gradient(to right, transparent, rgba(251,241,217,0.1), transparent)"
          }} />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <LiquidNoidButton
            icon={<MaskIcon />}
            label="Mask"
            sublabel="Move to shadow"
            onClick={() => { void refreshOpenBalance(); setShowMask(true) }}
            delay={0}
          />
          <LiquidNoidButton
            icon={<UnmaskIcon />}
            label="Unmask"
            sublabel="Emerge from shadow"
            onClick={() => setShowUnmask(true)}
            delay={80}
          />
        </div>
      </div>

      {/* ─── WALLET ACTIONS ─── */}
      <div
        className="px-4 mt-4"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(20px)",
          transition: `all 700ms ${SPRING} 200ms`
        }}>
        {/* <div className="flex items-center gap-2 mb-3">
          <div style={{
            height: "1px",
            flex: 1,
            background: "linear-gradient(to right, transparent, rgba(251,241,217,0.1), transparent)"
          }} />
          <p className="text-[8px] tracking-[0.5em] uppercase text-bone/35 shrink-0">
            Wallet
          </p>
          <div style={{
            height: "1px",
            flex: 1,
            background: "linear-gradient(to right, transparent, rgba(251,241,217,0.1), transparent)"
          }} />
        </div> */}
        <div className="grid grid-cols-3 gap-2">
          <LiquidNoidButton
            icon={<SendIcon />}
            label="Send"
            compact
            onClick={() => setShowSend(true)}
            delay={0}
          />
          <LiquidNoidButton
            icon={<ReceiveIcon />}
            label="Receive"
            compact
            onClick={() => setShowReceive(true)}
            delay={60}
          />
          <LiquidNoidButton
            icon={<SwapIcon />}
            label="Swap"
            compact
            muted
            onClick={() => setToast({ show: true, msg: "Swap on the horizon. Coming soon." })}
            delay={120}
          />
        </div>
      </div>

      {/* ─── PRIVATE WATERS INFO ─── */}
      <div
        className="px-4 mt-4 mb-6"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(20px)",
          transition: `all 700ms ${SPRING} 320ms`
        }}>
        <div
          className="relative rounded-2xl overflow-hidden px-4 py-3.5"
          style={{
            background:
              "linear-gradient(135deg, rgba(251,241,217,0.04) 0%, rgba(232,174,58,0.07) 100%)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            border: "1px solid rgba(251,241,217,0.08)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 16px rgba(0,0,0,0.2)"
          }}>
          <div
            className="pointer-events-none absolute"
            style={{
              top: "-30%",
              left: "-10%",
              width: 140,
              height: 140,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(232,174,58,0.2) 0%, transparent 60%)",
              filter: "blur(30px)"
            }}
          />
          <div className="relative flex items-start gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{
                background: "rgba(163,110,20,0.2)",
                border: "1px solid rgba(163,110,20,0.3)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1)"
              }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 1.5C5 1.5 3 3.5 3 6.2c0 1.7 1 3 1.8 3.6.4.3.7.7.7 1.2v.5c0 .8.7 1.5 1.5 1.5h4c.8 0 1.5-.7 1.5-1.5V11c0-.5.3-.9.7-1.2C13 9.2 14 7.9 14 6.2 14 3.5 11 1.5 8 1.5Z"
                  stroke="#A36E14" strokeWidth="1.2" />
                <circle cx="6" cy="6.5" r="0.8" fill="#A36E14" />
                <circle cx="10" cy="6.5" r="0.8" fill="#A36E14" />
                <path d="M7 9.5l1 1 1-1" stroke="#A36E14" strokeWidth="1" strokeLinecap="round" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-[9px] tracking-[0.35em] uppercase text-goldDeep/80 mb-1">
                Private Waters
              </p>
              <p className="text-[11px] leading-relaxed" style={{ color: "rgba(251,241,217,0.55)" }}>
                Mask MON to slip into shadow. Each note is a Poseidon commitment — only you can spend it.
              </p>
            </div>
          </div>
        </div>
      </div>

      <UnMaskModal open={showUnmask} onClose={() => { setShowUnmask(false); void refreshOpenBalance() }} />
      <NoidSendModal open={showSend} onClose={() => setShowSend(false)} />
      <ReceiveModal open={showReceive} onClose={() => setShowReceive(false)} mode="noid" publicKey={noid.publicKey} zkPublicKey={noid.zkPublicKey} />
      <MaskModal open={showMask} onClose={() => { setShowMask(false); void refreshOpenBalance() }} openBalance={openBalance} />
      <ComingSoonToast show={toast.show} onDone={() => setToast({ show: false })} message={toast.msg} />
      <NoidSmartAccountsModal
        open={showSmartAccounts}
        accounts={myNoidSmartAccounts}
        selected={selectedNoidAccount}
        onSelect={(acc) => { setSelectedNoidAccount(acc); setShowSmartAccounts(false) }}
        onClose={() => setShowSmartAccounts(false)}
        onComingSoon={() => { setShowSmartAccounts(false); setToast({ show: true, msg: "Create Noid Smart Account — coming soon." }) }}
      />

      <style>{`
        @keyframes noidOrb1 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 1; }
          50% { transform: translate(-25px, 20px) scale(1.15); opacity: 0.75; }
        }
        @keyframes noidOrb2 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 1; }
          50% { transform: translate(35px, -25px) scale(1.18); opacity: 0.65; }
        }
        @keyframes noidSheen {
          0%, 100% { transform: translateX(-30%); }
          50% { transform: translateX(30%); }
        }
        @keyframes noidPulseDot {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.4); opacity: 0.6; }
        }
      `}</style>
    </>
  )
}

/* ───────────────────────── Liquid Noid Action Button ───────────────────────── */
function LiquidNoidButton({
  icon,
  label,
  sublabel,
  onClick,
  muted,
  compact,
  delay = 0
}: {
  icon: React.ReactNode
  label: string
  sublabel?: string
  onClick: () => void
  muted?: boolean
  compact?: boolean
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
        padding: compact ? "10px 12px 10px" : "14px 14px 12px",
        background: muted
          ? "rgba(251,241,217,0.03)"
          : "linear-gradient(145deg, rgba(251,241,217,0.07) 0%, rgba(232,174,58,0.06) 100%)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: muted
          ? "1px solid rgba(251,241,217,0.06)"
          : hovering
            ? "1px solid rgba(232,174,58,0.4)"
            : "1px solid rgba(232,174,58,0.2)",
        boxShadow: muted
          ? "inset 0 1px 0 rgba(255,255,255,0.04)"
          : hovering
            ? "inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 24px -6px rgba(232,174,58,0.3)"
            : "inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 8px rgba(232,174,58,0.08)",
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
      {/* Hover shimmer */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(232,174,58,0.15) 0%, transparent 70%)",
          opacity: hovering && !muted ? 1 : 0,
          transition: `opacity 500ms ${EASE}`
        }}
      />

      <div className="relative">
        <div
          className={`flex items-center justify-center rounded-xl mb-2 ${compact ? "h-7 w-7" : "h-9 w-9"}`}
          style={{
            background: muted ? "rgba(251,241,217,0.05)" : "rgba(232,174,58,0.16)",
            border: muted
              ? "1px solid rgba(251,241,217,0.08)"
              : "1px solid rgba(232,174,58,0.28)",
            boxShadow: muted ? "none" : "inset 0 1px 0 rgba(255,255,255,0.08)",
            transform: hovering && !muted ? "scale(1.08)" : "scale(1)",
            transition: `transform 500ms ${SPRING}, background 400ms ${EASE}`
          }}>
          <span style={{ color: muted ? "rgba(251,241,217,0.35)" : "#A36E14" }}>
            {icon}
          </span>
        </div>
        <p
          className={`font-display font-bold tracking-[-0.01em] leading-none ${compact ? "text-[11px]" : "text-[13px]"}`}
          style={{ color: muted ? "rgba(251,241,217,0.45)" : "rgba(251,241,217,0.88)" }}>
          {label}
        </p>
        {!compact && sublabel && (
          <p
            className="text-[9px] mt-0.5 tracking-[0.1em]"
            style={{ color: "rgba(251,241,217,0.3)" }}>
            {sublabel}
          </p>
        )}
      </div>
    </button>
  )
}

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

function MaskIcon() {
  return (
    <svg width="18" height="14" viewBox="0 0 20 14" fill="none">
      <path d="M2 6 Q4 2 7 2 Q9 2 10 4 Q11 2 13 2 Q16 2 18 6 Q17 11 13 11 Q11 11 10 9 Q9 11 7 11 Q3 11 2 6 Z"
        fill="currentColor" opacity="0.9" />
      <circle cx="6.5" cy="6.5" r="1.1" fill="rgba(163,110,20,0.9)" />
      <circle cx="13.5" cy="6.5" r="1.1" fill="rgba(163,110,20,0.9)" />
    </svg>
  )
}

function UnmaskIcon() {
  return (
    <svg width="18" height="14" viewBox="0 0 20 14" fill="none">
      <path d="M2 6 Q4 2 7 2 Q9 2 10 4 Q11 2 13 2 Q16 2 18 6 Q17 11 13 11 Q11 11 10 9 Q9 11 7 11 Q3 11 2 6 Z"
        fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
      <line x1="3" y1="12" x2="17" y2="2" stroke="rgba(163,110,20,0.8)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}