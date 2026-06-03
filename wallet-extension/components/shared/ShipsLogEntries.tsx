/**
 * ShipsLogEntries.tsx
 *
 * Tx history for Ship's Log in OpenModeView and NoidModeView.
 *
 * - Compact rows shown directly in the section
 * - On click → bottom-sheet modal (full width, slides up, X to close)
 * - Modal uses ReactDOM.createPortal so overflow:hidden never clips it
 * - Noid entries show smart account name (if set) or truncated address
 * - isNoid=true → dark gold palette; false → cream/light palette
 */

import React, { useEffect, useRef, useState } from "react"
import ReactDOM from "react-dom"
import { ethers } from "ethers"
import type { TxEntry, NoidTxEntry } from "../../lib/txStore"
import type { NoidSmartAccount } from "../../context/PoolContext"
import { explorerTxUrl } from "../../lib/monadRpc"

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)"
const EASE   = "cubic-bezier(0.65, 0, 0.35, 1)"

// ── helpers ───────────────────────────────────────────────────────────────────

function trunc(s: string, a = 6, b = 4): string {
  if (!s) return "—"
  return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
}

function formatWei(wei: string | null): string {
  if (!wei) return "—"
  try {
    const n = Number(ethers.formatEther(BigInt(wei)))
    if (n === 0) return "0 MON"
    return `${n.toFixed(n < 0.001 ? 8 : 6)} MON`
  } catch { return "—" }
}

function formatHexWei(hex: string | null): string {
  if (!hex || hex === "0x0" || hex === "0x") return "0 MON"
  try {
    const n = Number(ethers.formatEther(BigInt(hex)))
    if (n === 0) return "0 MON"
    return `${n.toFixed(n < 0.001 ? 8 : 6)} MON`
  } catch { return "—" }
}

function relTime(ts: number): string {
  const sec = Math.max(1, Math.round((Date.now() - ts) / 1000))
  if (sec < 60)    return `${sec}s ago`
  if (sec < 3600)  return `${Math.round(sec / 60)}m ago`
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`
  return `${Math.round(sec / 86400)}d ago`
}

function entryLabel(e: TxEntry): string {
  return e.functionName
    ?? (e.value && e.value !== "0x0" && e.value !== "0x" ? "Transfer" : "Contract Call")
}

/** Resolve smart account display name: user label > truncated address */
function resolveAccountLabel(
  address: string,
  accountNames: Record<string, string>,
  smartAccounts: NoidSmartAccount[]
): string {
  // accountNames is keyed by commitment, so find the matching account first
  const acc = smartAccounts.find(a => a.account.toLowerCase() === address.toLowerCase())
  if (acc && accountNames[acc.commitment]) return accountNames[acc.commitment]
  return trunc(address, 8, 6)
}

// ── DetailRow ─────────────────────────────────────────────────────────────────

function DetailRow({
  label, value, mono = false, accent = false, isNoid, last = false
}: {
  label: string; value: string; mono?: boolean; accent?: boolean
  isNoid: boolean; last?: boolean
}) {
  const labelColor  = isNoid ? "rgba(251,241,217,0.38)" : "rgba(23,19,17,0.42)"
  const textColor   = isNoid
    ? (accent ? "#DAA21C"  : "rgba(251,241,217,0.85)")
    : (accent ? "#A36E14"  : "rgba(23,19,17,0.85)")
  const borderColor = isNoid ? "rgba(251,241,217,0.07)" : "rgba(23,19,17,0.07)"
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      padding: "8px 0",
      borderBottom: last ? "none" : `1px solid ${borderColor}`,
    }}>
      <span style={{
        fontSize: 9, letterSpacing: "0.28em", textTransform: "uppercase",
        color: labelColor, flexShrink: 0, marginRight: 12, paddingTop: 1,
      }}>{label}</span>
      <span style={{
        fontSize: mono ? 10 : 11,
        fontFamily: mono ? "monospace" : "inherit",
        color: textColor, fontWeight: accent ? 600 : 400,
        textAlign: "right", wordBreak: "break-all", maxWidth: "64%",
      }}>{value}</span>
    </div>
  )
}

// ── Bottom-sheet TxDetailModal (portalled to body) ────────────────────────────

export function TxDetailModal({
  entry, isNoid, onClose,
  accountNames = {}, smartAccounts = []
}: {
  entry: TxEntry
  isNoid: boolean
  onClose: () => void
  accountNames?: Record<string, string>
  smartAccounts?: NoidSmartAccount[]
}) {
  const [visible, setVisible] = useState(false)

  // Slide in on mount
  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(t)
  }, [])

  // Close with slide-out
  function close() {
    setVisible(false)
    setTimeout(onClose, 320)
  }

  // Escape key
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") close() }
    document.addEventListener("keydown", fn)
    return () => document.removeEventListener("keydown", fn)
  }, [])

  const sheetBg = isNoid
    ? "linear-gradient(170deg, #1E1810 0%, #0D0A07 60%, #171311 100%)"
    : "linear-gradient(165deg, rgba(251,241,217,0.78) 0%, rgba(244,231,204,0.82) 60%, rgba(234,213,167,0.86) 100%)"
  const sheetBorder = isNoid
    ? "1px solid rgba(251,241,217,0.1)"
    : "1px solid rgba(23,19,17,0.12)"
  const sheetShadow = isNoid
    ? "0 -24px 60px -8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(251,241,217,0.06)"
    : "0 -30px 70px -18px rgba(92,58,33,0.35), inset 0 1px 0 rgba(255,255,255,0.65)"
  const sheetBackdrop = "blur(28px) saturate(140%)"

  const titleColor    = isNoid ? "rgba(251,241,217,0.92)" : "rgba(23,19,17,0.9)"
  const subtitleColor = isNoid ? "rgba(251,241,217,0.4)"  : "rgba(23,19,17,0.45)"
  const eyebrowColor  = isNoid ? "rgba(218,162,28,0.7)"   : "rgba(163,110,20,0.65)"
  const xColor        = isNoid ? "rgba(251,241,217,0.45)" : "rgba(23,19,17,0.4)"
  const detailsBg     = isNoid ? "rgba(251,241,217,0.04)" : "rgba(23,19,17,0.03)"
  const detailsBorder = isNoid ? "1px solid rgba(251,241,217,0.08)" : "1px solid rgba(23,19,17,0.08)"

  const noidEntry = entry.type === "noid" ? (entry as NoidTxEntry) : null

  const rows: Array<{ label: string; value: string; mono?: boolean; accent?: boolean }> = [
    { label: "Tx Hash", value: trunc(entry.txHash, 10, 8), mono: true },
    ...(noidEntry?.noidSmartAccount
      ? [{ label: "Account", value: resolveAccountLabel(noidEntry.noidSmartAccount, accountNames, smartAccounts) }]
      : []),
    ...(entry.to ? [{ label: "To", value: trunc(entry.to, 8, 6), mono: true }] : []),
    ...(entry.value && entry.value !== "0x0" && entry.value !== "0x"
      ? [{ label: "Value", value: formatHexWei(entry.value), accent: true }] : []),
    ...(entry.gasUsed ? [{ label: "Gas Used", value: Number(entry.gasUsed).toLocaleString(), mono: true }] : []),
    ...(noidEntry?.totalRelayerFee ? [{ label: "Relayer Fee", value: formatWei(noidEntry.totalRelayerFee), accent: true }] : []),
    ...(noidEntry?.estimatedCost   ? [{ label: "Est. Cost",   value: formatWei(noidEntry.estimatedCost) }] : []),
    { label: "Network", value: "Monad Testnet" },
  ]

  const modal = (
    /* Backdrop */
    <div
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 99999,
        background: isNoid ? "rgba(0,0,0,0.72)" : "rgba(0,0,0,0.5)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "flex-end",
        transition: `background 300ms ${EASE}`,
      }}>

      {/* Sheet */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%",
          background: sheetBg,
          border: sheetBorder,
          borderRadius: "20px 20px 0 0",
          borderBottom: "none",
          boxShadow: sheetShadow,
          backdropFilter: sheetBackdrop,
          WebkitBackdropFilter: sheetBackdrop,
          /* Extra padding at bottom extends the background colour so the
             viewport bottom stays filled during the slide-up animation */
          padding: "20px 20px 128px",
          marginBottom: -100,
          display: "flex", flexDirection: "column", gap: 16,
          transform: visible ? "translateY(0)" : "translateY(100%)",
          transition: `transform 380ms cubic-bezier(0.22, 1, 0.36, 1)`,
          position: "relative", overflow: "hidden",
          maxHeight: "calc(85vh + 100px)", overflowY: "auto",
        }}>

        {/* Paper grain — matches LiquidSheet */}
        <div className="pointer-events-none absolute inset-0 paper-grain"
          style={{ opacity: isNoid ? 0.18 : 0.28 }} />
        {/* Gold radial top overlay — matches LiquidSheet */}
        <div className="pointer-events-none absolute inset-0" style={{
          background: "radial-gradient(ellipse at 50% -10%, rgba(232,174,58,0.30) 0%, transparent 55%)"
        }} />

        {/* Ambient orb */}
        <div style={{
          position: "absolute", top: "-20%", right: "-10%",
          width: 180, height: 180, borderRadius: "50%",
          background: isNoid
            ? "radial-gradient(circle, rgba(163,110,20,0.28) 0%, transparent 65%)"
            : "radial-gradient(circle, rgba(232,174,58,0.2) 0%, transparent 60%)",
          filter: "blur(40px)", pointerEvents: "none",
        }} />

        {/* Drag pill */}
        <div style={{
          width: 36, height: 4, borderRadius: 2, margin: "0 auto -8px",
          background: isNoid ? "rgba(251,241,217,0.15)" : "rgba(23,19,17,0.12)",
        }} />

        {/* Header row: title + X */}
        <div style={{
          position: "relative", display: "flex", alignItems: "flex-start",
          justifyContent: "space-between", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
            {/* Check icon */}
            <div style={{
              width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
              background: "rgba(5,150,105,0.1)",
              border: "1.5px solid rgba(5,150,105,0.28)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
                <path d="M2 7L5.5 10.5L12 4" stroke="#059669" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{
                fontSize: 8, letterSpacing: "0.42em", textTransform: "uppercase",
                color: eyebrowColor, marginBottom: 3,
              }}>
                {entry.type === "noid" ? "Noid Execution" : "Open Transaction"}
              </p>
              <p style={{
                fontFamily: "var(--font-display, serif)", fontSize: 17,
                fontWeight: 700, letterSpacing: "-0.02em", color: titleColor,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {entryLabel(entry)}
              </p>
              <p style={{ fontSize: 10, color: subtitleColor, marginTop: 1 }}>
                {relTime(entry.timestamp)}
              </p>
            </div>
          </div>

          {/* X button */}
          <button
            onClick={close}
            style={{
              width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
              background: isNoid ? "rgba(251,241,217,0.06)" : "rgba(23,19,17,0.06)",
              border: isNoid ? "1px solid rgba(251,241,217,0.1)" : "1px solid rgba(23,19,17,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: xColor,
            }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Details */}
        <div style={{
          borderRadius: 16, background: detailsBg, border: detailsBorder,
          padding: "2px 14px", position: "relative",
        }}>
          {rows.map((r, i) => (
            <DetailRow
              key={r.label}
              label={r.label} value={r.value}
              mono={r.mono} accent={r.accent}
              isNoid={isNoid}
              last={i === rows.length - 1}
            />
          ))}
        </div>

        {/* Done */}
        <button
          onClick={close}
          style={{
            width: "100%", padding: "13px 0", borderRadius: 14,
            ...(isNoid ? {
              background: "linear-gradient(135deg, rgba(163,110,20,0.22) 0%, rgba(218,162,28,0.18) 100%)",
              border: "1px solid rgba(218,162,28,0.35)",
              color: "#DAA21C",
            } : {
              background: "rgba(23,19,17,0.87)",
              border: "none",
              color: "#FBF1D9",
            }),
            fontSize: 10, letterSpacing: "0.28em",
            textTransform: "uppercase", fontWeight: 600, cursor: "pointer",
          }}>
          Done
        </button>

        {/* Explorer link */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: -8 }}>
          <a
            href={explorerTxUrl(entry.txHash)}
            target="_blank" rel="noreferrer"
            style={{
              fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase",
              color: isNoid ? "rgba(251,241,217,0.3)" : "rgba(23,19,17,0.35)",
              textDecoration: "none",
            }}>
            View on Explorer ↗
          </a>
        </div>
      </div>
    </div>
  )

  return ReactDOM.createPortal(modal, document.body)
}

// ── Log row ───────────────────────────────────────────────────────────────────

function LogRow({
  entry, isNoid, onClick,
  accountNames = {}, smartAccounts = []
}: {
  entry: TxEntry; isNoid: boolean; onClick: () => void
  accountNames?: Record<string, string>
  smartAccounts?: NoidSmartAccount[]
}) {
  const [pressed, setPressed] = useState(false)

  const label      = entryLabel(entry)
  const hashColor  = isNoid ? "rgba(218,162,28,0.7)"  : "rgba(163,110,20,0.7)"
  const labelColor = isNoid ? "rgba(251,241,217,0.82)" : "rgba(23,19,17,0.8)"
  const subColor   = isNoid ? "rgba(251,241,217,0.32)" : "rgba(23,19,17,0.38)"
  const dotColor   = "rgba(5,150,105,0.85)"
  const bg         = isNoid ? "rgba(251,241,217,0.04)" : "rgba(23,19,17,0.03)"
  const border     = isNoid ? "1px solid rgba(251,241,217,0.08)" : "1px solid rgba(23,19,17,0.07)"

  // Second line: for noid show account name/address, for open show tx hash
  const noidEntry = entry.type === "noid" ? (entry as NoidTxEntry) : null
  const secondLine = noidEntry?.noidSmartAccount
    ? resolveAccountLabel(noidEntry.noidSmartAccount, accountNames, smartAccounts)
    : trunc(entry.txHash, 8, 6)

  return (
    <button
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onClick={onClick}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px", borderRadius: 14,
        background: bg, border,
        cursor: "pointer", textAlign: "left",
        transform: pressed ? "scale(0.975)" : "scale(1)",
        transition: `transform 200ms ${SPRING}`,
      }}>
      {/* Green success dot */}
      <div style={{
        width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
        background: dotColor, boxShadow: `0 0 7px ${dotColor}`,
      }} />

      {/* Label + secondary info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 11, fontWeight: 600, color: labelColor,
          marginBottom: 2,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {label}
        </p>
        <p style={{
          fontFamily: noidEntry?.noidSmartAccount && secondLine !== trunc(entry.txHash, 8, 6)
            ? "inherit" : "monospace",
          fontSize: 9, color: hashColor,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {secondLine}
        </p>
      </div>

      {/* Time + chevron */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
        <p style={{ fontSize: 9, color: subColor }}>{relTime(entry.timestamp)}</p>
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
          <path d="M3.5 2L6.5 5L3.5 8" stroke={subColor} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </button>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function ShipsLogEntries({
  entries, isNoid, accountNames = {}, smartAccounts = []
}: {
  entries: TxEntry[]
  isNoid: boolean
  accountNames?: Record<string, string>
  smartAccounts?: NoidSmartAccount[]
}) {
  const [selected, setSelected] = useState<TxEntry | null>(null)

  const emptyColor = isNoid ? "rgba(251,241,217,0.35)" : "rgba(23,19,17,0.38)"

  if (entries.length === 0) {
    return (
      <p style={{
        fontSize: 11, color: emptyColor,
        fontStyle: "italic", letterSpacing: "0.01em",
      }}>
        The log is empty.
      </p>
    )
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map((e, i) => (
          <LogRow
            key={`${e.txHash}-${i}`}
            entry={e} isNoid={isNoid}
            accountNames={accountNames}
            smartAccounts={smartAccounts}
            onClick={() => setSelected(e)}
          />
        ))}
      </div>

      {selected && (
        <TxDetailModal
          entry={selected}
          isNoid={isNoid}
          accountNames={accountNames}
          smartAccounts={smartAccounts}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}