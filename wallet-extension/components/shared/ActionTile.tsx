/**
 * ActionTile.tsx
 *
 * Square action button used across both wallet modes. The label and the
 * SVG glyph live together so each action stays visually distinct rather
 * than blending into a row of identical chips.
 *
 * Tones:
 *   - "default"  → light parchment tile, hover gilt edge
 *   - "muted"    → subtle (used for "coming soon" actions like Swap)
 *   - "ink"      → inverted (dark) — for primary actions on a light bg
 *   - "bone"     → light tile, used for primary actions on the dark Noid bg
 *   - "boneSoft" → translucent bone tile for muted actions on the dark Noid bg
 */

import React from "react"

export type ActionGlyph =
  | "send"
  | "receive"
  | "swap"
  | "mask"
  | "unmask"

interface Props {
  label: string
  glyph: ActionGlyph
  onClick?: () => void
  tone?: "default" | "muted" | "ink" | "bone" | "boneSoft"
  disabled?: boolean
}

export default function ActionTile({
  label,
  glyph,
  onClick,
  tone = "default",
  disabled
}: Props) {
  const base =
    "group relative overflow-hidden flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
  const toneCls =
    tone === "ink"
      ? "bg-ink text-bone border-ink hover:-translate-y-[2px] hover:shadow-[0_12px_24px_-12px_rgba(23,19,17,0.6)]"
      : tone === "bone"
        ? "bg-bone text-ink border-bone hover:-translate-y-[2px] hover:border-gold hover:shadow-[0_12px_24px_-12px_rgba(232,174,58,0.55)]"
        : tone === "boneSoft"
          ? "bg-bone/[0.06] text-bone/70 border-bone/15 hover:border-gold/40 hover:text-bone"
          : tone === "muted"
            ? "bg-ink/[0.03] text-ink/55 border-ink/8 hover:border-goldDeep/30"
            : "bg-ink/[0.05] text-ink border-ink/10 hover:border-goldDeep/40 hover:bg-goldDeep/5 hover:-translate-y-[1px]"

  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${toneCls}`}>
      <span className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition duration-500 bg-[radial-gradient(circle_at_50%_0%,_rgba(232,174,58,0.25),transparent_60%)]" />
      <span className="relative flex h-5 items-center justify-center">
        <Glyph kind={glyph} tone={tone} />
      </span>
      <span className="relative text-[9px] tracking-[0.3em] uppercase">
        {label}
      </span>
    </button>
  )
}

function Glyph({ kind, tone }: { kind: ActionGlyph; tone: Props["tone"] }) {
  // For non-ink/boneSoft tones we use "currentColor" so the glyph picks up
  // the inherited text color, which is driven by the swappable --c-ink var.
  const stroke =
    tone === "ink"
      ? "#FBF1D9"
      : tone === "boneSoft"
        ? "#FAF5E9"
        : "currentColor"
  // accent uses the swap so the gold dot becomes ink in noid mode
  const accentClass = "gold-fill"
  const accentStrokeClass = "gold-stroke"
  switch (kind) {
    case "send":
      // up-right arrow with quill flourish
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path
            d="M4 14L14 4M14 4H7M14 4V11"
            stroke={stroke}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="14" cy="4" r="0.9" className={accentClass} />
        </svg>
      )
    case "receive":
      // down-left arrow into a treasure chest hint
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path
            d="M14 4L4 14M4 14H11M4 14V7"
            stroke={stroke}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="4" cy="14" r="0.9" className={accentClass} />
        </svg>
      )
    case "swap":
      // two arrows passing — pirate compass swap
      return (
        <svg width="20" height="18" viewBox="0 0 20 18" fill="none">
          <path
            d="M3 6H15M15 6L12 3M15 6L12 9"
            stroke={stroke}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M17 12H5M5 12L8 9M5 12L8 15"
            stroke={stroke}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case "mask":
      // pirate eyepatch / domino mask
      return (
        <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
          <path
            d="M2 6 Q4 2 7 2 Q9 2 10 4 Q11 2 13 2 Q16 2 18 6 Q17 11 13 11 Q11 11 10 9 Q9 11 7 11 Q3 11 2 6 Z"
            fill={stroke}
            opacity="0.85"
          />
          <circle cx="6.5" cy="6.5" r="0.9" className={accentClass} />
          <circle cx="13.5" cy="6.5" r="0.9" className={accentClass} />
        </svg>
      )
    case "unmask":
      // mask with a strikethrough — "remove mask"
      return (
        <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
          <path
            d="M2 6 Q4 2 7 2 Q9 2 10 4 Q11 2 13 2 Q16 2 18 6 Q17 11 13 11 Q11 11 10 9 Q9 11 7 11 Q3 11 2 6 Z"
            fill="none"
            stroke={stroke}
            strokeWidth="1.4"
            opacity="0.85"
          />
          <line
            x1="2"
            y1="13"
            x2="18"
            y2="1"
            className={accentStrokeClass}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      )
  }
}