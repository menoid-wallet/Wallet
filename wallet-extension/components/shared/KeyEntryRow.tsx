/**
 * KeyEntryRow.tsx
 *
 * One row inside the "Copy Key" popover. Shows the chain glyph (symbol) +
 * label on top of the truncated key, and copies the full value on click
 * with a smooth icon-morph (copy → check) and a gold flash. Self-contained
 * copied-state so the parent popovers stay declarative.
 *
 * Rendered on the dark popover surface in both modes, so colours are fixed
 * to the bone/gold palette.
 */

import React, { useRef, useState } from "react"

interface Props {
  icon: React.ReactNode
  label: string
  value: string
  /** accent for the glyph chip + copied state (defaults to gold) */
  accent?: string
}

function trunc(s: string, a = 12, b = 10) {
  if (!s) return "—"
  return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
}

export default function KeyEntryRow({ icon, value, accent = "#F4E7CC" }: Props) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = () => {
    if (!value) return
    navigator.clipboard.writeText(value)
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1400)
  }

  return (
    <button
      onClick={copy}
      className="group flex w-full items-center gap-2 rounded-lg p-1.5 text-left transition-colors"
      style={{
        background: copied ? "rgba(232,174,58,0.12)" : "transparent",
        transition: "background 300ms cubic-bezier(0.65,0,0.35,1)"
      }}>
      {/* symbol chip */}
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md p-1"
        style={{
          background: "rgba(244,231,204,0.14)",
          border: "1px solid rgba(244,231,204,0.26)",
          color: accent
        }}>
        {icon}
      </span>

      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-bone/85">
        {trunc(value)}
      </span>

      {/* copy / check morph */}
      <span
        className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
        style={{
          background: copied ? "rgba(232,174,58,0.2)" : "rgba(250,245,233,0.06)",
          color: copied ? accent : "rgba(250,245,233,0.55)",
          transition: "background 300ms ease, color 300ms ease"
        }}>
        {/* copy glyph */}
        <svg
          width="11" height="11" viewBox="0 0 14 14" fill="none"
          className="absolute"
          style={{
            opacity: copied ? 0 : 1,
            transform: copied ? "scale(0.5) rotate(-12deg)" : "scale(1) rotate(0)",
            transition: "all 280ms cubic-bezier(0.34,1.56,0.64,1)"
          }}>
          <rect x="4.5" y="4.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
          <path d="M9.5 4.5V3.2A1.2 1.2 0 008.3 2H3.2A1.2 1.2 0 002 3.2v5.1A1.2 1.2 0 003.2 9.5h1.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {/* check glyph */}
        <svg
          width="12" height="12" viewBox="0 0 14 14" fill="none"
          className="absolute"
          style={{
            opacity: copied ? 1 : 0,
            transform: copied ? "scale(1) rotate(0)" : "scale(0.5) rotate(12deg)",
            transition: "all 280ms cubic-bezier(0.34,1.56,0.64,1)"
          }}>
          <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  )
}
