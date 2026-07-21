/**
 * ComingSoonToast.tsx
 *
 * Floating pill toast. Uses ModalPortal so it renders directly under
 * <body> — escaping the scroll container of WalletHome — and stays
 * pinned to the bottom of the popup at all times.
 */

import React, { useEffect, useState } from "react"
import ModalPortal from "./ModalPortal"

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
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (!show) return
    setMounted(true)
    // tiny delay so the enter animation runs
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    const hideAt = setTimeout(() => setVisible(false), 2000)
    const cleanAt = setTimeout(() => { setMounted(false); onDone() }, 2400)
    return () => { clearTimeout(hideAt); clearTimeout(cleanAt) }
  }, [show, onDone])

  if (!mounted) return null

  return (
    <ModalPortal>
      {/* Fixed to bottom of the viewport (= bottom of the 360px popup) */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[9999] flex justify-center pb-20 px-4">
        <div className={`pointer-events-auto inline-flex items-center gap-2.5 rounded-full bg-violetDeep text-white pl-2 pr-4 py-1.5 shadow-[0_18px_36px_-18px_rgba(78,47,142,0.7)] transition-all duration-300 ${
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"
        }`}>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-goldDeep/25">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="2.4" r="1.2" className="gold-stroke" strokeWidth="1" />
              <path d="M6 3.6V10M3 6.5h6M2 8.5a4 4 0 008 0" className="gold-stroke" strokeWidth="1" strokeLinecap="round" fill="none" />
            </svg>
          </span>
          <span className="font-round italic text-[12px]">{message}</span>
        </div>
      </div>
    </ModalPortal>
  )
}