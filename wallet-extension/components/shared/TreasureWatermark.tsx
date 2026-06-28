/**
 * TreasureWatermark.tsx
 *
 * The dim, zoomed chain crest that sits in the background of the treasure
 * card, on the right. Colour matches the chain glyph as shown in the token
 * bar (cream on the dark Open card, ink on the light Noid card), so it reads
 * as a faint embossed watermark.
 *
 *   - A specific chain  → one big glyph, cropped off the right edge.
 *   - "all"             → all six crests scattered as a faint constellation.
 *
 * Each crest plays an entrance animation on mount, so it re-animates every
 * time the view re-mounts — i.e. on every Open ↔ Noid mode transition. The
 * resting opacity is carried in the `--crest-op` CSS var so the entrance
 * animation (fill: both) settles back to "dim" rather than fully opaque.
 */

import React from "react"
import { CHAINS, CHAIN_BY_ID } from "../../lib/chains"
import type { TreasureChain } from "../../context/WalletContext"

interface Props {
  treasureChain: TreasureChain
  isNoid: boolean
}

// Scatter coordinates for the "all" constellation (right-anchored).
const ALL_POS = [
  { right: "2%", top: "6%", size: 78, rot: -8 },
  { right: "30%", top: "26%", size: 58, rot: 11 },
  { right: "-4%", top: "46%", size: 92, rot: 5 },
  { right: "24%", top: "66%", size: 54, rot: -13 },
  { right: "46%", top: "4%", size: 46, rot: 13 },
  { right: "52%", top: "54%", size: 64, rot: -5 }
]

export default function TreasureWatermark({ treasureChain, isNoid }: Props) {
  // Same colour as the chain logo appears in the token bar for this mode.
  const color = isNoid ? "#171311" : "#F4E7CC"

  if (treasureChain === "all") {
    const op = isNoid ? 0.085 : 0.075
    return (
      <div className="pointer-events-none absolute inset-0 z-0">
        {CHAINS.map((c, i) => {
          const p = ALL_POS[i] ?? ALL_POS[0]
          return (
            <div
              key={c.id}
              style={{
                position: "absolute",
                right: p.right,
                top: p.top,
                width: p.size,
                height: p.size,
                color,
                animation: `treasureCrestIn 760ms cubic-bezier(0.22,1,0.36,1) ${i * 70}ms both, treasureCrestFloat ${8 + i}s ease-in-out ${800 + i * 70}ms infinite`,
                ["--rot" as any]: `${p.rot}deg`,
                ["--crest-op" as any]: op
              }}>
              {c.icon}
            </div>
          )
        })}
        <WatermarkKeyframes />
      </div>
    )
  }

  const chain = CHAIN_BY_ID[treasureChain]
  if (!chain) return null

  return (
    <>
      <div
        className="pointer-events-none absolute z-0"
        style={{
          right: -34,
          top: "50%",
          width: 220,
          height: 220,
          marginTop: -110,
          color,
          animation:
            "treasureCrestIn 800ms cubic-bezier(0.22,1,0.36,1) both, treasureCrestFloat 9s ease-in-out 800ms infinite",
          ["--rot" as any]: "0deg",
          ["--crest-op" as any]: isNoid ? 0.1 : 0.085
        }}>
        {chain.icon}
      </div>
      <WatermarkKeyframes />
    </>
  )
}

function WatermarkKeyframes() {
  return (
    <style>{`
      @keyframes treasureCrestIn {
        0% { opacity: 0; transform: scale(1.25) rotate(var(--rot,0deg)); }
        100% { opacity: var(--crest-op, 0.1); transform: scale(1) rotate(var(--rot,0deg)); }
      }
      @keyframes treasureCrestFloat {
        0%,100% { opacity: var(--crest-op, 0.1); transform: translateY(0) scale(1) rotate(var(--rot,0deg)); }
        50% { opacity: var(--crest-op, 0.1); transform: translateY(-6px) scale(1.03) rotate(var(--rot,0deg)); }
      }
    `}</style>
  )
}
