/**
 * ActionTile.tsx
 *
 * Square action button used across both wallet modes.
 *
 * Tones:
 *   - "default"   → light parchment tile, hover gilt edge (Open mode)
 *   - "muted"     → subtle (used for "coming soon" actions like Swap, Open mode)
 *   - "ink"       → inverted dark — for primary actions on a light bg
 *   - "bone"      → light tile on dark Noid bg (kept for legacy)
 *   - "boneSoft"  → translucent bone tile (kept for legacy)
 *   - "cream"     → cream/parchment tile — matches Open mode bg, used in Noid mode
 *   - "creamSoft" → softer/muted cream tile — for secondary Noid mode actions
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
  tone?: "default" | "muted" | "ink" | "bone" | "boneSoft" | "cream" | "creamSoft"
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
          : tone === "cream"
            // Cream tile: uses Open mode background (#FBF1D9) with ink text — warm on dark bg
            ? "bg-[#FBF1D9] text-ink border-[#E8D5A3] hover:-translate-y-[2px] hover:border-goldDeep/60 hover:shadow-[0_12px_24px_-12px_rgba(232,174,58,0.45)]"
            : tone === "creamSoft"
              // Softer/muted variant — translucent cream
              ? "bg-[#FBF1D9]/60 text-ink/65 border-[#E8D5A3]/60 hover:border-goldDeep/40 hover:text-ink hover:bg-[#FBF1D9]/80"
              : tone === "muted"
                ? "bg-ink/[0.03] text-ink/55 border-ink/8 hover:border-goldDeep/30"
                : /* default */
                  "bg-ink/[0.05] text-ink border-ink/10 hover:border-goldDeep/40 hover:bg-goldDeep/5 hover:-translate-y-[1px]"

  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${toneCls}`}>
      <span className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition duration-500 bg-[radial-gradient(circle_at_50%_0%,_rgba(232,174,58,0.22),transparent_60%)]" />
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
  // cream tones use ink stroke so they read on the light cream tile
  const stroke =
    tone === "ink"
      ? "#FBF1D9"
      : tone === "boneSoft"
        ? "#FAF5E9"
        : tone === "cream"
          ? "#171311"   // ink on cream
          : tone === "creamSoft"
            ? "rgba(23,19,17,0.6)"   // soft ink on cream
            : "currentColor"

  const accentClass = "gold-fill"
  const accentStrokeClass = "gold-stroke"

  // For cream tones the gold accent looks great on parchment
  const accentFill = (tone === "cream" || tone === "creamSoft") ? "#A36E14" : undefined

  switch (kind) {
    case "send":
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path
            d="M4 14L14 4M14 4H7M14 4V11"
            stroke={stroke}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {accentFill
            ? <circle cx="14" cy="4" r="0.9" fill={accentFill} />
            : <circle cx="14" cy="4" r="0.9" className={accentClass} />
          }
        </svg>
      )
    case "receive":
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path
            d="M14 4L4 14M4 14H11M4 14V7"
            stroke={stroke}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {accentFill
            ? <circle cx="4" cy="14" r="0.9" fill={accentFill} />
            : <circle cx="4" cy="14" r="0.9" className={accentClass} />
          }
        </svg>
      )
    case "swap":
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
      return (
        <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
          <path
            d="M2 6 Q4 2 7 2 Q9 2 10 4 Q11 2 13 2 Q16 2 18 6 Q17 11 13 11 Q11 11 10 9 Q9 11 7 11 Q3 11 2 6 Z"
            fill={stroke}
            opacity="0.85"
          />
          {accentFill
            ? (
              <>
                <circle cx="6.5" cy="6.5" r="0.9" fill={accentFill} />
                <circle cx="13.5" cy="6.5" r="0.9" fill={accentFill} />
              </>
            ) : (
              <>
                <circle cx="6.5" cy="6.5" r="0.9" className={accentClass} />
                <circle cx="13.5" cy="6.5" r="0.9" className={accentClass} />
              </>
            )
          }
        </svg>
      )
    case "unmask":
      return (
        <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
          <path
            d="M2 6 Q4 2 7 2 Q9 2 10 4 Q11 2 13 2 Q16 2 18 6 Q17 11 13 11 Q11 11 10 9 Q9 11 7 11 Q3 11 2 6 Z"
            fill="none"
            stroke={stroke}
            strokeWidth="1.4"
            opacity="0.85"
          />
          {accentFill
            ? <line x1="2" y1="13" x2="18" y2="1" stroke={accentFill} strokeWidth="1.4" strokeLinecap="round" />
            : <line x1="2" y1="13" x2="18" y2="1" className={accentStrokeClass} strokeWidth="1.4" strokeLinecap="round" />
          }
        </svg>
      )
  }
}