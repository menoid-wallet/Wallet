/**
 * InlineCopyButton.tsx
 *
 * Tiny copy-to-clipboard chip that lives inside another clickable row (e.g. a
 * token bar). It stops click propagation so copying never triggers the row's
 * own onClick, and morphs the glyph copy → check on success. `fg` is the
 * foreground rgb (ink on the light page, bone on the dark page).
 */

import React, { useRef, useState } from "react"

export default function InlineCopyButton({ value, fg }: { value: string; fg: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!value) return
    navigator.clipboard.writeText(value)
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1200)
  }

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="Copy address"
      onClick={copy}
      className="inline-flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors"
      style={{
        background: copied ? "rgba(201,176,255,0.22)" : `rgba(${fg},0.06)`,
        border: `1px solid rgba(${fg},${copied ? 0.0 : 0.12})`,
        color: copied ? "#7B55C9" : `rgba(${fg},0.5)`
      }}>
      {copied ? (
        <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
          <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="9" height="9" viewBox="0 0 14 14" fill="none">
          <rect x="4.5" y="4.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9.5 4.5V3.2A1.2 1.2 0 008.3 2H3.2A1.2 1.2 0 002 3.2v5.1A1.2 1.2 0 003.2 9.5h1.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}
