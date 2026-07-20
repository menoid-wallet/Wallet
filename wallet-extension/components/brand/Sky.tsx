/**
 * Sky.tsx
 *
 * The purple backdrop every surface in this theme opens on: the diagonal
 * lilac→violet wash, the printed grid over it, and a scatter of sparkles.
 *
 * Geometry is fixed rather than random so a remount never reshuffles the
 * sparkles under the user.
 */

import React from "react"

/* Sparkles — [left%, top%, size px, delay s, opacity] */
const SPARKS: [number, number, number, number, number][] = [
  [12, 14, 11, 0, 0.9],
  [26, 40, 7, 1.4, 0.55],
  [38, 9, 9, 2.1, 0.7],
  [52, 30, 6, 0.7, 0.45],
  [64, 12, 10, 1.9, 0.8],
  [78, 44, 8, 0.3, 0.55],
  [88, 20, 12, 1.1, 0.9],
  [8, 52, 8, 2.4, 0.5],
  [46, 60, 7, 1.6, 0.4],
  [92, 58, 6, 0.9, 0.45]
]

export function Sparkles({ className = "" }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 ${className}`}>
      {SPARKS.map(([l, t, s, d, o], i) => (
        <svg
          key={i}
          className="spark absolute"
          style={{
            left: `${l}%`,
            top: `${t}%`,
            width: s,
            height: s,
            animationDelay: `${d}s`,
            opacity: o
          }}
          viewBox="0 0 24 24"
          fill="#fff"
          aria-hidden
          focusable="false">
          <path d="M12 0c0 6.6 5.4 12 12 12-6.6 0-12 5.4-12 12 0-6.6-5.4-12-12-12 6.6 0 12-5.4 12-12z" />
        </svg>
      ))}
    </div>
  )
}

/**
 * The full backdrop. Drop it as the first child of a `relative isolate`
 * container and everything after it lands on the sky.
 */
export default function Sky({
  sparkles = true,
  className = ""
}: {
  sparkles?: boolean
  className?: string
}) {
  return (
    <div className={`bg-menoid absolute inset-0 ${className}`}>
      <div className="menoid-grid absolute inset-0" />
      {sparkles && <Sparkles />}
    </div>
  )
}
