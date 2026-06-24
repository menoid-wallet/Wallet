/**
 * WalletHome.tsx — Liquid iOS Edition v2
 *
 * Fixes from v1:
 *   - Tab bar liquid blob now perfectly centered around active icon (uses CSS Grid + per-button positioning)
 *   - All color transitions unified to same duration/easing (500ms cubic-bezier(0.65,0,0.35,1))
 *   - Smoother (less aggressive) scroll — lerp bumped from 0.12 → 0.22
 *   - Wallet number chip & MENOID label use explicit color tokens that transition consistently
 *   - Bottom nav active state uses unified easing
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useWallet } from "../context/WalletContext"
import {
  applyChromeBehaviour,
  getViewMode,
  setViewMode
} from "../lib/viewMode"
import { readConnections } from "../lib/connections"
import AccountDetails from "./AccountDetails"
import ConnectionsView from "./ConnectionsView"
import NoidModeView from "./modes/NoidModeView"
import OpenModeView from "./modes/OpenModeView"
import WalletSwitcher from "./WalletSwitcher"
import { type NetworkId } from "../lib/networks"
import { useWallet as useWalletCtx } from "../context/WalletContext"

type Tab = "wallet" | "activity" | "settings"
type SettingsView = "main" | "account" | "connections"

// ─── Unified animation tokens ─────────────────────────────────────────
const COLOR_TRANSITION =
  "color 500ms cubic-bezier(0.65, 0, 0.35, 1), background 500ms cubic-bezier(0.65, 0, 0.35, 1), border-color 500ms cubic-bezier(0.65, 0, 0.35, 1), box-shadow 500ms cubic-bezier(0.65, 0, 0.35, 1)"
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)"
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)"

/* ───────────────────────── Smooth scroll hook (gentler) ─────────────────────────
   State lives in a ref so it can be reset externally (resetScroll) without the
   wheel handler later snapping back to a stale target. */
function useLiquidScroll(ref: React.RefObject<HTMLDivElement>) {
  const stateRef = useRef({ target: 0, current: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let rafId = 0
    let isScrolling = false
    stateRef.current.target = el.scrollTop
    stateRef.current.current = el.scrollTop

    const animate = () => {
      const s = stateRef.current
      const diff = s.target - s.current
      if (Math.abs(diff) < 0.5) {
        s.current = s.target
        el.scrollTop = s.current
        isScrolling = false
        return
      }
      // 0.22 lerp — faster catch-up, less lag
      s.current += diff * 0.22
      el.scrollTop = s.current
      rafId = requestAnimationFrame(animate)
    }

    const onWheel = (e: WheelEvent) => {
      const s = stateRef.current
      // Full 1.0 multiplier — preserves native scroll speed
      s.target += e.deltaY * 1.0
      s.target = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, s.target))
      if (!isScrolling) {
        isScrolling = true
        animate()
      }
      e.preventDefault()
    }

    el.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      el.removeEventListener("wheel", onWheel)
      cancelAnimationFrame(rafId)
    }
  }, [ref])

  return useCallback(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = 0
    stateRef.current.target = 0
    stateRef.current.current = 0
  }, [ref])
}

/* ───────────────────────── Liquid Button wrapper ───────────────────────── */
function LiquidButton({
  children,
  onClick,
  className = "",
  style = {},
  title,
  disabled = false,
  ...rest
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
  style?: React.CSSProperties
  title?: string
  disabled?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [pressed, setPressed] = useState(false)
  return (
    <button
      onClick={onClick}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      title={title}
      disabled={disabled}
      className={className}
      style={{
        transform: pressed ? "scale(0.92)" : "scale(1)",
        transition: `transform 400ms ${SPRING}`,
        ...style
      }}
      {...rest}>
      {children}
    </button>
  )
}

// Favicon error handler — defined outside JSX to avoid inline cast parse issues
function hideFavicon(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.display = "none"
}

interface PendingApproval {
  host: string
  origin: string
  favicon: string
  tabId: number
}

interface WalletHomeProps {
  pendingApproval?: PendingApproval | null
  onApprovalBannerClick?: () => void
  onApprovalBannerDismiss?: () => void
}

export default function WalletHome({
  pendingApproval = null,
  onApprovalBannerClick,
  onApprovalBannerDismiss,
}: WalletHomeProps) {
  const { wallet, entries, activeIndex, mode, setMode, lock } = useWallet()

  const [tab, setTab] = useState<Tab>("wallet")
  const [settingsView, setSettingsView] = useState<SettingsView>("main")

  const [sidebarMode, setSidebarMode] = useState(false)
  const [toggleHint, setToggleHint] = useState<string | null>(null)

  const [switcherOpen, setSwitcherOpen] = useState(false)

  // ── Connection count badge ──────────────────────────────────────────────
  const [connectionCount, setConnectionCount] = useState(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const resetScroll = useLiquidScroll(scrollRef)

  // Lifted here so the open token page survives an open↔noid mode switch
  // (the same coin re-opens in the other mode instead of dropping to the list).
  const [activeCoin, setActiveCoin] = useState<NetworkId | null>(null)
  // The graph card's last rect, handed back on close so the dashboard's treasure
  // card can morph out of it — the reverse of the open animation (#4).
  const [reverseMorph, setReverseMorph] = useState<DOMRect | null>(null)

  useEffect(() => {
    ;(async () => {
      const m = await getViewMode()
      setSidebarMode(m === "sidebar")
    })()
  }, [])

  // Reload connection count when active entry changes or settings view changes
  // (so badge updates after revoking from ConnectionsView)
  const activeEntry = entries[activeIndex]
  useEffect(() => {
    if (!activeEntry) return
    ;(async () => {
      const list = await readConnections()
      setConnectionCount(list.filter((c) => c.walletId === activeEntry.id).length)
    })()
  }, [activeEntry, settingsView])

  if (!wallet) return null

  const walletNumber = activeIndex + 1

  async function handleSidebarToggle(val: boolean) {
    setSidebarMode(val)
    setToggleHint(null)
    try {
      await setViewMode(val ? "sidebar" : "popup")
      await applyChromeBehaviour(val ? "sidebar" : "popup")
      if (val) {
        const win = await chrome.windows.getCurrent()
        if (win?.id !== undefined) {
          await chrome.sidePanel.open({ windowId: win.id })
        }
        window.close()
      } else {
        try {
          await chrome.action.openPopup()
          window.close()
        } catch {
          setToggleHint(
            "Popup mode is on. Click the Menoid icon in your toolbar to open it."
          )
        }
      }
    } catch (e) {
      console.error("Failed to switch view mode:", e)
    }
  }

  const isNoid = mode === "noid"

  useLayoutEffect(() => {
    const root = document.documentElement
    if (isNoid) root.classList.add("noid-theme")
    else root.classList.remove("noid-theme")
    return () => root.classList.remove("noid-theme")
  }, [isNoid])

  return (
    <div
      className="relative font-body overflow-hidden flex flex-col w-full h-full"
      style={{
        color: isNoid ? "#FAF5E9" : "#171311",
        // Opaque base behind the (transparent) scroll body. Without it the body
        // briefly shows the popup's lighter default on the first frame — the
        // band that lingered until the first repaint (~1s) cleared it.
        background: isNoid
          ? "linear-gradient(to bottom, #0F0B09, #171311 55%, #100C0A)"
          : "linear-gradient(to bottom, #FBF1D9, #F4E7CC, #EAD5A7)",
        transition: COLOR_TRANSITION
      }}>
      <Backdrop isNoid={isNoid} />

      {/* ─── Liquid Header ─── */}
      <header
        className="relative z-30 flex items-center justify-between px-5 pt-5 pb-4 shrink-0"
        style={{
          background: isNoid
            ? "linear-gradient(180deg, rgba(15,11,9,0.7) 0%, rgba(15,11,9,0.3) 80%, transparent 100%)"
            : "linear-gradient(180deg, rgba(234,214,170,0.82) 0%, rgba(234,214,170,0.4) 80%, transparent 100%)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          transition: COLOR_TRANSITION
        }}>
        <LiquidButton
          onClick={() => setSwitcherOpen(true)}
          title={activeEntry?.name ?? "Switch wallet"}
          className="group relative flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full font-display text-[11px] font-bold"
            style={{
              background: isNoid ? "#F6E6B4" : "#171311",
              color: isNoid ? "#171311" : "#FAF5E9",
              boxShadow: isNoid
                ? "0 4px 12px rgba(246,230,180,0.3), inset 0 1px 0 rgba(255,255,255,0.4)"
                : "0 4px 12px rgba(23,19,17,0.35), inset 0 1px 0 rgba(255,255,255,0.1)",
              transition: COLOR_TRANSITION
            }}>
            {walletNumber}
          </div>
          <div className="flex flex-col items-start text-left">
            <div className="flex items-center gap-1.5 leading-none">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: "#E8AE3A",
                  boxShadow: "0 0 6px rgba(232,174,58,0.6)",
                  animation: "liquidPulse 2.4s ease-in-out infinite"
                }}
              />
              <span
                className="font-display text-[10px] font-semibold tracking-[0.3em] leading-none"
                style={{
                  color: isNoid ? "#FAF5E9" : "#171311",
                  transition: COLOR_TRANSITION
                }}>
                MENOID
              </span>
            </div>
            {activeEntry && (
              <span
                className="font-mono text-[9px] lowercase tracking-[0.05em] opacity-60 mt-0.5 max-w-[120px] truncate"
                style={{
                  color: isNoid ? "#FAF5E9" : "#171311",
                  transition: COLOR_TRANSITION
                }}>
                {activeEntry.name}
              </span>
            )}
          </div>
        </LiquidButton>

        <LiquidModePill mode={mode} onSwitch={setMode} />

        {/* ─── Connection indicator (replaces lock icon) ─── */}
        <LiquidButton
          onClick={() => { setTab("settings"); setSettingsView("connections") }}
          title="Connected sites"
          className="relative flex h-8 w-8 items-center justify-center rounded-full"
          style={{
            background: isNoid
              ? "rgba(250,245,233,0.08)"
              : "rgba(23,19,17,0.06)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            transition: COLOR_TRANSITION
          }}>
          {connectionCount > 0 ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="4.5"
                stroke={isNoid ? "rgba(232,174,58,0.75)" : "rgba(163,110,20,0.7)"}
                strokeWidth="1.2" />
              <circle cx="7" cy="7" r="2"
                fill={isNoid ? "rgba(232,174,58,0.9)" : "#A36E14"} />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="4.5"
                className="ink-stroke" strokeOpacity="0.3" strokeWidth="1.2"
                strokeDasharray="2.5 2" />
              <circle cx="7" cy="7" r="1.5"
                className="ink-stroke" strokeOpacity="0.25" strokeWidth="1" />
            </svg>
          )}
          {/* Badge */}
          {connectionCount > 0 && (
            <span
              className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold leading-none"
              style={{
                background: "#E8AE3A",
                color: "#171311",
                boxShadow: "0 1px 4px rgba(232,174,58,0.5)"
              }}>
              {connectionCount > 9 ? "9+" : connectionCount}
            </span>
          )}
        </LiquidButton>
      </header>



      {/* ─── Body ─── */}
      <div
        ref={scrollRef}
        className="relative z-10 flex-1 overflow-y-auto"
        style={{ WebkitOverflowScrolling: "touch" }}>
        {tab === "wallet" && (
          <LiquidMorph keyId={mode}>
            {mode === "open" ? (
              <OpenModeView activeCoin={activeCoin} setActiveCoin={setActiveCoin} scrollToTop={resetScroll} reverseMorph={reverseMorph} setReverseMorph={setReverseMorph} />
            ) : (
              <NoidModeView activeCoin={activeCoin} setActiveCoin={setActiveCoin} scrollToTop={resetScroll} reverseMorph={reverseMorph} setReverseMorph={setReverseMorph} />
            )}
          </LiquidMorph>
        )}

        {tab === "activity" && (
          <LiquidFade>
            <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
              <span
                className="text-4xl mb-3"
                style={{ animation: "liquidFloat 3s ease-in-out infinite" }}>
                📜
              </span>
              <p
                className="font-serif italic text-[14px]"
                style={{
                  color: isNoid ? "rgba(250,245,233,0.55)" : "rgba(23,19,17,0.55)",
                  transition: COLOR_TRANSITION
                }}>
                Activity is shown inline with your treasury.
              </p>
              <p
                className="text-[11px] mt-1"
                style={{
                  color: isNoid ? "rgba(250,245,233,0.35)" : "rgba(23,19,17,0.35)",
                  transition: COLOR_TRANSITION
                }}>
                Switch back to the Wallet tab to see it.
              </p>
            </div>
          </LiquidFade>
        )}

        {tab === "settings" && settingsView === "main" && (
          <LiquidFade>
            <SettingsMain
              mode={mode}
              sidebarMode={sidebarMode}
              toggleHint={toggleHint}
              onSidebarToggle={handleSidebarToggle}
              onModeSwitch={setMode}
              onOpenAccountDetails={() => setSettingsView("account")}
              onOpenConnections={() => setSettingsView("connections")}
              onLock={lock}
            />
          </LiquidFade>
        )}

        {tab === "settings" && settingsView === "account" && (
          <LiquidFade>
            <AccountDetails onBack={() => setSettingsView("main")} />
          </LiquidFade>
        )}

        {tab === "settings" && settingsView === "connections" && (
          <LiquidFade>
            <ConnectionsView
              isNoid={isNoid}
              walletId={activeEntry?.id ?? ""}
              onBack={() => setSettingsView("main")}
            />
          </LiquidFade>
        )}
      </div>

      {/* ─── Pending connection banner ─── */}
      {pendingApproval && (
        <div className="relative z-40 shrink-0 px-3 pb-1.5">
          <div
            onClick={onApprovalBannerClick}
            className="flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer"
            style={{
              background: isNoid
                ? "linear-gradient(135deg, rgba(232,174,58,0.18) 0%, rgba(163,110,20,0.12) 100%)"
                : "linear-gradient(135deg, rgba(163,110,20,0.13) 0%, rgba(232,174,58,0.09) 100%)",
              border: isNoid ? "1px solid rgba(232,174,58,0.4)" : "1px solid rgba(163,110,20,0.3)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxShadow: isNoid ? "0 4px 20px rgba(0,0,0,0.25)" : "0 4px 20px rgba(92,58,33,0.15)",
              animation: "bannerSlideUp 400ms cubic-bezier(0.34,1.56,0.64,1) both",
            }}>

            {/* Favicon / icon */}
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: isNoid ? "rgba(232,174,58,0.15)" : "rgba(163,110,20,0.1)",
                border: isNoid ? "1px solid rgba(232,174,58,0.35)" : "1px solid rgba(163,110,20,0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}>
                {pendingApproval.favicon
                  ? <img src={pendingApproval.favicon} alt="" style={{ width: 18, height: 18, borderRadius: 4 }} onError={hideFavicon} />
                  : <span style={{ fontSize: 13 }}>🔗</span>
                }
              </div>
              <div style={{
                position: "absolute",
                top: -3,
                left: -3,
                right: -3,
                bottom: -3,
                borderRadius: "50%",
                border: isNoid ? "1.5px solid rgba(232,174,58,0.5)" : "1.5px solid rgba(163,110,20,0.4)",
                animation: "liquidPulse 2s ease-in-out infinite",
              }} />
            </div>

            {/* Text */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                margin: 0,
                fontSize: 11,
                fontWeight: 600,
                color: isNoid ? "rgba(232,174,58,0.95)" : "#7A4F10",
                letterSpacing: "0.01em",
                lineHeight: 1.3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}>
                {pendingApproval.host}
              </p>
              <p style={{
                margin: "1px 0 0",
                fontSize: 10,
                color: isNoid ? "rgba(250,245,233,0.5)" : "rgba(23,19,17,0.45)",
              }}>
                wants to connect · tap to review
              </p>
            </div>

            {/* Dismiss × */}
            <button
              onClick={onApprovalBannerDismiss}
              style={{
                flexShrink: 0,
                width: 22,
                height: 22,
                borderRadius: "50%",
                border: isNoid ? "1px solid rgba(250,245,233,0.15)" : "1px solid rgba(23,19,17,0.12)",
                background: "transparent",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: isNoid ? "rgba(250,245,233,0.45)" : "rgba(23,19,17,0.35)",
                padding: 0,
              }}>
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ─── Liquid Tab Bar (FIXED centering) ─── */}
      <LiquidTabBar
        tab={tab}
        isNoid={isNoid}
        onTabChange={(t) => {
          setTab(t)
          if (t !== "settings") setSettingsView("main")
        }}
      />

      <WalletSwitcher
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
      />

      <style>{`
        @keyframes liquidPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.4); opacity: 0.6; }
        }
        @keyframes liquidFloat {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-6px) scale(1.05); }
        }
        @keyframes liquidFadeIn {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes bannerSlideUp {
          0% { opacity: 0; transform: translateY(10px) scale(0.97); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        ::-webkit-scrollbar { width: 0; background: transparent; }
        ::-webkit-scrollbar-thumb { background: transparent; }
      `}</style>
    </div>
  )
}

/* ───────────────────────── Liquid Mode Morph ───────────────────────── */
function LiquidMorph({
  keyId,
  children
}: {
  keyId: string
  children: React.ReactNode
}) {
  const [current, setCurrent] = useState({ key: keyId, content: children })
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    if (keyId !== current.key) {
      setExiting(true)
      const t = setTimeout(() => {
        setCurrent({ key: keyId, content: children })
        setExiting(false)
      }, 240)
      return () => clearTimeout(t)
    } else {
      setCurrent({ key: keyId, content: children })
    }
  }, [keyId, children, current.key])

  return (
    <div
      style={{
        opacity: exiting ? 0 : 1,
        // Resting state is `none` (not identity transform / blur(0)) — a no-op
        // filter/transform forces a permanent compositing layer whose bounds
        // flicker a rectangular band over the content on repaint.
        transform: exiting ? "scale(0.96) translateY(8px)" : "none",
        transition: exiting
          ? `opacity 240ms ${EASE}, transform 240ms ${EASE}`
          : `opacity 520ms ${SPRING}, transform 520ms ${SPRING}`
      }}>
      {current.content}
    </div>
  )
}

/* ───────────────────────── Liquid Fade ───────────────────────── */
function LiquidFade({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ animation: `liquidFadeIn 480ms ${SPRING} both` }}>
      {children}
    </div>
  )
}

/* ───────────────────────── Liquid Mode Pill ───────────────────────── */
function LiquidModePill({
  mode,
  onSwitch
}: {
  mode: "open" | "noid"
  onSwitch: (target: "open" | "noid") => void
}) {
  const isNoid = mode === "noid"
  return (
    <div
      className="relative inline-flex items-center rounded-full p-0.5"
      style={{
        width: 116,
        background: isNoid
          ? "rgba(250,245,233,0.08)"
          : "rgba(23,19,17,0.07)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: isNoid
          ? "1px solid rgba(250,245,233,0.12)"
          : "1px solid rgba(23,19,17,0.08)",
        boxShadow: isNoid
          ? "inset 0 1px 0 rgba(255,255,255,0.05)"
          : "inset 0 1px 0 rgba(255,255,255,0.6)",
        transition: COLOR_TRANSITION
      }}>
      <span
        style={{
          position: "absolute",
          top: 2,
          bottom: 2,
          width: 54,
          left: mode === "open" ? 2 : 57,
          borderRadius: 999,
          background: isNoid
            ? "linear-gradient(135deg, #F6E6B4 0%, #EAD09A 100%)"
            : "linear-gradient(135deg, #171311 0%, #2A211C 100%)",
          boxShadow: isNoid
            ? "0 2px 8px rgba(250,245,233,0.3), inset 0 1px 0 rgba(255,255,255,0.5)"
            : "0 2px 8px rgba(23,19,17,0.4), inset 0 1px 0 rgba(255,255,255,0.1)",
          transition: `left 600ms ${SPRING}, background 500ms ${EASE}, box-shadow 500ms ${EASE}`
        }}
      />
      <button
        onClick={() => onSwitch("open")}
        className="relative z-10 px-3 py-1 text-[9px] font-semibold tracking-[0.25em] uppercase"
        style={{
          width: 54,
          color: mode === "open"
            ? "#FAF5E9"
            : isNoid ? "rgba(250,245,233,0.55)" : "rgba(23,19,17,0.55)",
          transition: `color 400ms ${EASE}`
        }}>
        Open
      </button>
      <button
        onClick={() => onSwitch("noid")}
        className="relative z-10 px-3 py-1 text-[9px] font-semibold tracking-[0.25em] uppercase"
        style={{
          width: 54,
          color: mode === "noid"
            ? "#171311"
            : isNoid ? "rgba(250,245,233,0.55)" : "rgba(23,19,17,0.55)",
          transition: `color 400ms ${EASE}`
        }}>
        Noid
      </button>
    </div>
  )
}

/* ───────────────────────── Liquid Tab Bar ─────────────────────────
   One single pill slides across all three tab positions — exactly like
   LiquidModePill. The pill is a sibling of the buttons, absolutely
   positioned inside the grid container. Each button is 1/3 of 360px
   minus padding = (360 - 32) / 3 ≈ 109px wide. The pill slides via
   `left` transition so it never pops or fades between tabs. */
function LiquidTabBar({
  tab,
  isNoid,
  onTabChange
}: {
  tab: Tab
  isNoid: boolean
  onTabChange: (t: Tab) => void
}) {
  const tabs: [Tab, string, string][] = [
    ["wallet",   "◈", "Wallet"],
    ["activity", "◉", "Activity"],
    ["settings", "◎", "Settings"],
  ]

  const activeIdx = tabs.findIndex(([t]) => t === tab)

  // Pill width and per-slot width. We use % so it works at any container size.
  const PILL_W   = 72   // px — visual pill width
  const PILL_H   = 48   // px

  return (
    <div
      className="relative z-30 shrink-0"
      style={{
        // FULLY opaque, matched to the page's bottom tone, and NO forced layer
        // (no backdrop-filter, no translateZ). A transparent/composited bar
        // sampled the backdrop wrong on the first frame, leaving a band until a
        // repaint; an opaque bar with no layer simply can't glitch.
        background: isNoid ? "#100C0A" : "#EAD5A7",
        borderTop: isNoid
          ? "1px solid rgba(250,245,233,0.08)"
          : "1px solid rgba(23,19,17,0.08)",
        transition: COLOR_TRANSITION,
      }}>
      <div
        className="relative grid px-4 py-3"
        style={{ gridTemplateColumns: "repeat(3, 1fr)" }}
      >
        {/* Single sliding pill — uses the treasury-card colour (#3) */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            // Centre the pill within its 1/3 slot.
            // Each slot = (100% - 32px) / 3. Active slot starts at activeIdx * slotW.
            // We use calc to stay layout-agnostic.
            left: `calc(${activeIdx} * (100% - 32px) / 3 + 16px + (100% - 32px) / 6 - ${PILL_W / 2}px)`,
            top:  `calc(50% - ${PILL_H / 2}px)`,
            width:  PILL_W,
            height: PILL_H,
            borderRadius: 16,
            background: isNoid
              ? "linear-gradient(135deg, #FBF1D9 0%, #EAD5A7 100%)"
              : "linear-gradient(145deg, #3A2C1C 0%, #241A10 100%)",
            boxShadow: isNoid
              ? "0 4px 14px rgba(250,245,233,0.18), inset 0 1px 0 rgba(255,255,255,0.5)"
              : "0 4px 14px rgba(0,0,0,0.4), inset 0 1px 0 rgba(251,241,217,0.08)",
            pointerEvents: "none",
            zIndex: 0,
            // Smooth spring slide between positions
            transition: `left 500ms ${SPRING}, background 500ms ${EASE}, box-shadow 500ms ${EASE}`,
          }}
        />

        {tabs.map(([t, icon, label]) => (
          <LiquidTabButton
            key={t}
            isActive={tab === t}
            isNoid={isNoid}
            icon={icon}
            label={label}
            onClick={() => onTabChange(t)}
          />
        ))}
      </div>
    </div>
  )
}

/* Tab button — no individual indicator any more, just icon + label */
function LiquidTabButton({
  isActive,
  isNoid,
  icon,
  label,
  onClick
}: {
  isActive: boolean
  isNoid: boolean
  icon: string
  label: string
  onClick: () => void
}) {
  const [pressed, setPressed] = useState(false)

  return (
    <button
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      className="relative z-10 flex flex-col items-center justify-center gap-1 py-1.5"
      style={{
        // Active symbol = the mode-view background colour (light in open, dark in
        // noid) so it reads as a negative against the treasury-coloured pill.
        color: isActive
          ? (isNoid ? "#171311" : "#FBF1D9")
          : isNoid ? "rgba(250,245,233,0.4)" : "rgba(23,19,17,0.4)",
        transition: `color 500ms ${EASE}, transform 300ms ${SPRING}`,
        transform: pressed ? "scale(0.94)" : "scale(1)",
      }}>
      <span
        className="relative text-base leading-none"
        style={{
          transform: isActive ? "scale(1.15)" : "scale(1)",
          transition: `transform 500ms ${SPRING}`,
        }}>
        {icon}
      </span>
      <span className="relative text-[9px] tracking-[0.3em] uppercase">
        {label}
      </span>
    </button>
  )
}

/* ───────────────────────── Settings ───────────────────────── */
function SettingsMain({
  mode,
  sidebarMode,
  toggleHint,
  onSidebarToggle,
  onModeSwitch,
  onOpenAccountDetails,
  onOpenConnections,
  onLock,
}: {
  mode: "open" | "noid"
  sidebarMode: boolean
  toggleHint: string | null
  onSidebarToggle: (v: boolean) => void
  onModeSwitch: (t: "open" | "noid") => void
  onOpenAccountDetails: () => void
  onOpenConnections: () => void
  onLock: () => void
}) {
  const isNoid = mode === "noid"

  const liquidCardStyle: React.CSSProperties = {
    // Warm cream cards in open mode (matched to the page background) instead of
    // the near-white tint; a touch warmer in noid too.
    background: isNoid
      ? "rgba(243,227,186,0.055)"
      : "rgba(232,211,164,0.5)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    border: isNoid
      ? "1px solid rgba(244,231,204,0.12)"
      : "1px solid rgba(163,110,20,0.18)",
    boxShadow: isNoid
      ? "inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 16px rgba(0,0,0,0.2)"
      : "inset 0 1px 0 rgba(255,255,255,0.55), 0 4px 16px rgba(120,80,20,0.08)",
    transition: COLOR_TRANSITION
  }

  return (
    <div className="px-5 pt-6 pb-6 space-y-3">
      <p
        className="text-[9px] tracking-[0.4em] uppercase mb-2"
        style={{
          color: isNoid ? "rgba(250,245,233,0.45)" : "rgba(23,19,17,0.4)",
          transition: COLOR_TRANSITION,
          animation: `liquidFadeIn 400ms ${SPRING} both`
        }}>
        Settings
      </p>

      {/* Account Details */}
      <LiquidButton
        onClick={onOpenAccountDetails}
        className="w-full text-left p-4 rounded-2xl"
        style={{
          ...liquidCardStyle,
          animation: `liquidFadeIn 500ms ${SPRING} 60ms both`
        }}>
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full"
            style={{
              background: isNoid ? "linear-gradient(145deg, #FBF1D9 0%, #EAD5A7 100%)" : "linear-gradient(145deg, #3A2C1C 0%, #241A10 100%)",
              border: isNoid ? "1px solid rgba(23,19,17,0.1)" : "1px solid rgba(251,241,217,0.1)",
              boxShadow: isNoid ? "inset 0 1px 0 rgba(255,255,255,0.5)" : "inset 0 1px 0 rgba(251,241,217,0.08)",
              color: isNoid ? "#171311" : "#F4E7CC"
            }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor">
              <circle cx="4" cy="7" r="2.2" strokeWidth="1.3" />
              <path d="M6.2 7H13M11.5 7v2M9.5 7v1.4" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold">Account Details</p>
            <p
              className="text-[11px] mt-0.5 leading-snug"
              style={{
                color: isNoid ? "rgba(250,245,233,0.55)" : "rgba(23,19,17,0.5)",
                transition: COLOR_TRANSITION
              }}>
              Reveal your keys & recovery phrase
            </p>
          </div>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M3 1L7 5L3 9"
              className="ink-stroke" strokeOpacity="0.35"
              strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </LiquidButton>

      {/* Connected Sites */}
      <LiquidButton
        onClick={onOpenConnections}
        className="w-full text-left p-4 rounded-2xl"
        style={{
          ...liquidCardStyle,
          animation: `liquidFadeIn 500ms ${SPRING} 100ms both`
        }}>
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full"
            style={{
              background: isNoid ? "linear-gradient(145deg, #FBF1D9 0%, #EAD5A7 100%)" : "linear-gradient(145deg, #3A2C1C 0%, #241A10 100%)",
              border: isNoid ? "1px solid rgba(23,19,17,0.1)" : "1px solid rgba(251,241,217,0.1)",
              boxShadow: isNoid ? "inset 0 1px 0 rgba(255,255,255,0.5)" : "inset 0 1px 0 rgba(251,241,217,0.08)",
              color: isNoid ? "#171311" : "#F4E7CC"
            }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor">
              <circle cx="7" cy="7" r="5" strokeWidth="1.3" />
              <circle cx="7" cy="7" r="2" strokeWidth="1.3" />
              <path d="M7 2V5" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M7 9V12" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M2 7H5" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M9 7H12" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold">Connected Sites</p>
            <p
              className="text-[11px] mt-0.5 leading-snug"
              style={{
                color: isNoid ? "rgba(250,245,233,0.55)" : "rgba(23,19,17,0.5)",
                transition: COLOR_TRANSITION
              }}>
              Manage dapp connections
            </p>
          </div>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M3 1L7 5L3 9"
              className="ink-stroke" strokeOpacity="0.35"
              strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </LiquidButton>




      {/* Sidebar Mode */}
      <div
        className="p-4 rounded-2xl"
        style={{
          ...liquidCardStyle,
          animation: `liquidFadeIn 500ms ${SPRING} 140ms both`
        }}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">Sidebar Mode</p>
            <p
              className="text-[11px] mt-0.5 leading-snug"
              style={{
                color: isNoid ? "rgba(250,245,233,0.55)" : "rgba(23,19,17,0.5)",
                transition: COLOR_TRANSITION
              }}>
              Show wallet as a side panel
            </p>
          </div>
          <LiquidSwitch checked={sidebarMode} onChange={onSidebarToggle} isNoid={isNoid} />
        </div>
        {toggleHint && (
          <div
            className="mt-3 flex items-start gap-2 p-2.5 rounded-xl"
            style={{
              background: "rgba(163,110,20,0.1)",
              border: "1px solid rgba(163,110,20,0.25)",
              animation: `liquidFadeIn 400ms ${SPRING} both`
            }}>
            <span className="h-1.5 w-1.5 rounded-full bg-goldDeep shrink-0 mt-1.5" />
            <p
              className="text-[11px] leading-snug"
              style={{
                color: isNoid ? "rgba(250,245,233,0.8)" : "rgba(23,19,17,0.75)",
                transition: COLOR_TRANSITION
              }}>
              {toggleHint}
            </p>
          </div>
        )}
      </div>

      {/* Noid Mode */}
      <div
        className="flex items-center justify-between gap-3 p-4 rounded-2xl"
        style={{
          ...liquidCardStyle,
          animation: `liquidFadeIn 500ms ${SPRING} 180ms both`
        }}>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">Noid Mode</p>
          <p
            className="text-[11px] mt-0.5 leading-snug"
            style={{
              color: isNoid ? "rgba(250,245,233,0.55)" : "rgba(23,19,17,0.5)",
              transition: COLOR_TRANSITION
            }}>
            Show ZK / Menoid-derived keys
          </p>
        </div>
        <LiquidSwitch
          checked={mode === "noid"}
          onChange={(v) => onModeSwitch(v ? "noid" : "open")}
          isNoid={isNoid}
        />
      </div>

      {/* Lock */}
      <LiquidButton
        onClick={onLock}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-[12px] tracking-[0.2em] uppercase"
        style={{
          background: isNoid
            ? "rgba(250,245,233,0.03)"
            : "rgba(23,19,17,0.03)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: isNoid
            ? "1px solid rgba(250,245,233,0.12)"
            : "1px solid rgba(23,19,17,0.1)",
          color: isNoid ? "rgba(250,245,233,0.6)" : "rgba(23,19,17,0.6)",
          animation: `liquidFadeIn 500ms ${SPRING} 260ms both`,
          transition: COLOR_TRANSITION
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = "rgba(248,113,113,0.4)"
          ;(e.currentTarget as HTMLElement).style.color = "rgb(239,68,68)"
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = isNoid
            ? "rgba(250,245,233,0.12)"
            : "rgba(23,19,17,0.1)"
          ;(e.currentTarget as HTMLElement).style.color = isNoid
            ? "rgba(250,245,233,0.6)"
            : "rgba(23,19,17,0.6)"
        }}>
        <svg width="13" height="14" viewBox="0 0 13 14" fill="none">
          <rect x="1.5" y="6" width="10" height="7" rx="1.5"
            stroke="currentColor" strokeWidth="1.2" />
          <path d="M3.5 6V4.5a3 3 0 116 0V6"
            stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        Lock Wallet
      </LiquidButton>
    </div>
  )
}

/* ───────────────────────── Liquid Switch ───────────────────────── */
function LiquidSwitch({
  checked,
  onChange,
  isNoid = false
}: {
  checked: boolean
  onChange: (v: boolean) => void
  isNoid?: boolean
}) {
  // "On" uses the theme colour (dark coffee in open, light cream in noid) — the
  // inverse of the page, like the treasury card — instead of gold.
  const onBg = isNoid
    ? "linear-gradient(135deg, #FBF1D9 0%, #EAD5A7 100%)"
    : "linear-gradient(135deg, #3A2C1C 0%, #241A10 100%)"
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 26,
        borderRadius: 999,
        position: "relative",
        background: checked ? onBg : isNoid ? "rgba(250,245,233,0.16)" : "rgba(23,19,17,0.16)",
        boxShadow: checked
          ? (isNoid ? "0 2px 8px rgba(250,245,233,0.3), inset 0 1px 0 rgba(255,255,255,0.5)" : "0 2px 8px rgba(0,0,0,0.35), inset 0 1px 0 rgba(251,241,217,0.12)")
          : "inset 0 1px 3px rgba(0,0,0,0.2)",
        transition: `background 500ms ${EASE}, box-shadow 500ms ${EASE}`,
        cursor: "pointer",
        border: "none",
        padding: 0
      }}>
      <span
        style={{
          position: "absolute",
          top: 2,
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: checked && isNoid ? "#171311" : "white",
          boxShadow: "0 2px 6px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.8)",
          transform: checked ? "translateX(-1.5px) scale(1)" : "translateX(-20px) scale(1)",
          transition: `transform 500ms ${SPRING}, background 500ms ${EASE}`
        }}
      />
    </button>
  )
}

/* ───────────────────────── Liquid Backdrop ───────────────────────── */
function Backdrop({ isNoid }: { isNoid: boolean }) {
  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          opacity: isNoid ? 0 : 1,
          backgroundImage: "linear-gradient(to bottom, #FBF1D9, #F4E7CC, #EAD5A7)",
          transition: `opacity 700ms ${EASE}`
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          opacity: isNoid ? 1 : 0,
          backgroundImage: "linear-gradient(to bottom, #0F0B09, #171311 55%, #100C0A)",
          transition: `opacity 700ms ${EASE}`
        }}
      />
      {/* Unified token grid — fills the whole viewport so short pages never
          show an ungridded "empty" band below their content. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: isNoid ? 0.03 : 0.045,
          backgroundImage: isNoid
            ? "linear-gradient(to right,#FBF1D9 1px,transparent 1px),linear-gradient(to bottom,#FBF1D9 1px,transparent 1px)"
            : "linear-gradient(to right,#171311 1px,transparent 1px),linear-gradient(to bottom,#171311 1px,transparent 1px)",
          backgroundSize: "28px 28px",
          transition: `opacity 700ms ${EASE}`
        }}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          top: "-4%",
          right: "-18%",
          width: 340,
          height: 340,
          borderRadius: "50%",
          // Soft radial (no `filter: blur`) — a filter layer renders unfiltered
          // for one frame on open, flashing a hard-edged circle. The gradient
          // falloff gives the same glow with no compositing layer.
          background: isNoid
            ? "radial-gradient(circle, rgba(232,174,58,0.16) 0%, transparent 66%)"
            : "radial-gradient(circle, rgba(232,174,58,0.15) 0%, transparent 66%)",
          transition: `background 700ms ${EASE}`
        }}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          bottom: "4%",
          left: "-22%",
          width: 380,
          height: 380,
          borderRadius: "50%",
          background: isNoid
            ? "radial-gradient(circle, rgba(163,110,20,0.16) 0%, transparent 66%)"
            : "radial-gradient(circle, rgba(163,110,20,0.09) 0%, transparent 66%)",
          transition: `background 700ms ${EASE}`
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 paper-grain"
        style={{
          opacity: isNoid ? 0.08 : 0.2,
          transition: `opacity 700ms ${EASE}`
        }}
      />
    </>
  )
}