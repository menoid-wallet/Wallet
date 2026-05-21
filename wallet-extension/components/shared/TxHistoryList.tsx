/**
 * TxHistoryList.tsx
 *
 * Collapsed "ship's log" view of recent transactions. Each row shows:
 *   - direction (in / out / self) as a pirate glyph
 *   - counterparty (truncated)
 *   - signed amount + MON ticker
 *   - relative time
 *
 * Click a row to expand:
 *   - full hash (mono)
 *   - block number, gas, status badge
 *   - "View in explorer" button
 *
 * Open Mode only — the parent decides not to render this in Noid mode.
 */

import React, { useState } from "react"
import { explorerTxUrl, type TxHistoryItem } from "../../lib/monadRpc"

interface Props {
  items: TxHistoryItem[]
  loading?: boolean
  emptyHint?: string
}

export default function TxHistoryList({ items, loading, emptyHint }: Props) {
  if (loading && items.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-14 rounded-xl bg-ink/5 animate-pulse"
          />
        ))}
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 rounded-2xl border border-dashed border-ink/15">
        <span className="text-2xl mb-2">🏴‍☠️</span>
        <p className="text-[12px] text-ink/45 font-serif italic">
          {emptyHint ?? "No transactions yet"}
        </p>
        <p className="text-[10px] text-ink/30 mt-1">Your voyage awaits</p>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {items.map((tx) => (
        <Row key={tx.hash} tx={tx} />
      ))}
    </div>
  )
}

function Row({ tx }: { tx: TxHistoryItem }) {
  const [open, setOpen] = useState(false)
  const isOut = tx.direction === "out"
  const isSelf = tx.direction === "self"
  const valueClass =
    isSelf ? "text-ink/70" : isOut ? "text-red-600/80" : "text-emerald-600/85"
  const amount = Number(tx.valueFormatted)
  const amountTxt = `${isSelf ? "" : isOut ? "-" : "+"}${amount.toFixed(4)} MON`

  function trunc(s: string, a = 6, b = 4) {
    if (!s) return ""
    return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
  }

  return (
    <div className="rounded-xl bg-ink/[0.04] border border-ink/10 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-ink/[0.07] transition-colors text-left">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            isSelf
              ? "bg-ink/10"
              : isOut
                ? "bg-red-500/10"
                : "bg-emerald-500/10"
          }`}>
          <DirectionGlyph dir={tx.direction} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-display font-semibold text-ink/85 leading-tight">
            {isSelf ? "Self transfer" : isOut ? "Sent" : "Received"}
          </p>
          <p className="font-mono text-[10px] text-ink/45 mt-0.5">
            {isOut ? "To " : "From "}
            {trunc(isOut ? tx.to : tx.from)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-[12px] font-semibold ${valueClass}`}>
            {amountTxt}
          </p>
          <p className="text-[10px] text-ink/40 mt-0.5">
            {relTime(tx.timestamp)}
          </p>
        </div>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className={`text-ink/40 shrink-0 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}>
          <path
            d="M2 4L5 7L8 4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-1.5 border-t border-ink/8 bg-ink/[0.02]">
          <DetailRow label="Hash" value={tx.hash} mono mid />
          <DetailRow label="From" value={tx.from} mono mid />
          <DetailRow label="To" value={tx.to} mono mid />
          <DetailRow label="Block" value={String(tx.blockNumber)} />
          {tx.gasUsed && <DetailRow label="Gas used" value={tx.gasUsed} />}
          {tx.gasPriceFormatted && (
            <DetailRow
              label="Gas price"
              value={`${tx.gasPriceFormatted} gwei`}
            />
          )}
          <DetailRow
            label="Status"
            value={
              tx.status === "success"
                ? "Success"
                : tx.status === "failed"
                  ? "Failed"
                  : "Pending"
            }
            badge={
              tx.status === "success"
                ? "ok"
                : tx.status === "failed"
                  ? "bad"
                  : "warn"
            }
          />
          <a
            href={explorerTxUrl(tx.hash)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-ink text-bone py-2.5 text-[10px] tracking-[0.3em] uppercase hover:-translate-y-[1px] transition">
            View in Explorer
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M3 1H9V7M9 1L1 9"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </a>
        </div>
      )}
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono,
  mid,
  badge
}: {
  label: string
  value: string
  mono?: boolean
  mid?: boolean
  badge?: "ok" | "bad" | "warn"
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[9px] tracking-[0.3em] uppercase text-ink/40 shrink-0 pt-0.5">
        {label}
      </span>
      <span className="min-w-0 text-right">
        {badge ? (
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] tracking-[0.2em] uppercase ${
              badge === "ok"
                ? "bg-emerald-500/15 text-emerald-700"
                : badge === "bad"
                  ? "bg-red-500/15 text-red-700"
                  : "bg-amber-500/15 text-amber-700"
            }`}>
            <span
              className={`h-1 w-1 rounded-full ${
                badge === "ok"
                  ? "bg-emerald-500"
                  : badge === "bad"
                    ? "bg-red-500"
                    : "bg-amber-500"
              }`}
            />
            {value}
          </span>
        ) : (
          <span
            className={`block break-all text-[10px] ${
              mono ? "font-mono" : ""
            } ${mid ? "text-ink/70" : "text-ink/65"}`}>
            {value}
          </span>
        )}
      </span>
    </div>
  )
}

function DirectionGlyph({ dir }: { dir: TxHistoryItem["direction"] }) {
  if (dir === "self") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M4 4L10 4L8 2M10 10L4 10L6 12"
          stroke="#171311"
          strokeOpacity="0.6"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (dir === "out") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M3 11L11 3M11 3H5M11 3V9"
          stroke="#dc2626"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M11 3L3 11M3 11H9M3 11V5"
        stroke="#059669"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function relTime(ms: number): string {
  if (!ms) return "—"
  const diff = Date.now() - ms
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  const d = new Date(ms)
  return d.toLocaleDateString()
}