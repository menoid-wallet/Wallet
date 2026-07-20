/**
 * CloudChip.tsx
 *
 * A little cloud to sit things in — the shape every pill, badge and button
 * takes in this theme.
 *
 * Lobes are opaque and share the body's colour, so they merge into one
 * silhouette with no seams; the drop-shadow goes on the backdrop wrapper so it
 * traces the union rather than any single piece — and so it never lands on the
 * text inside. Widths are percentages: on a narrow chip the lobes come out
 * round, on a wide one they stretch into softer billows.
 *
 * Ported from website/src/components/CloudChip.tsx.
 */

import React from "react"

type Lobe = {
  left: number
  width: number
  height: number
  edge: "top" | "bottom"
}

const LOBES: Lobe[] = [
  { left: 16, width: 34, height: 22, edge: "top" },
  { left: 45, width: 38, height: 26, edge: "top" },
  { left: 76, width: 32, height: 20, edge: "top" },
  { left: 27, width: 32, height: 20, edge: "bottom" },
  { left: 58, width: 36, height: 23, edge: "bottom" },
  { left: 86, width: 28, height: 17, edge: "bottom" }
]

export default function CloudChip({
  children,
  tone = "light",
  className = "",
  onClick,
  disabled,
  as = "span",
  style
}: {
  children: React.ReactNode
  tone?: "light" | "violet" | "glass"
  className?: string
  onClick?: () => void
  disabled?: boolean
  as?: "span" | "button"
  style?: React.CSSProperties
}) {
  const bg =
    tone === "violet"
      ? "#5E40A8"
      : tone === "glass"
        ? "rgba(255,255,255,0.30)"
        : "#F6EFFF"

  const body = (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ filter: "drop-shadow(0 5px 12px rgba(64,36,122,0.26))" }}>
        {LOBES.map((l, i) => (
          <span
            key={i}
            className="absolute rounded-[50%]"
            style={{
              left: `${l.left}%`,
              width: `${l.width}%`,
              height: l.height,
              background: bg,
              [l.edge]: -l.height * 0.38,
              transform: "translateX(-50%)"
            } as React.CSSProperties}
          />
        ))}
        {/* the body last, so it covers where the lobes meet it */}
        <span
          className="absolute inset-0 rounded-full"
          style={{ background: bg }}
        />
      </span>
      {/* `gap: inherit` is load-bearing. The lobes and the body are absolutely
          positioned, so they leave the outer flex entirely and this span is its
          only in-flow item — which means a `gap-*` utility passed in
          `className` silently does nothing to the children the caller actually
          wants spaced. Inheriting the computed value makes it behave the way
          anyone reading `<CloudChip className="gap-3">` would expect. */}
      <span className="relative flex items-center justify-center" style={{ gap: "inherit" }}>
        {children}
      </span>
    </>
  )

  if (as === "button") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        style={style}
        className={`relative inline-flex items-center justify-center disabled:opacity-45 disabled:cursor-not-allowed ${className}`}>
        {body}
      </button>
    )
  }

  return (
    <span
      onClick={onClick}
      style={style}
      className={`relative inline-flex items-center ${className}`}>
      {body}
    </span>
  )
}
