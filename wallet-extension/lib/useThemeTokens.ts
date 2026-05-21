/**
 * useThemeTokens — central source for the ink/bone palette swap used by
 * Noid mode. Returns prebuilt utility-class strings so a component can
 * inline them without sprinkling `mode === "noid"` checks everywhere.
 *
 * The swap is binary: open mode uses ink on cream, noid mode uses bone
 * on ink. Gold accents stay gold in both modes (they're our anchor / trim
 * colour from the pirate-hat logo).
 */

import { useWallet } from "../context/WalletContext"

export interface ThemeTokens {
  isNoid: boolean
  /** Filled card: surface tint + matching border */
  card: string
  /** Same idea but a touch more opaque, for inline tiles */
  cardSoft: string
  /** Full surface (treasure card style) — solid bg + bone/ink text */
  surface: string
  /** Default text colour for headings */
  text: string
  /** Slightly faded body text */
  textSoft: string
  /** Far-faded labels (uppercase, tracking-wide style) */
  textFaint: string
  /** Border for outlined surfaces */
  border: string
}

export function useThemeTokens(): ThemeTokens {
  const { mode } = useWallet()
  const isNoid = mode === "noid"
  return {
    isNoid,
    card: isNoid
      ? "bg-bone/[0.04] border border-bone/15"
      : "bg-ink/[0.04] border border-ink/10",
    cardSoft: isNoid
      ? "bg-bone/[0.06] border border-bone/15"
      : "bg-ink/[0.05] border border-ink/8",
    surface: isNoid
      ? "bg-inkSoft text-bone border border-bone/10"
      : "bg-cream text-ink border border-ink/10",
    text: isNoid ? "text-bone" : "text-ink",
    textSoft: isNoid ? "text-bone/70" : "text-ink/70",
    textFaint: isNoid ? "text-bone/40" : "text-ink/40",
    border: isNoid ? "border-bone/15" : "border-ink/12"
  }
}
