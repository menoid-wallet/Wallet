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
import AccountDetails from "./AccountDetails"
import ConnectionsView from "./ConnectionsView"
import FeedbackModal from "./FeedbackModal"
import NoidModeView from "./modes/NoidModeView"
import OpenModeView from "./modes/OpenModeView"
import WalletSwitcher from "./WalletSwitcher"
import { Sparkles } from "./brand/Sky"
import Storm from "./brand/Rain"
import { CloudBank, CloudDefs } from "./brand/Clouds"
import { type NetworkId } from "../lib/networks"
import { themeTokens } from "../lib/useThemeTokens"
import { CHAINS } from "../lib/chains"
import { type TreasureChain } from "../context/WalletContext"

type Tab = "wallet" | "explore" | "settings"
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
  const { wallet, entries, activeIndex, mode, setMode, lock, treasureChain, setTreasureChain } = useWallet()

  const [tab, setTab] = useState<Tab>("wallet")
  const [settingsView, setSettingsView] = useState<SettingsView>("main")

  const [sidebarMode, setSidebarMode] = useState(false)
  const [toggleHint, setToggleHint] = useState<string | null>(null)

  const [switcherOpen, setSwitcherOpen] = useState(false)

  // ── Feedback survey ──────────────────────────────────────────────────────
  const [feedbackOpen, setFeedbackOpen] = useState(false)

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

  const activeEntry = entries[activeIndex]

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
  const t = themeTokens(isNoid)

  useLayoutEffect(() => {
    const root = document.documentElement
    if (isNoid) root.classList.add("noid-theme")
    else root.classList.remove("noid-theme")
    return () => root.classList.remove("noid-theme")
  }, [isNoid])

  return (
    <div
      className="relative isolate font-body overflow-hidden flex flex-col w-full h-full"
      style={{
        color: t.ink,
        // Opaque base behind the (transparent) scroll body. Without it the body
        // briefly shows the popup's lighter default on the first frame — the
        // band that lingered until the first repaint (~1s) cleared it. It is a
        // flat mid tone of each sky, not the gradient: this only ever shows for
        // one frame, and it only has to not be white.
        background: isNoid ? "#33205e" : "#b197e9",
        transition: COLOR_TRANSITION
      }}>
      <Backdrop isNoid={isNoid} />
      {/* Every cloud on this surface — the floor here, the treasure cards in
          both mode views — references these. Rendered once, above all of them. */}
      <CloudDefs />

      {/* ─── Header ───
             A wash rather than a bar: opaque at the top, gone by the bottom, so
             content scrolls up into the sky instead of under a hard edge. */}
      <header
        className="relative z-30 flex items-center justify-between px-5 pt-5 pb-4 shrink-0"
        style={{
          background: isNoid
            ? "linear-gradient(180deg, rgba(29,17,64,0.78) 0%, rgba(29,17,64,0.34) 78%, transparent 100%)"
            : "linear-gradient(180deg, rgba(196,173,240,0.72) 0%, rgba(196,173,240,0.3) 78%, transparent 100%)",
          backdropFilter: "blur(18px) saturate(150%)",
          WebkitBackdropFilter: "blur(18px) saturate(150%)",
          transition: COLOR_TRANSITION
        }}>
        <LiquidButton
          onClick={() => setSwitcherOpen(true)}
          title={activeEntry?.name ?? "Switch wallet"}
          className="group relative flex items-center gap-2.5">
          {/* The wallet number is the one solid chip up here, so it flips to the
              opposite end of the palette in each mode — white on the storm,
              violet on the clear sky. */}
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full font-round text-[11px] font-bold"
            style={{
              background: isNoid ? "#F1E9FF" : "var(--violet-deep)",
              color: isNoid ? "var(--violet-deep)" : "#F6EFFF",
              boxShadow: isNoid
                ? "0 4px 12px rgba(201,176,255,0.32), inset 0 1px 0 rgba(255,255,255,0.6)"
                : "0 4px 12px rgba(48,26,96,0.4), inset 0 1px 0 rgba(255,255,255,0.18)",
              transition: COLOR_TRANSITION
            }}>
            {walletNumber}
          </div>
          <div className="flex flex-col items-start text-left">
            <div className="flex items-center gap-1.5 leading-none">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: t.accent,
                  boxShadow: `0 0 6px rgba(${t.accentRgb},0.7)`,
                  animation: "liquidPulse 2.4s ease-in-out infinite",
                  transition: COLOR_TRANSITION
                }}
              />
              <span
                className="font-round text-[10px] font-semibold tracking-[0.3em] leading-none"
                style={{ color: t.ink, transition: COLOR_TRANSITION }}>
                MENOID
              </span>
            </div>
            {activeEntry && (
              <span
                className="font-mono text-[9px] lowercase tracking-[0.05em] opacity-65 mt-0.5 max-w-[120px] truncate"
                style={{ color: t.ink, transition: COLOR_TRANSITION }}>
                {activeEntry.name}
              </span>
            )}
          </div>
        </LiquidButton>

        <LiquidModePill mode={mode} onSwitch={setMode} />

        {/* ─── Feedback indicator ─── */}
        <LiquidButton
          onClick={() => setFeedbackOpen(true)}
          title="Share feedback"
          className="relative flex h-8 w-8 items-center justify-center rounded-full"
          style={{
            background: t.glass,
            border: `1px solid ${t.glassLine}`,
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            transition: COLOR_TRANSITION
          }}>
          {/* speech-bubble glyph */}
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path
              d="M2.5 6.2C2.5 4.4 4 3 5.8 3h4.4C12 3 13.5 4.4 13.5 6.2v2.1c0 1.8-1.5 3.2-3.3 3.2H7l-2.7 2v-2.1c-1-.4-1.8-1.5-1.8-2.9z"
              stroke={t.ink}
              strokeOpacity="0.85"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <circle cx="6" cy="7.3" r="0.8" fill={t.ink} />
            <circle cx="8" cy="7.3" r="0.8" fill={t.ink} />
            <circle cx="10" cy="7.3" r="0.8" fill={t.ink} />
          </svg>
          {/* gentle attention dot */}
          <span
            className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full"
            style={{
              background: t.accent,
              boxShadow: `0 0 6px rgba(${t.accentRgb},0.7)`,
              animation: "liquidPulse 2.4s ease-in-out infinite",
              transition: COLOR_TRANSITION
            }}
          />
        </LiquidButton>
      </header>



      {/* ─── Body ─── */}
      <div
        ref={scrollRef}
        className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden"
        style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
        {tab === "wallet" && (
          <LiquidMorph keyId={mode}>
            {mode === "open" ? (
              <OpenModeView activeCoin={activeCoin} setActiveCoin={setActiveCoin} scrollToTop={resetScroll} reverseMorph={reverseMorph} setReverseMorph={setReverseMorph} />
            ) : (
              <NoidModeView activeCoin={activeCoin} setActiveCoin={setActiveCoin} scrollToTop={resetScroll} reverseMorph={reverseMorph} setReverseMorph={setReverseMorph} />
            )}
          </LiquidMorph>
        )}

        {tab === "explore" && (
          <LiquidFade>
            <ExploreView isNoid={isNoid} />
          </LiquidFade>
        )}

        {tab === "settings" && settingsView === "main" && (
          <LiquidFade>
            <SettingsMain
              mode={mode}
              sidebarMode={sidebarMode}
              toggleHint={toggleHint}
              treasureChain={treasureChain}
              onTreasureChainChange={setTreasureChain}
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
                ? "linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(201,176,255,0.10) 100%)"
                : "linear-gradient(135deg, rgba(255,255,255,0.62) 0%, rgba(214,192,250,0.42) 100%)",
              border: `1px solid ${t.glassLine}`,
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxShadow: isNoid
                ? "0 4px 20px rgba(12,6,30,0.4)"
                : "0 4px 20px rgba(48,26,96,0.16)",
              animation: "bannerSlideUp 400ms cubic-bezier(0.34,1.56,0.64,1) both",
            }}>

            {/* Favicon / icon */}
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: `rgba(${t.accentRgb},0.16)`,
                border: `1px solid rgba(${t.accentRgb},0.4)`,
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
                border: `1.5px solid rgba(${t.accentRgb},0.55)`,
                animation: "liquidPulse 2s ease-in-out infinite",
              }} />
            </div>

            {/* Text */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                margin: 0,
                fontSize: 11,
                fontWeight: 600,
                color: t.ink,
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
                color: `rgba(${t.inkRgb},0.6)`,
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
                border: `1px solid rgba(${t.inkRgb},0.2)`,
                background: "transparent",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: `rgba(${t.inkRgb},0.5)`,
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

      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

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
        ::-webkit-scrollbar { width: 0; height: 0; background: transparent; }
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
        //
        // NOTE: no `scale` here. Scaling the scroll body shrinks it toward its
        // centre, lifting the LAST token bar's bottom edge OFF the tab bar for
        // the morph's duration — that exposed the ~1s page-coloured band above
        // the index bar. A downward translate keeps the bottom anchored (it
        // pushes into the clipped region instead of revealing a gap), so the
        // morph stays a fade+slide with no bottom gap.
        transform: exiting ? "translateY(10px)" : "none",
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

/* ───────────────────────── Explore (coming soon) ───────────────────────── */
function ExploreView({ isNoid }: { isNoid: boolean }) {
  const items: { icon: string; title: string; desc: string }[] = [
    { icon: "🔀", title: "Private Swaps", desc: "Shielded token swaps — trade without revealing amounts or routes." },
    { icon: "🚀", title: "Private Memecoin Launchpad", desc: "Launch and snipe memecoins privately, free from front-runners." },
    { icon: "🎲", title: "Private Prediction Market", desc: "Bet on outcomes with positions nobody can trace back to you." },
  ]

  const t = themeTokens(isNoid)

  return (
    <div className="px-5 pt-6 pb-12">
      <p
        className="font-round text-[9px] tracking-[0.4em] uppercase mb-2"
        style={{
          color: `rgba(${t.inkRgb},0.55)`,
          transition: COLOR_TRANSITION,
          animation: `liquidFadeIn 400ms ${SPRING} both`
        }}>
        Explore
      </p>

      <div className="space-y-3">
        {items.map((it, i) => (
          <div
            key={it.title}
            className="relative overflow-hidden p-4 rounded-2xl"
            style={{
              background: t.glass,
              backdropFilter: "blur(20px) saturate(160%)",
              WebkitBackdropFilter: "blur(20px) saturate(160%)",
              border: `1px solid ${t.glassLine}`,
              boxShadow: isNoid
                ? "inset 0 1px 0 rgba(255,255,255,0.1), 0 4px 16px rgba(12,6,30,0.3)"
                : "inset 0 1px 0 rgba(255,255,255,0.7), 0 4px 16px rgba(48,26,96,0.1)",
              transition: COLOR_TRANSITION,
              animation: `liquidFadeIn 500ms ${SPRING} ${60 + i * 70}ms both`
            }}>
            <div className="flex items-center gap-3.5">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[20px]"
                style={{
                  background: `rgba(${t.inkRgb},0.08)`,
                  border: `1px solid rgba(${t.inkRgb},0.14)`
                }}>
                {it.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-round text-[13.5px] font-semibold" style={{ color: t.ink }}>
                    {it.title}
                  </p>
                </div>
                <p
                  className="text-[10.5px] mt-0.5 leading-snug"
                  style={{ color: `rgba(${t.inkRgb},0.62)` }}>
                  {it.desc}
                </p>
              </div>
            </div>
            <div
              className="mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-round text-[8.5px] tracking-[0.25em] uppercase font-bold"
              style={{
                background: `rgba(${t.accentRgb},0.16)`,
                border: `1px solid rgba(${t.accentRgb},0.36)`,
                color: t.ink
              }}>
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: t.accent, animation: "liquidPulse 2.4s ease-in-out infinite" }}
              />
              Coming soon
            </div>
          </div>
        ))}
      </div>

      <p
        className="text-center font-round italic text-[11px] mt-6"
        style={{ color: `rgba(${t.inkRgb},0.5)` }}>
        New private frontiers are charted. Stay aboard.
      </p>
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
  const t = themeTokens(isNoid)

  /* The knob is the darker of the two skies in open mode and the brighter one
     in noid — it always reads as "the other weather", which is the thing the
     control actually promises. */
  const knob = isNoid
    ? "linear-gradient(135deg, #F4EEFF 0%, #DCCEFA 100%)"
    : "linear-gradient(135deg, #5E40A8 0%, #3B2570 100%)"

  return (
    <div
      className="relative inline-flex items-center rounded-full p-0.5"
      style={{
        width: 116,
        background: t.glass,
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        border: `1px solid ${t.glassLine}`,
        boxShadow: isNoid
          ? "inset 0 1px 0 rgba(255,255,255,0.12)"
          : "inset 0 1px 0 rgba(255,255,255,0.7)",
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
          background: knob,
          boxShadow: isNoid
            ? "0 2px 10px rgba(201,176,255,0.34), inset 0 1px 0 rgba(255,255,255,0.7)"
            : "0 2px 10px rgba(48,26,96,0.42), inset 0 1px 0 rgba(255,255,255,0.16)",
          transition: `left 600ms ${SPRING}, background 500ms ${EASE}, box-shadow 500ms ${EASE}`
        }}
      />
      <button
        onClick={() => onSwitch("open")}
        className="relative z-10 px-3 py-1 font-round text-[9px] font-semibold tracking-[0.25em] uppercase"
        style={{
          width: 54,
          // The active label sits on the knob, so it takes the knob's opposite.
          color: mode === "open" ? "#F6EFFF" : `rgba(${t.inkRgb},0.6)`,
          transition: `color 400ms ${EASE}`
        }}>
        Open
      </button>
      <button
        onClick={() => onSwitch("noid")}
        className="relative z-10 px-3 py-1 font-round text-[9px] font-semibold tracking-[0.25em] uppercase"
        style={{
          width: 54,
          color: mode === "noid" ? "var(--violet-deep)" : `rgba(${t.inkRgb},0.6)`,
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
    ["explore",  "◉", "Explore"],
    ["settings", "◎", "Settings"],
  ]

  const activeIdx = tabs.findIndex(([t]) => t === tab)

  // Pill width and per-slot width. We use % so it works at any container size.
  const PILL_W   = 82   // px — visual pill width
  const PILL_H   = 48   // px

  return (
    <div
      className="relative z-30 shrink-0"
      style={{
        // FULLY opaque, and NO forced layer (no backdrop-filter, no
        // translateZ). A transparent/composited bar sampled the backdrop wrong
        // on the first frame, leaving a band until a repaint; an opaque bar with
        // no layer simply can't glitch. The cost is that it has to be a flat
        // colour rather than the sky — so it takes the deck the cloud floor
        // ends on in each mode, and reads as the ground the weather sits on.
        background: isNoid ? "#412C6E" : "#E3D3F8",
        borderTop: isNoid
          ? "1px solid rgba(255,255,255,0.10)"
          : "1px solid rgba(78,47,142,0.10)",
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
              ? "linear-gradient(135deg, #F4EEFF 0%, #D9C9F8 100%)"
              : "linear-gradient(145deg, #5E40A8 0%, #3B2570 100%)",
            boxShadow: isNoid
              ? "0 4px 14px rgba(201,176,255,0.24), inset 0 1px 0 rgba(255,255,255,0.7)"
              : "0 4px 14px rgba(48,26,96,0.36), inset 0 1px 0 rgba(255,255,255,0.14)",
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
        // The active symbol sits on the pill, so it takes the pill's opposite:
        // violet on noid's pale pill, near-white on open's deep one.
        color: isActive
          ? (isNoid ? "#4E2F8E" : "#F6EFFF")
          : isNoid ? "rgba(244,238,255,0.5)" : "rgba(78,47,142,0.5)",
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
      <span className="relative font-round text-[9px] tracking-[0.3em] uppercase">
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
  treasureChain,
  onTreasureChainChange,
  onSidebarToggle,
  onModeSwitch,
  onOpenAccountDetails,
  onOpenConnections,
  onLock,
}: {
  mode: "open" | "noid"
  sidebarMode: boolean
  toggleHint: string | null
  treasureChain: TreasureChain
  onTreasureChainChange: (c: TreasureChain) => void
  onSidebarToggle: (v: boolean) => void
  onModeSwitch: (t: "open" | "noid") => void
  onOpenAccountDetails: () => void
  onOpenConnections: () => void
  onLock: () => void
}) {
  const isNoid = mode === "noid"
  const t = themeTokens(isNoid)

  /* Glass over the sky, in both modes. The mix is what changes: over the pale
     lilac it is mostly white so the card lifts off the backdrop; over the storm
     it is a tenth of white, because anything heavier turns into a grey slab. */
  const liquidCardStyle: React.CSSProperties = {
    background: t.glass,
    backdropFilter: "blur(20px) saturate(160%)",
    WebkitBackdropFilter: "blur(20px) saturate(160%)",
    border: `1px solid ${t.glassLine}`,
    boxShadow: isNoid
      ? "inset 0 1px 0 rgba(255,255,255,0.1), 0 4px 16px rgba(12,6,30,0.3)"
      : "inset 0 1px 0 rgba(255,255,255,0.7), 0 4px 16px rgba(48,26,96,0.1)",
    transition: COLOR_TRANSITION
  }

  /* The round glyph chip on each row — a solid disc of the mode's opposite, so
     it is the one hard-edged thing on a card made of glass. */
  const chipStyle: React.CSSProperties = {
    background: isNoid
      ? "linear-gradient(145deg, #F4EEFF 0%, #D9C9F8 100%)"
      : "linear-gradient(145deg, #5E40A8 0%, #3B2570 100%)",
    border: isNoid ? "1px solid rgba(78,47,142,0.12)" : "1px solid rgba(255,255,255,0.14)",
    boxShadow: isNoid
      ? "inset 0 1px 0 rgba(255,255,255,0.7)"
      : "inset 0 1px 0 rgba(255,255,255,0.16)",
    color: isNoid ? "#4E2F8E" : "#F6EFFF",
    transition: COLOR_TRANSITION
  }

  return (
    <div className="px-5 pt-6 pb-12 space-y-3">
      <p
        className="font-round text-[9px] tracking-[0.4em] uppercase mb-2"
        style={{
          color: `rgba(${t.inkRgb},0.55)`,
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
            style={chipStyle}>
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
                color: `rgba(${t.inkRgb},0.62)`,
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
            style={chipStyle}>
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
                color: `rgba(${t.inkRgb},0.62)`,
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




      {/* Treasure Card chain */}
      <div
        className="p-4 rounded-2xl"
        style={{
          ...liquidCardStyle,
          animation: `liquidFadeIn 500ms ${SPRING} 120ms both`
        }}>
        <p className="text-[13px] font-semibold">Treasure Card</p>
        <p
          className="text-[11px] mt-0.5 leading-snug"
          style={{
            color: `rgba(${t.inkRgb},0.62)`,
            transition: COLOR_TRANSITION
          }}>
          Choose which chain your treasure card features
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[...CHAINS.map((c) => ({ id: c.id as TreasureChain, label: c.name })), { id: "all" as TreasureChain, label: "All" }].map(
            (opt) => {
              const active = treasureChain === opt.id
              return (
                <button
                  key={opt.id}
                  onClick={() => onTreasureChainChange(opt.id)}
                  className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-transform active:scale-[0.96]"
                  style={{
                    background: active
                      ? (isNoid
                          ? "linear-gradient(135deg, #F4EEFF 0%, #D9C9F8 100%)"
                          : "linear-gradient(135deg, #5E40A8 0%, #3B2570 100%)")
                      : t.glass,
                    color: active
                      ? (isNoid ? "#4E2F8E" : "#F6EFFF")
                      : `rgba(${t.inkRgb},0.62)`,
                    border: active
                      ? "1px solid transparent"
                      : `1px solid ${t.glassLine}`,
                    transition: COLOR_TRANSITION
                  }}>
                  {opt.label}
                </button>
              )
            }
          )}
        </div>
      </div>

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
                color: `rgba(${t.inkRgb},0.62)`,
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
              background: `rgba(${t.accentRgb},0.14)`,
              border: `1px solid rgba(${t.accentRgb},0.34)`,
              animation: `liquidFadeIn 400ms ${SPRING} both`
            }}>
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0 mt-1.5"
              style={{ background: t.accent }}
            />
            <p
              className="text-[11px] leading-snug"
              style={{
                color: `rgba(${t.inkRgb},0.8)`,
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
              color: `rgba(${t.inkRgb},0.62)`,
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
          background: t.glass,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: `1px solid ${t.glassLine}`,
          color: `rgba(${t.inkRgb},0.7)`,
          animation: `liquidFadeIn 500ms ${SPRING} 260ms both`,
          transition: COLOR_TRANSITION
        }}
        onMouseEnter={(e) => {
          // Lock is the one destructive control here, so hovering it leaves the
          // violet family entirely — `down` is the mode's own alarm colour.
          (e.currentTarget as HTMLElement).style.borderColor = t.down
          ;(e.currentTarget as HTMLElement).style.color = t.down
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = t.glassLine
          ;(e.currentTarget as HTMLElement).style.color = `rgba(${t.inkRgb},0.7)`
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
    ? "linear-gradient(135deg, #F4EEFF 0%, #D9C9F8 100%)"
    : "linear-gradient(135deg, #5E40A8 0%, #3B2570 100%)"
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
        background: checked ? onBg : isNoid ? "rgba(255,255,255,0.18)" : "rgba(78,47,142,0.18)",
        boxShadow: checked
          ? (isNoid
              ? "0 2px 8px rgba(201,176,255,0.34), inset 0 1px 0 rgba(255,255,255,0.6)"
              : "0 2px 8px rgba(48,26,96,0.4), inset 0 1px 0 rgba(255,255,255,0.16)")
          : "inset 0 1px 3px rgba(30,14,70,0.22)",
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
          background: checked && isNoid ? "#4E2F8E" : "white",
          boxShadow: "0 2px 6px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.8)",
          transform: checked ? "translateX(-1.5px) scale(1)" : "translateX(-20px) scale(1)",
          transition: `transform 500ms ${SPRING}, background 500ms ${EASE}`
        }}
      />
    </button>
  )
}

/* ───────────────────────── Backdrop ─────────────────────────
   The two skies, stacked and cross-faded. They share the same gradient
   geometry — bloom top-right, pool bottom-left, diagonal wash between — so
   what the eye sees when the mode flips is the light changing, not one
   surface being swapped for another.

   Everything here is scenery for a body that scrolls over it, so it is all
   pointer-events-none and none of it lives in the scroll subtree: a
   decoration inside the scroller would inflate the scroll height and leave
   dead space under the last token bar. */
function Backdrop({ isNoid }: { isNoid: boolean }) {
  return (
    <>
      <div
        className="bg-menoid absolute inset-0"
        style={{ opacity: isNoid ? 0 : 1, transition: `opacity 620ms ${EASE}` }}
      />
      <div
        className="bg-menoid-noid absolute inset-0"
        style={{ opacity: isNoid ? 1 : 0, transition: `opacity 620ms ${EASE}` }}
      />

      {/* The printed grid. One element for both modes — `html.noid-theme`
          dims and warms it in CSS, so there is nothing to cross-fade. */}
      <div className="menoid-grid pointer-events-none absolute inset-0" />

      {/* Sparkles in the clear sky, rain in the storm. Both are always mounted
          and faded, because mounting the rain on the switch drops the whole
          field in at once — the drops have negative delays to start mid-flight
          and that only reads right if they were already falling. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ opacity: isNoid ? 0 : 1, transition: `opacity 620ms ${EASE}` }}>
        <Sparkles />
      </div>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ opacity: isNoid ? 1 : 0, transition: `opacity 620ms ${EASE}` }}>
        <Storm />
      </div>

      {/* The cloud floor, along the bottom of the surface. It sits under the
          scrolling body, so the last token bar drifts over weather rather than
          over flat colour — and on a short page it is what fills the space
          below the content instead of an empty band.

          Deliberately short and faded: this is scenery BEHIND live content, not
          the hero floor the welcome page gets. At full height and opacity the
          bank ran up behind the token bars and every closing line of copy
          landed on a white cloud. A horizon, not a wall.

          Both tones stay mounted and cross-fade, same as the rain. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[150px] overflow-hidden">
        <div
          className="absolute inset-0"
          style={{ opacity: isNoid ? 0 : 0.55, transition: `opacity 620ms ${EASE}` }}>
          <CloudBank layer="mid" className="bottom-0 left-0" />
          <CloudBank layer="near" className="bottom-0 left-0" />
        </div>
        <div
          className="absolute inset-0"
          style={{ opacity: isNoid ? 0.75 : 0, transition: `opacity 620ms ${EASE}` }}>
          <CloudBank layer="mid" tone="storm" className="bottom-0 left-0" />
          <CloudBank layer="near" tone="storm" className="bottom-0 left-0" />
        </div>
      </div>
    </>
  )
}