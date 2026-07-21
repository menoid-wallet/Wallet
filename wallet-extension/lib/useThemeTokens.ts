/**
 * useThemeTokens — the palette swap between the two modes.
 *
 * Both modes are the same violet sky; noid is that sky after dark, with rain.
 * So the swap is NOT "light theme / dark theme" in the usual sense — open runs
 * violet ink on a pale lilac, noid runs near-white ink on a deep violet, and
 * the accent stays in the same hue family on both sides. That is what makes the
 * mode switch read as the weather changing rather than as two different apps.
 *
 * Returns prebuilt class strings AND raw values: the classes for markup that
 * can use them, the raw hex/rgba for the many places that build inline
 * gradients and shadows, which a utility class cannot express.
 *
 * Every colour the mode views use should come from here. The old
 * ink/bone/gold set was spread across a dozen files as literals, which is
 * exactly why re-theming meant touching all of them.
 */

import { useWallet } from "../context/WalletContext"

export interface ThemeTokens {
  isNoid: boolean

  /* ── class strings ── */
  /** Filled card: surface tint + matching border */
  card: string
  /** Same idea but a touch more opaque, for inline tiles */
  cardSoft: string
  /** Full surface (treasure card style) — solid bg + matching ink */
  surface: string
  /** Default text colour for headings */
  text: string
  /** Slightly faded body text */
  textSoft: string
  /** Far-faded labels (uppercase, tracking-wide style) */
  textFaint: string
  /** Border for outlined surfaces */
  border: string

  /* ── raw values, for inline gradients and shadows ── */
  /** The ink: what type is set in on this mode's sky */
  ink: string
  /** The ink as an "r,g,b" triple, for building rgba() at a call site */
  inkRgb: string
  /** The accent — deep violet in the light, lilac in the dark */
  accent: string
  accentRgb: string
  /** Glass over this mode's sky */
  glass: string
  glassLine: string
  /** Price movement, tuned to stay legible on each sky */
  up: string
  down: string
}

/* Open runs deep violet ink on the pale lilac sky; noid runs a warm near-white
   on the storm. The accent flips the same way: --violet-deep carries the
   contrast in the light and vanishes in the dark, so noid takes lilac. */
const OPEN: Omit<ThemeTokens, "isNoid"> = {
  card: "bg-white/45 border border-white/60",
  cardSoft: "bg-white/60 border border-white/70",
  surface: "bg-white/70 text-violetDeep border border-white/70",
  text: "text-violetDeep",
  textSoft: "text-violetDeep/70",
  textFaint: "text-violetDeep/45",
  border: "border-white/60",

  ink: "#4E2F8E",
  inkRgb: "78,47,142",
  accent: "#7B55C9",
  accentRgb: "123,85,201",
  glass: "rgba(255,255,255,0.45)",
  glassLine: "rgba(255,255,255,0.62)",
  up: "#1F7A55",
  down: "#B2382A"
}

const NOID: Omit<ThemeTokens, "isNoid"> = {
  card: "bg-white/10 border border-white/16",
  cardSoft: "bg-white/14 border border-white/20",
  surface: "bg-white/12 text-white border border-white/18",
  text: "text-white",
  textSoft: "text-white/72",
  textFaint: "text-white/45",
  border: "border-white/16",

  ink: "#F4EEFF",
  inkRgb: "244,238,255",
  accent: "#C9B0FF",
  accentRgb: "201,176,255",
  glass: "rgba(255,255,255,0.10)",
  glassLine: "rgba(255,255,255,0.18)",
  up: "#6EE7A8",
  down: "#FF8E86"
}

export function useThemeTokens(): ThemeTokens {
  const { mode } = useWallet()
  return themeTokens(mode === "noid")
}

/**
 * The same table for the places that know their mode without the hook —
 * CoinDetailView takes a `pageTheme` prop rather than reading context, because
 * the noid coin page is reached from the dark sky and the open one from the
 * pale sky.
 */
export function themeTokens(isNoid: boolean): ThemeTokens {
  return { isNoid, ...(isNoid ? NOID : OPEN) }
}
