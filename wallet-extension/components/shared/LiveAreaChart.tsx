/**
 * LiveAreaChart.tsx
 *
 * Smooth area + line chart rendered from a live price series. Built for the
 * coin detail page's graph card:
 *   - Catmull-Rom spline → cubic beziers for a fluid curve
 *   - gradient area fill + soft glow under the stroke
 *   - the line "draws in" via stroke-dashoffset whenever the data changes
 *     (range switches re-trigger the draw), satisfying the brief's
 *     "make transition for graph"
 *   - a pulsing head marker on the latest point
 *
 * Colours are injected so the same chart works on the dark graph card
 * (open mode, light stroke) and the light graph card (noid mode, dark
 * stroke).
 */

import React, { useEffect, useId, useMemo, useRef, useState } from "react"

interface Props {
  points: number[]
  /** stroke colour for the line + head marker */
  lineColor: string
  /** rgb() used for the area gradient + glow tint (usually the chain brand) */
  areaColor: string
  height?: number
  loading?: boolean
  /** uppercase loading / empty placeholder colour */
  emptyColor?: string
}

const WIDTH = 320
const PAD_X = 6
const PAD_Y = 14

function buildPaths(points: number[], height: number) {
  if (points.length < 2) return { line: "", area: "", last: null as null | { x: number; y: number } }

  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1

  const coords = points.map((v, i) => ({
    x: PAD_X + (i / (points.length - 1)) * (WIDTH - 2 * PAD_X),
    y: height - PAD_Y - ((v - min) / range) * (height - 2 * PAD_Y)
  }))

  const t = 0.16
  let line = `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i - 1] || coords[i]
    const p1 = coords[i]
    const p2 = coords[i + 1]
    const p3 = coords[i + 2] || p2
    const c1x = p1.x + (p2.x - p0.x) * t
    const c1y = p1.y + (p2.y - p0.y) * t
    const c2x = p2.x - (p3.x - p1.x) * t
    const c2y = p2.y - (p3.y - p1.y) * t
    line += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }

  const last = coords[coords.length - 1]
  const area = `${line} L ${last.x.toFixed(2)} ${height} L ${coords[0].x.toFixed(2)} ${height} Z`
  return { line, area, last }
}

export default function LiveAreaChart({
  points,
  lineColor,
  areaColor,
  height = 132,
  loading = false,
  emptyColor = "rgba(255,255,255,0.4)"
}: Props) {
  const uid = useId().replace(/:/g, "")
  const gradId = `area-${uid}`
  const glowId = `glow-${uid}`

  const lineRef = useRef<SVGPathElement>(null)
  const { line, area, last } = useMemo(() => buildPaths(points, height), [points, height])
  const [drawn, setDrawn] = useState(false)

  // Re-run the draw-in animation whenever the line geometry changes.
  useEffect(() => {
    const el = lineRef.current
    if (!el || !line) return
    let raf = 0
    setDrawn(false)
    const len = el.getTotalLength?.() ?? WIDTH
    el.style.transition = "none"
    el.style.strokeDasharray = `${len}`
    el.style.strokeDashoffset = `${len}`
    // force layout so the reset takes hold before we animate
    void el.getBoundingClientRect()
    raf = requestAnimationFrame(() => {
      el.style.transition = "stroke-dashoffset 1100ms cubic-bezier(0.22, 1, 0.36, 1)"
      el.style.strokeDashoffset = "0"
      setDrawn(true)
    })
    return () => cancelAnimationFrame(raf)
  }, [line])

  if (!loading && points.length < 2) {
    return (
      <div
        className="flex items-center justify-center w-full rounded-2xl"
        style={{ height }}>
        <span className="text-[10px] tracking-[0.3em] uppercase" style={{ color: emptyColor }}>
          chart unavailable
        </span>
      </div>
    )
  }

  if (loading && points.length < 2) {
    return (
      <div
        className="relative w-full overflow-hidden rounded-2xl"
        style={{ height }}>
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(90deg, transparent, ${areaColor.replace("rgb", "rgba").replace(")", ",0.12)")}, transparent)`,
            animation: "chartShimmer 1.4s ease-in-out infinite"
          }}
        />
        <style>{`@keyframes chartShimmer { 0% { transform: translateX(-100%);} 100% { transform: translateX(100%);} }`}</style>
      </div>
    )
  }

  const areaRgba = areaColor.replace("rgb", "rgba").replace(")", ",1)")

  return (
    <div className="relative w-full" style={{ height }}>
      <svg
        className="w-full h-full overflow-visible"
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={areaRgba} stopOpacity="0.28" />
            <stop offset="55%" stopColor={areaRgba} stopOpacity="0.08" />
            <stop offset="100%" stopColor={areaRgba} stopOpacity="0" />
          </linearGradient>
          <filter id={glowId} x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {area && (
          <path
            d={area}
            fill={`url(#${gradId})`}
            style={{
              opacity: drawn ? 1 : 0,
              transition: "opacity 900ms ease 200ms"
            }}
          />
        )}

        {/* glow underlay — fades in alongside the area as the line finishes drawing */}
        {line && (
          <path
            d={line}
            fill="none"
            stroke={lineColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${glowId})`}
            style={{
              opacity: drawn ? 0.4 : 0,
              transition: "opacity 700ms ease 500ms"
            }}
          />
        )}

        {/* crisp line (the animated one we measure) */}
        {line && (
          <path
            ref={lineRef}
            d={line}
            fill="none"
            stroke={lineColor}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* head marker — positioned in % so it tracks the stretched viewBox */}
      {last && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: `${(last.x / WIDTH) * 100}%`,
            top: `${(last.y / height) * 100}%`,
            transform: "translate(-50%, -50%)",
            opacity: drawn ? 1 : 0,
            transition: "opacity 400ms ease 950ms"
          }}>
          <span
            className="absolute inset-0 rounded-full"
            style={{
              width: 14,
              height: 14,
              left: -7,
              top: -7,
              background: areaRgba,
              opacity: 0.25,
              animation: "chartPulse 2s ease-in-out infinite"
            }}
          />
          <span
            className="block rounded-full"
            style={{
              width: 7,
              height: 7,
              background: lineColor,
              boxShadow: `0 0 8px ${areaRgba}`
            }}
          />
        </div>
      )}

      <style>{`
        @keyframes chartPulse {
          0%, 100% { transform: scale(1); opacity: 0.25; }
          50% { transform: scale(1.8); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
