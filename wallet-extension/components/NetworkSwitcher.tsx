/**
 * NetworkSwitcher.tsx
 *
 * A settings panel component that lets the user pick the active network.
 * Drop this inside WalletHome's Settings tab (or wherever you want).
 *
 * Usage:
 *   import NetworkSwitcher from "./NetworkSwitcher"
 *   <NetworkSwitcher />
 */

import React from "react"
import { useWallet } from "../context/WalletContext"
import { NETWORKS, NETWORK_IDS, type NetworkId } from "../lib/networks"

// ─── Badge colours per network ────────────────────────────────────────────────
const BADGE: Record<NetworkId, { bg: string; border: string; dot: string }> = {
  monad: {
    bg:     "rgba(99,102,241,0.12)",
    border: "rgba(99,102,241,0.3)",
    dot:    "rgb(99,102,241)",
  },
  sepolia: {
    bg:     "rgba(232,174,58,0.12)",
    border: "rgba(232,174,58,0.3)",
    dot:    "rgb(232,174,58)",
  },
  base_sepolia: {
    bg:     "rgba(0,82,255,0.10)",
    border: "rgba(0,82,255,0.28)",
    dot:    "rgb(0,82,255)",
  },
}

export default function NetworkSwitcher() {
  const { activeNetwork, setActiveNetwork, networkConfig } = useWallet()

  return (
    <div className="px-4 py-3">
      <p
        className="text-[10px] tracking-[0.35em] uppercase mb-3"
        style={{ color: "rgba(23,19,17,0.4)" }}>
        Network
      </p>

      <div className="flex flex-col gap-2">
        {NETWORK_IDS.map((id) => {
          const net     = NETWORKS[id]
          const isActive = activeNetwork === id
          const badge   = BADGE[id]

          return (
            <button
              key={id}
              onClick={() => setActiveNetwork(id)}
              className="flex items-center justify-between px-3 py-2.5 rounded-2xl transition-all text-left"
              style={{
                background:  isActive ? badge.bg    : "rgba(23,19,17,0.04)",
                border:      isActive ? `1px solid ${badge.border}` : "1px solid rgba(23,19,17,0.1)",
                boxShadow:   isActive ? `0 0 0 2px ${badge.border}` : "none",
              }}>
              <div className="flex items-center gap-2.5">
                {/* Dot indicator */}
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    background: isActive ? badge.dot : "rgba(23,19,17,0.2)",
                    boxShadow:  isActive ? `0 0 6px ${badge.dot}` : "none",
                  }}
                />
                <div>
                  <p
                    className="text-[12px] font-semibold"
                    style={{ color: isActive ? "rgba(23,19,17,0.9)" : "rgba(23,19,17,0.6)" }}>
                    {net.label}
                  </p>
                  <p
                    className="text-[10px] font-mono mt-0.5"
                    style={{ color: "rgba(23,19,17,0.35)" }}>
                    Chain {net.chainId} · {net.nativeCurrency}
                  </p>
                </div>
              </div>

              {isActive && (
                <svg
                  width="14" height="14" viewBox="0 0 14 14" fill="none"
                  style={{ color: badge.dot, flexShrink: 0 }}>
                  <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M4.5 7l2 2 3-3" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          )
        })}
      </div>

      <p
        className="text-[10px] mt-3 text-center"
        style={{ color: "rgba(23,19,17,0.3)" }}>
        Active: <span className="font-semibold">{networkConfig.label}</span>
      </p>
    </div>
  )
}