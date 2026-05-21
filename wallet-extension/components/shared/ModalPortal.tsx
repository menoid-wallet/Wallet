/**
 * ModalPortal.tsx
 *
 * Renders children into document.body via createPortal.
 *
 * Why this is needed:
 *   The WalletHome root has `overflow-hidden` and applies `transform`
 *   on its descendants. Either of those creates a containing block for
 *   `position: fixed`, which means a fixed-positioned modal rendered
 *   inside that subtree gets clipped by the root rather than covering
 *   the viewport. Portalling out of the subtree avoids that entirely
 *   — the modal lives directly under <body>, so `position: fixed` is
 *   relative to the viewport and stacks above the popup chrome.
 *
 * SSR / chrome-extension caveat: createPortal needs a real DOM. In
 * the popup/sidepanel/welcome pages we always have one, but we still
 * guard with a typeof check so this can't blow up during any
 * pre-render path.
 */

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

interface Props {
  children: React.ReactNode
}

export default function ModalPortal({ children }: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  if (!mounted) return null
  if (typeof document === "undefined") return null
  return createPortal(children, document.body)
}