/**
 * NoidSmartAccountsModal.tsx
 *
 * Fullscreen bottom-sheet for viewing and selecting Noid Smart Accounts.
 * Lists all accounts decrypted for the active wallet, lets the user
 * pick one as selectedNoidAccount, and opens CreateNoidSmartAccountModal
 * when "Create" is tapped.
 */

import React, { useState } from "react"
import LiquidSheet from "./LiquidSheet"
import type { NoidSmartAccount } from "../../context/PoolContext"

interface Props {
  open: boolean
  onClose: () => void
  accounts: NoidSmartAccount[]
  selected: NoidSmartAccount | null
  onSelect: (acc: NoidSmartAccount) => void
  onCreateAccount: () => void
}

function truncAddr(a: string | undefined): string {
  if (!a) return "Pending…"
  return a.length > 20 ? `${a.slice(0, 10)}…${a.slice(-8)}` : a
}
function truncCmx(c: string | undefined): string {
  if (!c) return "—"
  return c.length > 20 ? `${c.slice(0, 10)}…${c.slice(-6)}` : c
}

export default function NoidSmartAccountsModal({
  open,
  onClose,
  accounts,
  selected,
  onSelect,
  onCreateAccount
}: Props) {
  const [hoveredCmx, setHoveredCmx] = useState<string | null>(null)

  return (
    <LiquidSheet open={open} onClose={onClose} tone="ink" defaultFullscreen>
      <div className="px-6 pt-2 pb-8 flex flex-col gap-5">

        {/* ── Header ── */}
        <div className="pt-2">
          <p
            className="text-[8px] tracking-[0.45em] uppercase mb-1"
            style={{ color: "rgba(232,174,58,0.55)" }}>
            Accounts
          </p>
          <h2
            className="font-display font-bold text-[20px] tracking-tight"
            style={{ color: "rgba(251,241,217,0.9)" }}>
            Noid Smart Accounts
          </h2>
          <p
            className="mt-1 text-[10px] leading-relaxed"
            style={{ color: "rgba(251,241,217,0.35)" }}>
            Smart accounts linked to this wallet's ZK identity.
          </p>
        </div>

        {/* ── Account list ── */}
        {accounts.length === 0 ? (
          <div
            className="rounded-2xl px-5 py-8 flex flex-col items-center text-center gap-2"
            style={{
              background: "rgba(251,241,217,0.03)",
              border: "1px solid rgba(251,241,217,0.07)"
            }}>
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl mb-1"
              style={{
                background: "rgba(163,110,20,0.12)",
                border: "1px solid rgba(163,110,20,0.2)"
              }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="2" width="7" height="7" rx="2" stroke="#A36E14" strokeWidth="1.4" />
                <rect x="11" y="2" width="7" height="7" rx="2" stroke="#A36E14" strokeWidth="1.4" />
                <rect x="2" y="11" width="7" height="7" rx="2" stroke="#A36E14" strokeWidth="1.4" />
                <rect x="11" y="11" width="7" height="7" rx="2" stroke="rgba(163,110,20,0.35)" strokeWidth="1.4" strokeDasharray="2 2" />
                <path d="M14.5 13.5v3M13 15h3" stroke="#A36E14" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-[12px] font-display font-semibold" style={{ color: "rgba(251,241,217,0.5)" }}>
              No smart accounts yet
            </p>
            <p className="text-[10px]" style={{ color: "rgba(251,241,217,0.25)" }}>
              Create a Noid Smart Account to get started.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {accounts.map((acc) => {
              const isSelected = selected?.commitment === acc.commitment
              const isHovered  = hoveredCmx === acc.commitment

              return (
                <button
                  key={acc.commitment}
                  onClick={() => { onSelect(acc); onClose() }}
                  onPointerEnter={() => setHoveredCmx(acc.commitment)}
                  onPointerLeave={() => setHoveredCmx(null)}
                  className="w-full text-left rounded-2xl px-4 py-4 relative overflow-hidden"
                  style={{
                    background: isSelected
                      ? "linear-gradient(145deg, rgba(232,174,58,0.13) 0%, rgba(163,110,20,0.09) 100%)"
                      : isHovered ? "rgba(251,241,217,0.05)" : "rgba(251,241,217,0.02)",
                    border: isSelected
                      ? "1px solid rgba(232,174,58,0.32)"
                      : isHovered ? "1px solid rgba(251,241,217,0.12)" : "1px solid rgba(251,241,217,0.07)",
                    boxShadow: isSelected
                      ? "inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 20px rgba(163,110,20,0.15)"
                      : "none",
                    transition: "all 280ms cubic-bezier(0.65,0,0.35,1)"
                  }}>

                  {isSelected && (
                    <div
                      className="absolute right-4 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full"
                      style={{ background: "rgba(163,110,20,0.25)", border: "1px solid rgba(163,110,20,0.45)" }}>
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5.5L4 7.5L8 3" stroke="#E8AE3A" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}

                  <p
                    className="text-[8px] tracking-[0.35em] uppercase mb-2"
                    style={{ color: isSelected ? "rgba(232,174,58,0.55)" : "rgba(251,241,217,0.22)" }}>
                    Commitment
                  </p>
                  <p
                    className="font-mono text-[12px] mb-3"
                    style={{ color: isSelected ? "rgba(251,241,217,0.85)" : "rgba(251,241,217,0.55)" }}>
                    {truncCmx(acc.commitment)}
                  </p>

                  <div
                    className="flex items-center gap-2 pt-2.5"
                    style={{ borderTop: "1px solid rgba(251,241,217,0.06)" }}>
                    <div
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                      style={{
                        background: isSelected ? "rgba(163,110,20,0.2)" : "rgba(251,241,217,0.05)",
                        border: isSelected ? "1px solid rgba(163,110,20,0.3)" : "1px solid rgba(251,241,217,0.08)"
                      }}>
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                        <path d="M6 1L9 4H7V8H5V4H3L6 1Z" fill={isSelected ? "#A36E14" : "rgba(251,241,217,0.3)"} />
                        <rect x="2" y="9" width="8" height="1.5" rx="0.75" fill={isSelected ? "#A36E14" : "rgba(251,241,217,0.2)"} />
                      </svg>
                    </div>
                    <span className="text-[8px] tracking-[0.25em] uppercase shrink-0"
                      style={{ color: "rgba(251,241,217,0.2)" }}>
                      Account
                    </span>
                    <span className="font-mono text-[11px] truncate"
                      style={{ color: isSelected ? "rgba(232,174,58,0.75)" : "rgba(251,241,217,0.4)" }}>
                      {truncAddr(acc.account)}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* ── Divider ── */}
        <div style={{
          height: "1px",
          background: "linear-gradient(to right, transparent, rgba(251,241,217,0.08), transparent)"
        }} />

        {/* ── Create button ── */}
        <button
          onClick={onCreateAccount}
          className="w-full rounded-2xl py-4 relative overflow-hidden"
          style={{
            background: "linear-gradient(135deg, rgba(232,174,58,0.10) 0%, rgba(163,110,20,0.08) 100%)",
            border: "1px solid rgba(232,174,58,0.22)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 16px rgba(163,110,20,0.12)"
          }}>
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(232,174,58,0.12) 0%, transparent 60%)" }}
          />
          <span className="relative flex items-center justify-center gap-2.5">
            <div
              className="flex h-5 w-5 items-center justify-center rounded-md"
              style={{ background: "rgba(163,110,20,0.25)", border: "1px solid rgba(163,110,20,0.35)" }}>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                <path d="M5 1.5v7M1.5 5h7" stroke="#E8AE3A" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <span
              className="font-display font-bold text-[12px] tracking-wide"
              style={{ color: "rgba(232,174,58,0.82)" }}>
              Create Noid Smart Account
            </span>
          </span>
        </button>

      </div>
    </LiquidSheet>
  )
}