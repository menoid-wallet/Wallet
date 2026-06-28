/**
 * ShipsLogEntries.tsx
 *
 * Renders transaction history rows for Ship's Log.
 * Handles 5 entry types: open, noid (dapp), mask, unmask, noid_send
 *
 * Modal uses ReactDOM.createPortal → document.body (no overflow:hidden clipping).
 * Bottom sheet with smooth slide-up animation.
 */

import React, { useEffect, useState } from "react"
import ReactDOM from "react-dom"
import { ethers } from "ethers"
import type { TxEntry, NoidTxEntry, MaskEntry, UnmaskEntry, NoidSendEntry } from "../../lib/txStore"
import { explorerTxUrl } from "../../lib/rpc"
import { useWallet } from "../../context/WalletContext"

const DECIMALS: Record<string, number> = {
  monad: 18,
  sepolia: 18,
  base_sepolia: 18,
  solana: 9,
  sui: 9,
  aptos: 8,
}

function getRelayerFeeMon(networkId: string): string {
  if (networkId === "monad") return "0.5"
  if (networkId === "base_sepolia") return "0.00005"
  if (networkId === "sepolia") return "0.003"
  return "0.0001" // solana, sui, aptos
}

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)"
const EASE   = "cubic-bezier(0.65, 0, 0.35, 1)"

// ── helpers ───────────────────────────────────────────────────────────────────

function trunc(s: string, a = 6, b = 4): string {
  if (!s) return "—"
  return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
}

function formatMon(mon: string | null, nativeCurrency: string): string {
  if (!mon) return "—"
  try {
    const n = Number(mon)
    if (!Number.isFinite(n) || n === 0) return `0 ${nativeCurrency}`
    return `${n.toFixed(n < 0.001 ? 8 : 6)} ${nativeCurrency}`
  } catch { return "—" }
}

function formatWei(wei: string | null, decs: number, nativeCurrency: string): string {
  if (!wei) return "—"
  try {
    const s = BigInt(wei).toString().padStart(decs + 1, "0")
    const main = s.slice(0, s.length - decs)
    let frac = s.slice(s.length - decs)
    frac = frac.replace(/0+$/, "")
    const formatted = frac ? `${main}.${frac}` : main
    const n = Number(formatted)
    if (n === 0) return `0 ${nativeCurrency}`
    return `${n.toFixed(n < 0.001 ? 8 : 6)} ${nativeCurrency}`
  } catch { return "—" }
}

function formatHexWei(hex: string | null, decs: number, nativeCurrency: string): string {
  if (!hex || hex === "0x0" || hex === "0x") return `0 ${nativeCurrency}`
  try {
    const s = BigInt(hex).toString().padStart(decs + 1, "0")
    const main = s.slice(0, s.length - decs)
    let frac = s.slice(s.length - decs)
    frac = frac.replace(/0+$/, "")
    const formatted = frac ? `${main}.${frac}` : main
    const n = Number(formatted)
    if (n === 0) return `0 ${nativeCurrency}`
    return `${n.toFixed(n < 0.001 ? 8 : 6)} ${nativeCurrency}`
  } catch { return "—" }
}

function relTime(ts: number): string {
  const sec = Math.max(1, Math.round((Date.now() - ts) / 1000))
  if (sec < 60)    return `${sec}s ago`
  if (sec < 3600)  return `${Math.round(sec / 60)}m ago`
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`
  return `${Math.round(sec / 86400)}d ago`
}

function resolveAccountLabel(
  address: string,
  accountNames: Record<string, string>
): string {
  if (accountNames[address]) return accountNames[address]
  return trunc(address, 8, 6)
}

/** Human label + icon for each entry type */
function entryMeta(e: TxEntry): { label: string; icon: string; eyebrow: string } {
  switch (e.type) {
    case "open":
      return {
        label: e.functionName ?? (e.value && e.value !== "0x0" && e.value !== "0x" ? "Transfer" : "Contract Call"),
        icon: "⛵", eyebrow: "Open Transaction",
      }
    case "noid":
      return {
        label: e.functionName ?? (e.value && e.value !== "0x0" && e.value !== "0x" ? "Contract Call" : "Contract Call"),
        icon: "◉", eyebrow: "Noid Execution",
      }
    case "mask":
      return { label: "Masked", icon: "🎭", eyebrow: "Hide MON" }
    case "unmask":
      return { label: "Unmasked", icon: "✨", eyebrow: "Reveal MON" }
    case "noid_send":
      return { label: "Private Transfer", icon: "🌊", eyebrow: "Noid Send" }
  }
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

// ── Build rows for each entry type ────────────────────────────────────────────

function buildRows(
  entry: TxEntry,
  accountNames: Record<string, string>,
  activeNetwork: string,
  decs: number,
  nativeCurrency: string,
  networkLabel: string
): Array<{ label: string; value: string; mono?: boolean; accent?: boolean }> {
  switch (entry.type) {
    case "open": return [
      { label: "Tx Hash", value: trunc(entry.txHash, 10, 8), mono: true },
      ...(entry.to ? [{ label: "To", value: trunc(entry.to, 8, 6), mono: true }] : []),
      ...(entry.value && entry.value !== "0x0" && entry.value !== "0x"
        ? [{ label: "Value", value: formatHexWei(entry.value, decs, nativeCurrency), accent: true }] : []),
      ...(entry.gasUsed ? [{ label: "Gas Used", value: Number(entry.gasUsed).toLocaleString(), mono: true }] : []),
      { label: "Network", value: networkLabel },
    ]
    case "noid": {
      const n = entry as NoidTxEntry
      return [
        { label: "Tx Hash", value: trunc(n.txHash, 10, 8), mono: true },
        ...(n.noidSmartAccount ? [{ label: "Account", value: resolveAccountLabel(n.noidSmartAccount, accountNames) }] : []),
        ...(n.to ? [{ label: "To", value: trunc(n.to, 8, 6), mono: true }] : []),
        ...(n.value && n.value !== "0x0" && n.value !== "0x"
          ? [{ label: "Value", value: formatHexWei(n.value, decs, nativeCurrency), accent: true }] : []),
        ...(n.gasUsed ? [{ label: "Gas Used", value: Number(n.gasUsed).toLocaleString(), mono: true }] : []),
        ...(n.totalRelayerFee ? [{ label: "Relayer Fee", value: formatWei(n.totalRelayerFee, decs, nativeCurrency), accent: true }] : []),
        ...(n.estimatedCost   ? [{ label: "Est. Cost",   value: formatWei(n.estimatedCost, decs, nativeCurrency) }] : []),
        { label: "Network", value: networkLabel },
      ]
    }
    case "mask": {
      const m = entry as MaskEntry
      return [
        { label: "Tx Hash", value: trunc(m.txHash, 10, 8), mono: true },
        { label: "Amount", value: formatMon(m.amountMon, nativeCurrency), accent: true },
        { label: "Fee", value: formatMon(m.feeMon, nativeCurrency) },
        { label: "From", value: trunc(m.fromAddress, 8, 6), mono: true },
        { label: "Noid Key", value: trunc(m.noidPublicKey, 8, 6), mono: true },
        { label: "Network", value: networkLabel },
      ]
    }
    case "unmask": {
      const u = entry as UnmaskEntry
      return [
        { label: "Tx Hash", value: trunc(u.txHash, 10, 8), mono: true },
        { label: "Amount", value: formatMon(u.amountMon, nativeCurrency), accent: true },
        { label: "Relayer Fee", value: formatMon((u as any).relayerFeeMon ?? getRelayerFeeMon(activeNetwork), nativeCurrency) },
        { label: "To",     value: trunc(u.toAddress, 8, 6), mono: true },
        { label: "Noid Key", value: trunc(u.noidPublicKey, 8, 6), mono: true },
        { label: "Network", value: networkLabel },
      ]
    }
    case "noid_send": {
      const s = entry as NoidSendEntry
      return [
        { label: "Tx Hash",      value: trunc(s.txHash, 10, 8), mono: true },
        { label: "Amount",       value: formatMon(s.amountMon, nativeCurrency), accent: true },
        { label: "Relayer Fee",  value: formatMon((s as any).totalRelayerFee ?? null, nativeCurrency) },
        { label: "To (Noid)",    value: trunc(s.receiverNoidPublicKey, 8, 6), mono: true },
        { label: "Network",      value: networkLabel },
      ]
    }
  }
}

// ── Bottom-sheet TxDetailModal (portalled to body) ────────────────────────────

export function TxDetailModal({
  entry, isNoid, onClose,
  accountNames = {}
}: {
  entry: TxEntry; isNoid: boolean; onClose: () => void
  accountNames?: Record<string, string>
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => { requestAnimationFrame(() => setVisible(true)) }, [])

  function close() { setVisible(false); setTimeout(onClose, 320) }

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
    ? "0 -30px 70px -18px rgba(0,0,0,0.6), inset 0 1px 0 rgba(251,241,217,0.06)"
    : "0 -30px 70px -18px rgba(92,58,33,0.35), inset 0 1px 0 rgba(255,255,255,0.65)"
  const backdrop = "blur(28px) saturate(140%)"

  const titleColor    = isNoid ? "rgba(251,241,217,0.92)" : "rgba(23,19,17,0.9)"
  const subtitleColor = isNoid ? "rgba(251,241,217,0.4)"  : "rgba(23,19,17,0.45)"
  const eyebrowColor  = isNoid ? "rgba(218,162,28,0.7)"   : "rgba(163,110,20,0.65)"
  const xColor        = isNoid ? "rgba(251,241,217,0.45)" : "rgba(23,19,17,0.4)"
  const detailsBg     = isNoid ? "rgba(251,241,217,0.04)" : "rgba(23,19,17,0.03)"
  const detailsBorder = isNoid ? "1px solid rgba(251,241,217,0.08)" : "1px solid rgba(23,19,17,0.08)"
  const dragPill      = isNoid ? "rgba(251,241,217,0.15)" : "rgba(23,19,17,0.12)"

  const { activeNetwork, networkConfig } = useWallet()
  const decs = DECIMALS[activeNetwork] || 18
  const nativeCurrency = networkConfig.nativeCurrency
  const networkLabel = networkConfig.label

  const { label, icon, eyebrow } = entryMeta(entry)
  const rows = buildRows(entry, accountNames, activeNetwork, decs, nativeCurrency, networkLabel)
  const txHash = "txHash" in entry ? entry.txHash : null

  const modal = (
    <div
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 99999,
        background: isNoid ? "rgba(0,0,0,0.72)" : "rgba(0,0,0,0.5)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "flex-end",
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%",
          background: sheetBg,
          border: sheetBorder,
          borderRadius: "20px 20px 0 0", borderBottom: "none",
          boxShadow: sheetShadow,
          backdropFilter: backdrop, WebkitBackdropFilter: backdrop,
          padding: "20px 20px 128px",
          marginBottom: -100,
          display: "flex", flexDirection: "column", gap: 16,
          transform: visible ? "translateY(0)" : "translateY(100%)",
          transition: `transform 380ms cubic-bezier(0.22, 1, 0.36, 1)`,
          position: "relative", overflow: "hidden",
          maxHeight: "calc(85vh + 100px)", overflowY: "auto",
        }}>

        {/* Overlays */}
        <div className="pointer-events-none absolute inset-0 paper-grain" style={{ opacity: isNoid ? 0.18 : 0.28 }} />
        <div className="pointer-events-none absolute inset-0" style={{
          background: "radial-gradient(ellipse at 50% -10%, rgba(232,174,58,0.30) 0%, transparent 55%)"
        }} />
        <div style={{
          position: "absolute", top: "-20%", right: "-10%",
          width: 180, height: 180, borderRadius: "50%",
          background: isNoid
            ? "radial-gradient(circle, rgba(163,110,20,0.28) 0%, transparent 65%)"
            : "radial-gradient(circle, rgba(232,174,58,0.2) 0%, transparent 60%)",
          filter: "blur(40px)", pointerEvents: "none",
        }} />

        {/* Drag pill */}
        <div style={{ width: 36, height: 4, borderRadius: 2, margin: "0 auto -8px", background: dragPill }} />

        {/* Header */}
        <div style={{ position: "relative", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
            <div style={{
              width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
              background: "rgba(251,241,217,0.06)", border: "1.5px solid rgba(5,150,105,0.28)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
               color: "#059669",
            }}>
              {icon}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 8, letterSpacing: "0.42em", textTransform: "uppercase", color: eyebrowColor, marginBottom: 3 }}>
                {eyebrow}
              </p>
              <p style={{
                fontFamily: "var(--font-display, serif)", fontSize: 17,
                fontWeight: 700, letterSpacing: "-0.02em", color: titleColor,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {label}
              </p>
              <p style={{ fontSize: 10, color: subtitleColor, marginTop: 1 }}>{relTime(entry.timestamp)}</p>
            </div>
          </div>
          <button onClick={close} style={{
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
        <div style={{ borderRadius: 16, background: detailsBg, border: detailsBorder, padding: "2px 14px", position: "relative" }}>
          {rows.map((r, i) => (
            <DetailRow key={r.label} label={r.label} value={r.value}
              mono={r.mono} accent={r.accent} isNoid={isNoid} last={i === rows.length - 1} />
          ))}
        </div>

        {/* Done */}
        <button onClick={close} style={{
          width: "100%", padding: "13px 0", borderRadius: 14,
          ...(isNoid ? {
            background: "linear-gradient(135deg, rgba(163,110,20,0.22) 0%, rgba(218,162,28,0.18) 100%)",
            border: "1px solid rgba(218,162,28,0.35)", color: "#DAA21C",
          } : {
            background: "rgba(23,19,17,0.87)", border: "none", color: "#FBF1D9",
          }),
          fontSize: 10, letterSpacing: "0.28em", textTransform: "uppercase", fontWeight: 600, cursor: "pointer",
        }}>
          Done
        </button>

        {/* Explorer */}
        {txHash && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: -8 }}>
            <a href={explorerTxUrl(txHash, activeNetwork)} target="_blank" rel="noreferrer" style={{
              fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase",
              color: isNoid ? "rgba(251,241,217,0.3)" : "rgba(23,19,17,0.35)", textDecoration: "none",
            }}>
              View on Explorer ↗
            </a>
          </div>
        )}
      </div>
    </div>
  )

  return ReactDOM.createPortal(modal, document.body) as any
}

// ── Log row ───────────────────────────────────────────────────────────────────

function LogRow({
  entry, isNoid, onClick, accountNames = {}
}: {
  entry: TxEntry; isNoid: boolean; onClick: () => void
  accountNames?: Record<string, string>
}) {
  const { activeNetwork, networkConfig } = useWallet()
  const decs = DECIMALS[activeNetwork] || 18
  const nativeCurrency = networkConfig.nativeCurrency

  const [pressed, setPressed] = useState(false)
  const { label, icon } = entryMeta(entry)

  const labelColor = isNoid ? "rgba(251,241,217,0.82)" : "rgba(23,19,17,0.8)"
  const subColor   = isNoid ? "rgba(251,241,217,0.32)" : "rgba(23,19,17,0.38)"
  const hashColor  = isNoid ? "rgba(218,162,28,0.7)"  : "rgba(163,110,20,0.7)"
  const dotColor   = "rgba(5,150,105,0.85)"
  const bg         = isNoid ? "rgba(251,241,217,0.04)" : "rgba(23,19,17,0.03)"
  const border     = isNoid ? "1px solid rgba(251,241,217,0.08)" : "1px solid rgba(23,19,17,0.07)"

  // Second line: type-specific summary
  let secondLine = ""
  switch (entry.type) {
    case "open": {
      const hasValue = entry.value && entry.value !== "0x0" && entry.value !== "0x"
      secondLine = hasValue ? formatHexWei(entry.value, decs, nativeCurrency) : trunc(entry.txHash, 8, 6)
      break
    }
    case "noid": {
      const n = entry as NoidTxEntry
      secondLine = n.noidSmartAccount
        ? resolveAccountLabel(n.noidSmartAccount, accountNames)
        : trunc(n.txHash, 8, 6)
      break
    }
    case "mask":
      secondLine = `${formatMon((entry as MaskEntry).amountMon, nativeCurrency)} hidden`; break
    case "unmask":
      secondLine = `${formatMon((entry as UnmaskEntry).amountMon, nativeCurrency)} revealed`; break
    case "noid_send":
      secondLine = `${formatMon((entry as NoidSendEntry).amountMon, nativeCurrency)} → ${trunc((entry as NoidSendEntry).receiverNoidPublicKey, 6, 4)}`; break
  }

  const isMonoSecond = (entry.type === "open" && !(entry.value && entry.value !== "0x0" && entry.value !== "0x"))
    || (entry.type === "noid" && !(entry as NoidTxEntry).noidSmartAccount)

  return (
    <button
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onClick={onClick}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px", borderRadius: 14,
        background: bg, border, cursor: "pointer", textAlign: "left",
        transform: pressed ? "scale(0.975)" : "scale(1)",
        transition: `transform 200ms ${SPRING}`,
      }}>
      {/* Icon dot */}
      <div style={{
        width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
        background: isNoid ? "rgba(251,241,217,0.06)" : "rgba(23,19,17,0.05)",
        border: `1px solid ${isNoid ? "rgba(251,241,217,0.1)" : "rgba(23,19,17,0.08)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13,
          color: "#059669",
      }}>
        {icon}
      </div>

      {/* Label + secondary */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 11, fontWeight: 600, color: labelColor, marginBottom: 2,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {label}
        </p>
        <p style={{
          fontFamily: isMonoSecond ? "monospace" : "inherit",
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
  entries, isNoid, accountNames = {}
}: {
  entries: TxEntry[]
  isNoid: boolean
  accountNames?: Record<string, string>
}) {
  const [selected, setSelected] = useState<TxEntry | null>(null)
  const emptyColor = isNoid ? "rgba(251,241,217,0.35)" : "rgba(23,19,17,0.38)"

  if (entries.length === 0) {
    return (
      <p style={{ fontSize: 11, color: emptyColor, fontStyle: "italic", letterSpacing: "0.01em" }}>
        The log is empty.
      </p>
    )
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map((e, i) => (
          <LogRow
            key={`${(e as any).txHash ?? e.type}-${i}`}
            entry={e} isNoid={isNoid}
            accountNames={accountNames}
            onClick={() => setSelected(e)}
          />
        ))}
      </div>

      {selected && (
        <TxDetailModal
          entry={selected} isNoid={isNoid}
          accountNames={accountNames}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}