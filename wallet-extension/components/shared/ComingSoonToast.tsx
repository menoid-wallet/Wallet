/**
 * ComingSoonToast.tsx
 *
 * Tiny floating "coming soon" pill used by both modes for the Swap action.
 * Auto-dismisses after ~2.4s. Themed to match — gold pill, parchment text.
 */

import React, { useEffect, useState } from "react"

interface Props {
  show: boolean
  onDone: () => void
  message?: string
}

export default function ComingSoonToast({
  show,
  onDone,
  message = "Swap is on the horizon. Coming soon."
}: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!show) return
    setVisible(true)
    const hideAt = setTimeout(() => setVisible(false), 2000)
    const cleanupAt = setTimeout(onDone, 2400)
    return () => {
      clearTimeout(hideAt)
      clearTimeout(cleanupAt)
    }
  }, [show, onDone])

  if (!show) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[120] flex justify-center px-4">
      <div
        className={`pointer-events-auto inline-flex items-center gap-2.5 rounded-full bg-ink text-bone pl-2 pr-4 py-1.5 shadow-[0_18px_36px_-18px_rgba(23,19,17,0.7)] transition-all duration-300 ${
          visible
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-3 pointer-events-none"
        }`}>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-goldDeep/25">
          {/* anchor glyph */}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="2.4" r="1.2" stroke="#E8AE3A" strokeWidth="1" />
            <path
              d="M6 3.6V10M3 6.5h6M2 8.5a4 4 0 008 0"
              stroke="#E8AE3A"
              strokeWidth="1"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </span>
        <span className="font-serif italic text-[12px]">{message}</span>
      </div>
    </div>
  )
}