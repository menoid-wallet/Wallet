/**
 * LiquidSheet.tsx
 *
 * Shared "Apple iOS liquid glass" bottom sheet primitive used by every
 * action modal in the wallet (Send / Receive / Mask / UnMask / NoidSend).
 *
 * What this owns:
 *   - Portal + dim/blur backdrop (tap to dismiss when allowed)
 *   - Sheet shell with rounded top, liquid-glass surface, paper grain,
 *     and gold/ink decorative orbs picked by `tone`
 *   - Grab handle at the top with full pointer-driven drag gestures:
 *
 *       • Partial mode  : drag UP   past −60px → snap to fullscreen
 *                         drag DOWN past +90px → dismiss (calls onClose)
 *       • Fullscreen    : drag DOWN past +90px → snap back to partial
 *
 *     Velocity is also factored in — a quick flick commits even if the
 *     pixel threshold wasn't reached. While dragging the sheet follows
 *     the finger 1:1, with a rubber-band beyond limits.
 *
 *   - Close button (top-right). Hidden when `disableDrag` is true so
 *     in-flight operations (e.g. ZK proof generation) can't be aborted.
 *
 * What this does NOT touch:
 *   - Any modal's business logic / state machine. Each modal mounts its
 *     existing form/voyage/slider components as children — this just
 *     replaces the chrome.
 *
 * Notes on the popup viewport:
 *   The extension popup is a fixed 360×600 surface. Fullscreen here
 *   means "fill the popup", not "fill the OS window" — we use 100%
 *   of the portal root rather than 100vh.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"
import ModalPortal from "./ModalPortal"

export type SheetTone = "cream" | "ink"

interface LiquidSheetProps {
  open: boolean
  onClose: () => void
  /** "cream" → light parchment glass; "ink" → dark luxury glass */
  tone?: SheetTone
  /** Disables every dismissal path (backdrop, close button, drag-down). */
  disableDrag?: boolean
  /** Optional extra accent overlay color stop (rgba). Used by Mask/UnMask. */
  accent?: string
  children: React.ReactNode
}

const DRAG_DISMISS_PX = 90
const DRAG_FULLSCREEN_PX = 60
const FLICK_VELOCITY = 0.6 // px/ms
const RUBBER_BAND = 0.35
const TRANSITION = "cubic-bezier(0.22, 1, 0.36, 1)"

export default function LiquidSheet({
  open,
  onClose,
  tone = "cream",
  disableDrag = false,
  accent,
  children
}: LiquidSheetProps) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  // live drag state
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const dragStartY = useRef(0)
  const dragStartT = useRef(0)
  const lastY = useRef(0)
  const lastT = useRef(0)
  const fullscreenAtDragStart = useRef(false)

  // ── enter / exit lifecycle ──────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setMounted(true)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setVisible(true))
      )
    } else if (mounted) {
      setVisible(false)
      const t = setTimeout(() => {
        setMounted(false)
        setFullscreen(false)
        setDragY(0)
      }, 320)
      return () => clearTimeout(t)
    }
  }, [open, mounted])

  // ── ESC dismiss ────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !disableDrag) onClose()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [open, onClose, disableDrag])

  // ── drag handlers (only attached to the grabber area) ──────────────
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disableDrag) return
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(true)
      dragStartY.current = e.clientY
      dragStartT.current = e.timeStamp
      lastY.current = e.clientY
      lastT.current = e.timeStamp
      fullscreenAtDragStart.current = fullscreen
      setDragY(0)
    },
    [disableDrag, fullscreen]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      const raw = e.clientY - dragStartY.current
      let next = raw

      // Rubber-band: dragging UP past full (already at 0) is heavily
      // resisted; same for dragging DOWN past the partial baseline when
      // we're already at the very bottom.
      const startedFull = fullscreenAtDragStart.current
      if (startedFull && raw < 0) next = raw * RUBBER_BAND
      // Allow dragging up beyond the partial baseline to morph into full
      // (negative dragY); no resistance there.

      setDragY(next)
      lastY.current = e.clientY
      lastT.current = e.timeStamp
    },
    [dragging]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      setDragging(false)

      const totalDy = e.clientY - dragStartY.current
      const dt = Math.max(1, e.timeStamp - lastT.current)
      const velocity = (e.clientY - lastY.current) / dt // px / ms
      const flickDown = velocity > FLICK_VELOCITY
      const flickUp = velocity < -FLICK_VELOCITY

      const startedFull = fullscreenAtDragStart.current

      if (startedFull) {
        // From fullscreen: drag-down enough → collapse to partial.
        if (totalDy > DRAG_DISMISS_PX || flickDown) {
          setFullscreen(false)
        }
        setDragY(0)
        return
      }

      // From partial:
      if (totalDy > DRAG_DISMISS_PX || flickDown) {
        // dismiss
        setDragY(0)
        onClose()
        return
      }
      if (totalDy < -DRAG_FULLSCREEN_PX || flickUp) {
        setFullscreen(true)
        setDragY(0)
        return
      }
      // not enough → snap back
      setDragY(0)
    },
    [dragging, onClose]
  )

  // ── styling tokens ──────────────────────────────────────────────────
  const isInk = tone === "ink"

  const surfaceStyle = useMemo<React.CSSProperties>(() => {
    if (isInk) {
      return {
        background:
          "linear-gradient(165deg, rgba(26,21,16,0.92) 0%, rgba(23,19,17,0.92) 60%, rgba(17,15,14,0.94) 100%)",
        borderColor: "rgba(251,241,217,0.14)",
        boxShadow:
          "0 -30px 70px -18px rgba(0,0,0,0.7), inset 0 1px 0 rgba(251,241,217,0.06)",
        color: "rgba(251,241,217,0.92)",
        backdropFilter: "blur(28px) saturate(140%)",
        WebkitBackdropFilter: "blur(28px) saturate(140%)"
      }
    }
    return {
      background:
        "linear-gradient(165deg, rgba(251,241,217,0.78) 0%, rgba(244,231,204,0.82) 60%, rgba(234,213,167,0.86) 100%)",
      borderColor: "rgba(23,19,17,0.12)",
      boxShadow:
        "0 -30px 70px -18px rgba(92,58,33,0.35), inset 0 1px 0 rgba(255,255,255,0.65)",
      color: "#171311",
      backdropFilter: "blur(28px) saturate(140%)",
      WebkitBackdropFilter: "blur(28px) saturate(140%)"
    }
  }, [isInk])

  const handleColor = isInk ? "rgba(251,241,217,0.30)" : "rgba(23,19,17,0.22)"
  const closeBg = isInk ? "rgba(251,241,217,0.08)" : "rgba(23,19,17,0.06)"
  const closeBorder = isInk
    ? "rgba(251,241,217,0.14)"
    : "rgba(23,19,17,0.12)"
  const closeStroke = isInk ? "rgba(251,241,217,0.7)" : "rgba(23,19,17,0.7)"

  // Translate / radius math
  // Partial baseline: bottom-anchored, max-height 88% of portal.
  // Fullscreen: top: 0; bottom: 0 (we drive via flex parent).
  // We use translateY for the slide-in/out + drag; radius eases to 0 when full.
  const baseSlide = visible ? 0 : window.innerHeight || 800
  const liveTranslate = baseSlide + dragY
  const draggingActive = dragging
  const transition = draggingActive
    ? "none"
    : `transform 380ms ${TRANSITION}, border-radius 320ms ${TRANSITION}, top 380ms ${TRANSITION}`

  const radius = fullscreen
    ? Math.max(0, 28 - Math.max(0, -dragY) * 0.0) // already 0 when full
    : 28

  if (!mounted) return null

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[2147483000] flex items-end justify-center overflow-hidden">
        {/* backdrop */}
        <button
          aria-label="Close"
          onClick={() => {
            if (!disableDrag) onClose()
          }}
          tabIndex={-1}
          className={`absolute inset-0 transition-opacity duration-300 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
          style={{
            background: "rgba(23,19,17,0.45)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)"
          }}
        />

        {/* sheet shell */}
        <div
          className="relative w-full max-w-[420px] mx-auto"
          style={{
            // When fullscreen, the sheet wants to fill the popup. We do
            // that by giving the wrapper an absolute top of 0, which
            // overrides items-end positioning. The transform-based slide
            // continues to work either way.
            position: fullscreen ? "absolute" : "relative",
            top: fullscreen ? 0 : "auto",
            left: 0,
            right: 0,
            bottom: 0,
            height: fullscreen ? "100%" : "auto",
            transform: `translateY(${liveTranslate}px)`,
            transition,
            willChange: "transform"
          }}>
          <div
            className="relative border border-b-0 overflow-hidden flex flex-col"
            style={{
              ...surfaceStyle,
              borderTopLeftRadius: radius,
              borderTopRightRadius: radius,
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              height: fullscreen ? "100%" : "auto",
              maxHeight: fullscreen ? "100%" : "88vh"
            }}>
            {/* paper grain & accent overlays */}
            <div
              className="pointer-events-none absolute inset-0 paper-grain"
              style={{ opacity: isInk ? 0.18 : 0.28 }}
            />
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse at 50% -10%, rgba(232,174,58,0.30) 0%, transparent 55%)"
              }}
            />
            {accent && (
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background: `radial-gradient(ellipse at 50% 115%, ${accent} 0%, transparent 55%)`
                }}
              />
            )}

            {/* grab handle — pointer events attached here so the body
                stays scrollable in fullscreen mode. */}
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="relative shrink-0 pt-2 pb-2"
              style={{
                touchAction: "none",
                cursor: disableDrag
                  ? "default"
                  : dragging
                    ? "grabbing"
                    : "grab"
              }}>
              <div className="flex justify-center">
                <span
                  className="block h-1 w-10 rounded-full transition-colors"
                  style={{ background: handleColor }}
                />
              </div>
            </div>

            {/* close — hidden while drag-disabled (busy state) */}
            {!disableDrag && (
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute top-3 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border transition-colors"
                style={{
                  background: closeBg,
                  borderColor: closeBorder
                }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2 2L10 10M10 2L2 10"
                    stroke={closeStroke}
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}

            {/* scrollable content */}
            <div
              className="relative flex-1 overflow-y-auto no-scrollbar"
              style={{
                // When in partial mode we don't enforce a scroll context;
                // the content sizes itself. When full, the body becomes
                // the scrollable region.
                maxHeight: fullscreen ? "100%" : undefined
              }}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
