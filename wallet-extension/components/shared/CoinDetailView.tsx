/**
 * CoinDetailView.tsx
 *
 * The per-token page, shared by both modes. The page background follows the
 * active mode (light for open, dark for noid) while the graph card renders
 * as its *inverse* — a dark, grid-lined "treasure" card on the light page
 * and a light one on the dark page — so it reads as the home treasury card
 * having grown into the chart.
 *
 * Two shared-element morphs run on mount (FLIP via getBoundingClientRect):
 *   - the tapped token bar's glyph flies up into the header icon
 *   - the home treasure card expands into the graph card's shell
 *
 * Live price + history come from CoinGecko (mainnet proxy for each testnet);
 * the on-chain `balance` is the real testnet amount, valued at the live price.
 */

import React, {
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react"
import type { ChainMeta } from "../../lib/chains"
import type { PriceInfo, ChartRange } from "../../services/prices"
import { useTokenChart } from "./usePrices"
import LiveAreaChart from "./LiveAreaChart"

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)"
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)"

export interface CoinAction {
  key: string
  icon: React.ReactNode
  label: string
  onClick: () => void
  /** muted = looks disabled (e.g. "Buy") but still fires onClick for a toast */
  tone?: "primary" | "muted"
}

export interface MorphSource {
  card: DOMRect | null
  icon: DOMRect | null
}

interface Props {
  chain: ChainMeta
  /** page background mode; the graph card is the inverse of this */
  pageTheme: "light" | "dark"
  /** real on-chain testnet balance (token amount) */
  balance: string
  price?: PriceInfo
  priceLoading?: boolean
  balanceLabel?: string
  morph?: MorphSource | null
  /** receives the graph card's current rect so the list can reverse-morph (#4) */
  onBack: (graphRect?: DOMRect | null) => void
  actions: CoinAction[]
  shipsLog: React.ReactNode
  children?: React.ReactNode
}

const RANGES: { key: ChartRange; label: string }[] = [
  { key: "1", label: "1D" },
  { key: "7", label: "1W" },
  { key: "30", label: "1M" },
  { key: "365", label: "1Y" }
]

function fmtCurrency(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "$0.00"
  const max = v >= 1 ? 2 : 6
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: max
  })
}

function fmtBalance(b: string): string {
  const n = Number(b)
  if (!Number.isFinite(n) || n === 0) return "0.00"
  if (n < 0.01) return n.toFixed(4)
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

export default function CoinDetailView({
  chain,
  pageTheme,
  balance,
  price,
  priceLoading,
  balanceLabel = "Your Balance",
  morph,
  onBack,
  actions,
  shipsLog,
  children
}: Props) {
  const isLightPage = pageTheme === "light"
  const [range, setRange] = useState<ChartRange>("7")
  const { points, loading: chartLoading } = useTokenChart(chain.id, range)
  const rangeIndex = RANGES.findIndex((r) => r.key === range)

  const cardShellRef = useRef<HTMLDivElement>(null)
  const iconRef = useRef<HTMLDivElement>(null)

  // Hand the graph card's current rect back so the dashboard treasure card can
  // grow out of it — the exact reverse of the open morph (#4).
  const handleBack = () => onBack(cardShellRef.current?.getBoundingClientRect() ?? null)

  // ── Shared-element morph (FLIP) ───────────────────────────────────────────
  useLayoutEffect(() => {
    if (!morph) return
    const cleanups: Array<() => void> = []
    const animate = (el: HTMLElement | null, from: DOMRect | null, dur: number, easing: string) => {
      if (!el || !from || !from.width || !from.height) return
      const to = el.getBoundingClientRect()
      if (!to.width || !to.height) return
      const dx = from.left - to.left
      const dy = from.top - to.top
      const sx = from.width / to.width
      const sy = from.height / to.height
      el.style.transformOrigin = "top left"
      el.style.transition = "none"
      el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
      el.style.willChange = "transform"
      void el.getBoundingClientRect()
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          el.style.transition = `transform ${dur}ms ${easing}`
          el.style.transform = "translate(0px, 0px) scale(1, 1)"
        })
      )
      const t = setTimeout(() => {
        el.style.transition = ""
        el.style.transform = ""
        el.style.willChange = ""
        el.style.transformOrigin = ""
      }, dur + 100)
      cleanups.push(() => clearTimeout(t))
    }
    // Card glides in with a faint spring; the logo uses a clean ease-out — no
    // bounce (it was overshooting too hard before).
    animate(cardShellRef.current, morph.card, 640, "cubic-bezier(0.33, 1.12, 0.5, 1)")
    animate(iconRef.current, morph.icon, 520, "cubic-bezier(0.22, 1, 0.36, 1)")
    return () => cleanups.forEach((fn) => fn())
  }, [])

  // ── Theme tokens ──────────────────────────────────────────────────────────
  const ink = isLightPage ? "#171311" : "#FAF5E9"
  const inkRgb = isLightPage ? "23,19,17" : "250,245,233"

  // graph card = inverse of the page
  const cardIsDark = isLightPage
  const cardBg = cardIsDark
    ? "linear-gradient(145deg, #1A1410 0%, #0D0A07 60%, #171311 100%)"
    : "linear-gradient(145deg, #FBF1D9 0%, #F0E0B6 55%, #EAD5A7 100%)"
  const cardShadow = cardIsDark
    ? "0 26px 50px -22px rgba(0,0,0,0.8), 0 8px 24px -8px rgba(232,174,58,0.15), inset 0 1px 0 rgba(251,241,217,0.08)"
    : "0 26px 50px -22px rgba(163,110,20,0.4), 0 8px 24px -8px rgba(232,174,58,0.25), inset 0 1px 0 rgba(255,255,255,0.7)"
  const cardInk = cardIsDark ? "250,245,233" : "23,19,17"
  const cardGrid = cardIsDark ? "#FBF1D9" : "#171311"

  // On the dark card (open mode) the line + price use the light-mode cream tone
  // (the open background colour); on the light card (noid mode) they use ink.
  const lineColor = cardIsDark ? "#F4E7CC" : "#171311"
  const priceColor = cardIsDark ? "rgba(244,231,204,0.98)" : `rgba(${cardInk},0.95)`

  // Token glyph chip mirrors the treasure card: dark chip + light glyph on the
  // light page, light chip + dark glyph on the dark page (matches the bars so
  // the morph stays seamless).
  const iconChipBg = isLightPage
    ? "linear-gradient(145deg, #3A2C1C 0%, #241A10 100%)"
    : "linear-gradient(145deg, #FBF1D9 0%, #EAD5A7 100%)"
  const iconChipBorder = isLightPage ? "1px solid rgba(251,241,217,0.12)" : "1px solid rgba(23,19,17,0.1)"
  const iconColor = isLightPage ? "#F4E7CC" : "#171311"

  const usdValue = (Number(balance) || 0) * (price?.usd ?? 0)
  const change = price?.change24h ?? 0
  const up = change >= 0
  const changeColor = up ? "#34b27b" : "#e5604d"

  return (
    <div className="relative px-5 pt-3 pb-8" style={{ color: ink }}>
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between mb-3"
        style={{ animation: `coinHeaderIn 500ms ${EASE} both` }}>
        <button
          onClick={handleBack}
          className="flex h-9 w-9 items-center justify-center rounded-full hover:scale-105 active:scale-95 transition-transform"
          style={{
            background: `rgba(${inkRgb},0.06)`,
            border: `1px solid rgba(${inkRgb},0.1)`,
            color: ink
          }}>
          <svg width="14" height="14" viewBox="0 0 10 10" fill="none">
            <path d="M6.5 8.5L3 5L6.5 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="flex items-center gap-2.5">
          <div className="text-right flex flex-col justify-center">
            <p className="text-[13px] font-bold leading-none" style={{ color: ink }}>{chain.name}</p>
            <p className="text-[8px] font-mono mt-1 tracking-[0.2em] uppercase leading-none" style={{ color: `rgba(${inkRgb},0.4)` }}>
              {chain.subtitle} · {chain.symbol}
            </p>
          </div>
          <div
            ref={iconRef}
            className="flex h-10 w-10 items-center justify-center rounded-2xl p-2"
            style={{
              background: iconChipBg,
              border: iconChipBorder,
              color: iconColor
            }}>
            {chain.icon}
          </div>
        </div>
      </div>

      {/* ── Graph card (morph target) ── */}
      <div className="relative rounded-[28px] mb-4" style={{ minHeight: 250 }}>
        {/* shell — the FLIP element; gradient + grid + orbs, fades nothing */}
        <div
          ref={cardShellRef}
          className="absolute inset-0 rounded-[28px] overflow-hidden"
          style={{ background: cardBg, boxShadow: cardShadow }}>
          <div
            className="pointer-events-none absolute"
            style={{
              top: "-30%", right: "-10%", width: 220, height: 220, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(232,174,58,0.38) 0%, transparent 60%)",
              filter: "blur(40px)", animation: "treasureOrb1 12s ease-in-out infinite"
            }}
          />
          <div
            className="pointer-events-none absolute"
            style={{
              bottom: "-24%", left: "-16%", width: 200, height: 200, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(163,110,20,0.3) 0%, transparent 60%)",
              filter: "blur(50px)", animation: "treasureOrb2 10s ease-in-out infinite 2s"
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              background: "linear-gradient(115deg, transparent 30%, rgba(251,241,217,0.06) 50%, transparent 70%)",
              animation: "treasureSheen 6s ease-in-out infinite"
            }}
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              opacity: cardIsDark ? 0.03 : 0.05,
              backgroundImage: `linear-gradient(to right,${cardGrid} 1px,transparent 1px),linear-gradient(to bottom,${cardGrid} 1px,transparent 1px)`,
              backgroundSize: "26px 26px"
            }}
          />
          <div className="pointer-events-none absolute inset-0 paper-grain" style={{ opacity: cardIsDark ? 0.12 : 0.28 }} />
        </div>

        {/* content (never scaled) */}
        <div className="relative z-10 p-5" style={{ animation: `coinCardContentIn 600ms ${SPRING} 140ms both` }}>
          <div>
            <p className="text-[8px] tracking-[0.4em] uppercase font-bold mb-1.5" style={{ color: `rgba(${cardInk},0.4)` }}>
              Price
            </p>
            {priceLoading && !price ? (
              <div className="h-7 w-28 rounded-lg" style={{ background: `rgba(${cardInk},0.08)`, animation: "coinPulse 1.3s ease-in-out infinite" }} />
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-[28px] font-display font-bold leading-none" style={{ color: priceColor }}>
                  {fmtCurrency(price?.usd ?? 0)}
                </span>
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ color: changeColor, background: up ? "rgba(52,178,123,0.12)" : "rgba(229,96,77,0.12)" }}>
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ transform: up ? "none" : "rotate(180deg)" }}>
                    <path d="M4 1.5L7 5.5H1L4 1.5Z" fill="currentColor" />
                  </svg>
                  {Math.abs(change).toFixed(2)}%
                </span>
              </div>
            )}
          </div>

          {/* chart */}
          <div className="mt-3">
            <LiveAreaChart
              points={points ?? []}
              lineColor={lineColor}
              areaColor={chain.color}
              height={128}
              loading={chartLoading}
              emptyColor={`rgba(${cardInk},0.4)`}
            />
          </div>

          {/* range toggle — bottom, centered, with a sliding indicator (#7) */}
          <div className="mt-2.5 flex justify-center">
            <div
              className="relative flex items-center rounded-full p-0.5"
              style={{ background: `rgba(${cardInk},0.08)`, border: `1px solid rgba(${cardInk},0.08)` }}>
              {/* sliding pill */}
              <div
                className="absolute rounded-full"
                style={{
                  top: 2,
                  bottom: 2,
                  width: `calc((100% - 4px) / ${RANGES.length})`,
                  left: `calc(2px + ${rangeIndex} * (100% - 4px) / ${RANGES.length})`,
                  background: cardIsDark ? "#F4E7CC" : "#171311",
                  boxShadow: cardIsDark ? "0 2px 8px rgba(244,231,204,0.25)" : "0 2px 8px rgba(23,19,17,0.3)",
                  transition: `left 420ms ${SPRING}`
                }}
              />
              {RANGES.map((r) => {
                const active = r.key === range
                return (
                  <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    className="relative z-10 text-[9px] font-bold tracking-wider text-center"
                    style={{
                      width: 36,
                      padding: "4px 0",
                      color: active ? (cardIsDark ? "#171311" : "#FBF1D9") : `rgba(${cardInk},0.5)`,
                      transition: "color 320ms ease"
                    }}>
                    {r.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Balance card ── */}
      <div
        className="p-4 rounded-3xl mb-4 border"
        style={{
          background: `rgba(${inkRgb},0.03)`,
          borderColor: `rgba(${inkRgb},0.07)`,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          animation: `coinBlockIn 600ms ${SPRING} 220ms both`
        }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[8px] tracking-[0.34em] uppercase font-semibold mb-1.5" style={{ color: `rgba(${inkRgb},0.4)` }}>
              {balanceLabel}
            </p>
            <p className="text-[24px] font-display font-bold leading-none" style={{ color: ink }}>
              {fmtBalance(balance)}{" "}
              <span className="text-[13px] font-normal" style={{ color: `rgba(${inkRgb},0.4)` }}>{chain.symbol}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[8px] tracking-[0.2em] uppercase font-semibold mb-1.5" style={{ color: `rgba(${inkRgb},0.4)` }}>Value</p>
            <p className="text-[15px] font-mono font-semibold leading-none" style={{ color: `rgba(${inkRgb},0.75)` }}>
              {fmtCurrency(usdValue)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Actions ── */}
      <div
        className="grid gap-2.5 mb-5"
        style={{
          gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))`,
          animation: `coinBlockIn 600ms ${SPRING} 300ms both`
        }}>
        {actions.map((a, i) => (
          <CoinActionButton key={a.key} action={a} inkRgb={inkRgb} delay={i * 50} />
        ))}
      </div>

      {/* ── Ship's Log ── */}
      <div className="mt-1" style={{ animation: `coinBlockIn 600ms ${SPRING} 380ms both` }}>
        <div className="flex items-center gap-2 mb-3">
          <div style={{ height: 1, flex: 1, background: `linear-gradient(to right, transparent, rgba(${inkRgb},0.12), transparent)` }} />
          <p className="text-[8px] tracking-[0.5em] uppercase shrink-0" style={{ color: `rgba(${inkRgb},0.4)` }}>Ship's Log</p>
          <div style={{ height: 1, flex: 1, background: `linear-gradient(to right, transparent, rgba(${inkRgb},0.12), transparent)` }} />
        </div>
        {shipsLog}
      </div>

      {children}

      <style>{`
        @keyframes treasureOrb1 { 0%,100% { transform: translate(0,0) scale(1); opacity:1; } 50% { transform: translate(-26px,18px) scale(1.15); opacity:0.7; } }
        @keyframes treasureOrb2 { 0%,100% { transform: translate(0,0) scale(1); opacity:1; } 50% { transform: translate(34px,-26px) scale(1.18); opacity:0.6; } }
        @keyframes treasureSheen { 0%,100% { transform: translateX(-30%);} 50% { transform: translateX(30%);} }
        @keyframes coinHeaderIn { 0% { opacity:0; transform: translateY(-6px);} 100% { opacity:1; transform: translateY(0);} }
        @keyframes coinCardContentIn { 0% { opacity:0; transform: translateY(10px);} 100% { opacity:1; transform: translateY(0);} }
        @keyframes coinBlockIn { 0% { opacity:0; transform: translateY(14px);} 100% { opacity:1; transform: translateY(0);} }
        @keyframes coinPulse { 0%,100% { opacity:0.5;} 50% { opacity:0.85;} }
      `}</style>
    </div>
  )
}

/* ───────────────────────── Action button ───────────────────────── */
function CoinActionButton({
  action,
  inkRgb,
  delay
}: {
  action: CoinAction
  inkRgb: string
  delay: number
}) {
  const [pressed, setPressed] = useState(false)
  const [hovering, setHovering] = useState(false)
  const muted = action.tone === "muted"

  return (
    <button
      onClick={action.onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => { setPressed(false); setHovering(false) }}
      onPointerEnter={() => setHovering(true)}
      className="group relative overflow-hidden rounded-2xl"
      style={{
        padding: "11px 6px 10px",
        background: muted
          ? `rgba(${inkRgb},0.03)`
          : "linear-gradient(145deg, rgba(163,110,20,0.1) 0%, rgba(232,174,58,0.06) 100%)",
        border: muted
          ? `1px solid rgba(${inkRgb},0.07)`
          : hovering
            ? "1px solid rgba(163,110,20,0.42)"
            : "1px solid rgba(163,110,20,0.2)",
        boxShadow: muted
          ? "none"
          : hovering
            ? "0 8px 22px -8px rgba(163,110,20,0.3), inset 0 1px 0 rgba(255,255,255,0.18)"
            : "inset 0 1px 0 rgba(255,255,255,0.1)",
        transform: pressed ? "scale(0.93)" : hovering && !muted ? "translateY(-2px)" : "translateY(0)",
        transition: pressed ? `transform 180ms ${SPRING}` : `all 420ms ${SPRING}`,
        animation: `coinBlockIn 500ms ${SPRING} ${delay}ms both`,
        opacity: muted ? 0.55 : 1
      }}>
      <div className="flex flex-col items-center justify-center gap-1.5">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-xl"
          style={{
            background: muted ? `rgba(${inkRgb},0.05)` : "rgba(163,110,20,0.16)",
            border: muted ? `1px solid rgba(${inkRgb},0.08)` : "1px solid rgba(163,110,20,0.26)",
            color: muted ? `rgba(${inkRgb},0.4)` : "#A36E14",
            transform: hovering && !muted ? "scale(1.08)" : "scale(1)",
            transition: `transform 400ms ${SPRING}`
          }}>
          {action.icon}
        </span>
        <span className="font-display font-bold text-[10px] tracking-[-0.01em]" style={{ color: muted ? `rgba(${inkRgb},0.4)` : `rgba(${inkRgb},0.82)` }}>
          {action.label}
        </span>
      </div>
    </button>
  )
}
