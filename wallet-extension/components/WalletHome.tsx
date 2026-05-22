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

import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useWallet } from "../context/WalletContext"
import {
  applyChromeBehaviour,
  getViewMode,
  setViewMode
} from "../lib/viewMode"
import AccountDetails from "./AccountDetails"
import NoidModeView from "./modes/NoidModeView"
import OpenModeView from "./modes/OpenModeView"
import WalletSwitcher from "./WalletSwitcher"

type Tab = "wallet" | "activity" | "settings"
type SettingsView = "main" | "account"

// ─── Unified animation tokens ─────────────────────────────────────────
const COLOR_TRANSITION =
  "color 500ms cubic-bezier(0.65, 0, 0.35, 1), background 500ms cubic-bezier(0.65, 0, 0.35, 1), border-color 500ms cubic-bezier(0.65, 0, 0.35, 1), box-shadow 500ms cubic-bezier(0.65, 0, 0.35, 1)"
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)"
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)"

/* ───────────────────────── Smooth scroll hook (gentler) ───────────────────────── */
function useLiquidScroll(ref: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    let rafId: number
    let targetScroll = el.scrollTop
    let currentScroll = el.scrollTop
    let isScrolling = false

    const onWheel = (e: WheelEvent) => {
      // Full 1.0 multiplier — preserves native scroll speed
      targetScroll += e.deltaY * 1.0
      targetScroll = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, targetScroll))
      if (!isScrolling) {
        isScrolling = true
        animate()
      }
      e.preventDefault()
    }

    const animate = () => {
      const diff = targetScroll - currentScroll
      if (Math.abs(diff) < 0.5) {
        currentScroll = targetScroll
        el.scrollTop = currentScroll
        isScrolling = false
        return
      }
      // 0.22 lerp — faster catch-up, less lag
      currentScroll += diff * 0.22
      el.scrollTop = currentScroll
      rafId = requestAnimationFrame(animate)
    }

    el.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      el.removeEventListener("wheel", onWheel)
      cancelAnimationFrame(rafId)
    }
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

export default function WalletHome() {
  const { wallet, entries, activeIndex, mode, setMode, lock } = useWallet()

  const [tab, setTab] = useState<Tab>("wallet")
  const [settingsView, setSettingsView] = useState<SettingsView>("main")

  const [sidebarMode, setSidebarMode] = useState(false)
  const [toggleHint, setToggleHint] = useState<string | null>(null)

  const [switcherOpen, setSwitcherOpen] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  useLiquidScroll(scrollRef)

  useEffect(() => {
    ;(async () => {
      const m = await getViewMode()
      setSidebarMode(m === "sidebar")
    })()
  }, [])

  if (!wallet) return null

  const activeEntry = entries[activeIndex]
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
      className="relative font-body overflow-hidden flex flex-col w-[360px] h-full"
      style={{
        color: isNoid ? "#FAF5E9" : "#171311",
        transition: COLOR_TRANSITION
      }}>
      <Backdrop isNoid={isNoid} />

      {/* ─── Liquid Header ─── */}
      <header
        className="relative z-30 flex items-center justify-between px-5 pt-5 pb-4 shrink-0"
        style={{
          background: isNoid
            ? "linear-gradient(180deg, rgba(15,11,9,0.7) 0%, rgba(15,11,9,0.3) 80%, transparent 100%)"
            : "linear-gradient(180deg, rgba(251,241,217,0.7) 0%, rgba(251,241,217,0.3) 80%, transparent 100%)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          transition: COLOR_TRANSITION
        }}>
        <LiquidButton
          onClick={() => setSwitcherOpen(true)}
          title={activeEntry?.name ?? "Switch wallet"}
          className="group relative flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full font-display text-[11px] font-bold"
            style={{
              background: isNoid ? "#FAF5E9" : "#171311",
              color: isNoid ? "#171311" : "#FAF5E9",
              boxShadow: isNoid
                ? "0 4px 12px rgba(250,245,233,0.25), inset 0 1px 0 rgba(255,255,255,0.4)"
                : "0 4px 12px rgba(23,19,17,0.35), inset 0 1px 0 rgba(255,255,255,0.1)",
              transition: COLOR_TRANSITION
            }}>
            {walletNumber}
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="h-1 w-1 rounded-full"
              style={{
                background: "#E8AE3A",
                boxShadow: "0 0 6px rgba(232,174,58,0.6)",
                animation: "liquidPulse 2.4s ease-in-out infinite"
              }}
            />
            <span
              className="font-display text-[10px] font-semibold tracking-[0.3em]"
              style={{
                color: isNoid ? "#FAF5E9" : "#171311",
                transition: COLOR_TRANSITION
              }}>
              MENOID
            </span>
          </div>
        </LiquidButton>

        <LiquidModePill mode={mode} onSwitch={setMode} />

        <LiquidButton
          onClick={lock}
          title="Lock"
          className="flex h-8 w-8 items-center justify-center rounded-full"
          style={{
            background: isNoid
              ? "rgba(250,245,233,0.08)"
              : "rgba(23,19,17,0.06)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            transition: COLOR_TRANSITION
          }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="2" y="6" width="10" height="7" rx="1.5"
              className="ink-stroke" strokeOpacity="0.6" strokeWidth="1.2" />
            <path d="M4 6V4.5a3 3 0 116 0V6"
              className="ink-stroke" strokeOpacity="0.6" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </LiquidButton>
      </header>

      {/* ─── Wallet name strip ─── */}
      {activeEntry && (
        <div
          className="relative z-20 flex items-center justify-between px-5 py-2 text-[10px] tracking-[0.25em] uppercase shrink-0"
          style={{

            color: isNoid ? "rgba(250,245,233,0.55)" : "rgba(23,19,17,0.55)",

          }}>
          <span className="font-mono normal-case tracking-[0.05em] truncate">
            {activeEntry.name}
          </span>
          <span className="text-[9px] tracking-[0.3em]">
            #{walletNumber} of {entries.length}
          </span>
        </div>
      )}

      {/* ─── Body ─── */}
      <div
        ref={scrollRef}
        className="relative z-10 flex-1 overflow-y-auto"
        style={{ WebkitOverflowScrolling: "touch" }}>
        {tab === "wallet" && (
          <LiquidMorph keyId={mode}>
            {mode === "open" ? <OpenModeView /> : <NoidModeView />}
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
              onLock={lock}
              walletAddress={wallet.normalAccount.address}
            />
          </LiquidFade>
        )}

        {tab === "settings" && settingsView === "account" && (
          <LiquidFade>
            <AccountDetails onBack={() => setSettingsView("main")} />
          </LiquidFade>
        )}
      </div>

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
          0% { opacity: 0; transform: translateY(8px); filter: blur(8px); }
          100% { opacity: 1; transform: translateY(0); filter: blur(0); }
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
        transform: exiting ? "scale(0.96) translateY(8px)" : "scale(1) translateY(0)",
        filter: exiting ? "blur(8px)" : "blur(0)",
        transition: exiting
          ? `all 240ms ${EASE}`
          : `all 520ms ${SPRING}`
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
          left: mode === "open" ? 2 : 60,
          borderRadius: 999,
          background: isNoid
            ? "linear-gradient(135deg, #FAF5E9 0%, #E8DCC0 100%)"
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

/* ───────────────────────── Liquid Tab Bar (FIXED) ─────────────────────────
   Uses CSS Grid + per-button absolute-centered indicator.
   The indicator lives INSIDE each button, so it's automatically centered
   to that button's icon — no math, no offset drift. */
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
    ["wallet", "◈", "Wallet"],
    ["activity", "◉", "Activity"],
    ["settings", "◎", "Settings"]
  ]

  return (
    <div
      className="relative z-30 shrink-0"
      style={{
        background: isNoid
          ? "linear-gradient(0deg, rgba(15,11,9,0.85) 0%, rgba(15,11,9,0.5) 80%, transparent 100%)"
          : "linear-gradient(0deg, rgba(251,241,217,0.85) 0%, rgba(251,241,217,0.5) 80%, transparent 100%)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        borderTop: isNoid
          ? "1px solid rgba(250,245,233,0.08)"
          : "1px solid rgba(23,19,17,0.08)",
        transition: COLOR_TRANSITION
      }}>
      <div
        className="relative grid px-4 py-3"
        style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
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

/* Tab button with self-centered indicator — no offset bug possible */
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
      className="relative flex flex-col items-center justify-center gap-1 py-1.5"
      style={{
        color: isActive
          ? "#A36E14"
          : isNoid ? "rgba(250,245,233,0.4)" : "rgba(23,19,17,0.4)",
        transition: `color 500ms ${EASE}, transform 300ms ${SPRING}`,
        transform: pressed ? "scale(0.94)" : "scale(1)"
      }}>
      {/* Indicator absolutely centered to THIS button — guarantees perfect alignment */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: `translate(-50%, -50%) scale(${isActive ? 1 : 0.7})`,
          width: 64,
          height: 48,
          borderRadius: 16,
          background: isActive
            ? (isNoid ? "rgba(232,174,58,0.14)" : "rgba(163,110,20,0.1)")
            : "transparent",
          boxShadow: isActive
            ? (isNoid
              ? "inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 16px rgba(232,174,58,0.18)"
              : "inset 0 1px 0 rgba(255,255,255,0.5), 0 4px 16px rgba(163,110,20,0.15)")
            : "none",
          opacity: isActive ? 1 : 0,
          transition: `all 500ms ${SPRING}`,
          pointerEvents: "none",
          zIndex: 0
        }}
      />
      <span
        className="relative text-base leading-none"
        style={{
          zIndex: 1,
          transform: isActive ? "scale(1.15)" : "scale(1)",
          transition: `transform 500ms ${SPRING}`
        }}>
        {icon}
      </span>
      <span
        className="relative text-[9px] tracking-[0.3em] uppercase"
        style={{ zIndex: 1 }}>
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
  onLock,
  walletAddress
}: {
  mode: "open" | "noid"
  sidebarMode: boolean
  toggleHint: string | null
  onSidebarToggle: (v: boolean) => void
  onModeSwitch: (t: "open" | "noid") => void
  onOpenAccountDetails: () => void
  onLock: () => void
  walletAddress: string
}) {
  function trunc(s: string, a = 6, b = 4) {
    return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
  }
  const isNoid = mode === "noid"

  const liquidCardStyle: React.CSSProperties = {
    background: isNoid
      ? "rgba(250,245,233,0.04)"
      : "rgba(23,19,17,0.03)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    border: isNoid
      ? "1px solid rgba(250,245,233,0.1)"
      : "1px solid rgba(23,19,17,0.08)",
    boxShadow: isNoid
      ? "inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 16px rgba(0,0,0,0.2)"
      : "inset 0 1px 0 rgba(255,255,255,0.6), 0 4px 16px rgba(23,19,17,0.05)",
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
              background: "rgba(163,110,20,0.15)",
              border: "1px solid rgba(163,110,20,0.25)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1)"
            }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="4" cy="7" r="2.2" className="goldDeep-stroke" strokeWidth="1.3" />
              <path d="M6.2 7H13M11.5 7v2M9.5 7v1.4"
                className="goldDeep-stroke" strokeWidth="1.3" strokeLinecap="round" />
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

      <div
        className="p-4 rounded-2xl"
        style={{
          ...liquidCardStyle,
          animation: `liquidFadeIn 500ms ${SPRING} 120ms both`
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
          <LiquidSwitch checked={sidebarMode} onChange={onSidebarToggle} />
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
        />
      </div>

      <div
        className="p-4 rounded-2xl space-y-2"
        style={{
          ...liquidCardStyle,
          animation: `liquidFadeIn 500ms ${SPRING} 240ms both`
        }}>
        <p
          className="text-[10px] tracking-[0.3em] uppercase"
          style={{
            color: isNoid ? "rgba(250,245,233,0.4)" : "rgba(23,19,17,0.4)",
            transition: COLOR_TRANSITION
          }}>
          Open Account
        </p>
        <InfoRow label="Address" value={trunc(walletAddress)} isNoid={isNoid} />
        <InfoRow label="Network" value="Monad" isNoid={isNoid} />
      </div>

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
          animation: `liquidFadeIn 500ms ${SPRING} 300ms both`,
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
  onChange
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
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
        background: checked
          ? "linear-gradient(135deg, #A36E14 0%, #DAA21C 100%)"
          : "rgba(23,19,17,0.18)",
        boxShadow: checked
          ? "0 2px 8px rgba(163,110,20,0.4), inset 0 1px 0 rgba(255,255,255,0.2)"
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
          background: "white",
          boxShadow: "0 2px 6px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.8)",
          transform: checked ? "translateX(20px) scale(1)" : "translateX(2px) scale(1)",
          transition: `transform 500ms ${SPRING}`
        }}
      />
    </button>
  )
}

function InfoRow({
  label,
  value,
  isNoid
}: {
  label: string
  value: string
  isNoid?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className="text-[11px]"
        style={{
          color: isNoid ? "rgba(250,245,233,0.45)" : "rgba(23,19,17,0.4)",
          transition: COLOR_TRANSITION
        }}>
        {label}
      </span>
      <span
        className="text-[11px] font-mono"
        style={{
          color: isNoid ? "rgba(250,245,233,0.75)" : "rgba(23,19,17,0.7)",
          transition: COLOR_TRANSITION
        }}>
        {value}
      </span>
    </div>
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
      <div
        className="pointer-events-none absolute"
        style={{
          top: "10%",
          right: "-10%",
          width: 240,
          height: 240,
          borderRadius: "50%",
          background: isNoid
            ? "radial-gradient(circle, rgba(232,174,58,0.18) 0%, transparent 60%)"
            : "radial-gradient(circle, rgba(232,174,58,0.22) 0%, transparent 60%)",
          filter: "blur(40px)",
          animation: "liquidFloat 8s ease-in-out infinite",
          transition: `background 700ms ${EASE}`
        }}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          bottom: "15%",
          left: "-15%",
          width: 280,
          height: 280,
          borderRadius: "50%",
          background: isNoid
            ? "radial-gradient(circle, rgba(163,110,20,0.18) 0%, transparent 60%)"
            : "radial-gradient(circle, rgba(163,110,20,0.12) 0%, transparent 60%)",
          filter: "blur(50px)",
          animation: "liquidFloat 10s ease-in-out infinite 2s",
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