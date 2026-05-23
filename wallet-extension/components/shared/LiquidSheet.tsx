/**
 * LiquidSheet.tsx
 *
 * Shared "Apple iOS liquid glass" bottom sheet primitive used by every
 * action modal in the wallet (Send / Receive / Mask / UnMask / NoidSend).
 *
 * Props added:
 *   defaultFullscreen — open already in fullscreen mode (synced when prop changes)
 *   lockDrag          — completely kills ALL drag / dismiss interaction on the
 *                       grab handle (pointer-events none). The close × button
 *                       remains visible and functional unless disableDrag is
 *                       also true.
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
  /**
   * Disables every dismissal path (backdrop, close button, drag-down).
   * Used during in-flight operations so the user can't abort.
   */
  disableDrag?: boolean
  /**
   * Kills ALL pointer interaction on the grab handle (no drag, no bounce,
   * no dismiss via handle). The close × button remains unless disableDrag
   * is also true. Backdrop click still closes unless disableDrag is set.
   */
  lockDrag?: boolean
  /** Open the sheet already in fullscreen mode. Synced on prop change. */
  defaultFullscreen?: boolean
  /** Optional extra accent overlay color stop (rgba). Used by Mask/UnMask. */
  accent?: string
  children: React.ReactNode
}

const DRAG_DISMISS_PX   = 90
const DRAG_FULLSCREEN_PX = 60
const FLICK_VELOCITY    = 0.6  // px/ms
const RUBBER_BAND       = 0.35
const TRANSITION        = "cubic-bezier(0.22, 1, 0.36, 1)"

export default function LiquidSheet({
  open,
  onClose,
  tone             = "cream",
  disableDrag      = false,
  lockDrag         = false,
  defaultFullscreen = false,
  accent,
  children
}: LiquidSheetProps) {
  const [mounted,    setMounted]    = useState(false)
  const [visible,    setVisible]    = useState(false)
  const [fullscreen, setFullscreen] = useState(defaultFullscreen)

  // live drag state
  const [dragY,    setDragY]    = useState(0)
  const [dragging, setDragging] = useState(false)
  const dragStartY            = useRef(0)
  const lastY                 = useRef(0)
  const lastT                 = useRef(0)
  const fullscreenAtDragStart = useRef(false)
  // Always-current ref so drag callbacks can read latest defaultFullscreen
  const defaultFullscreenRef  = useRef(defaultFullscreen)
  useEffect(() => { defaultFullscreenRef.current = defaultFullscreen }, [defaultFullscreen])

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
        setFullscreen(defaultFullscreen)
        setDragY(0)
      }, 320)
      return () => clearTimeout(t)
    }
  }, [open, mounted])

  // Sync fullscreen when prop changes (e.g. form→success collapses sheet)
  useEffect(() => {
    setFullscreen(defaultFullscreen)
  }, [defaultFullscreen])

  // ── ESC dismiss ────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !disableDrag && !lockDrag) onClose()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [open, onClose, disableDrag, lockDrag])

  // ── drag handlers (only attached to the grabber area) ──────────────
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disableDrag || lockDrag) return
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(true)
      dragStartY.current = e.clientY
      lastY.current      = e.clientY
      lastT.current      = e.timeStamp
      fullscreenAtDragStart.current = fullscreen
      setDragY(0)
    },
    [disableDrag, lockDrag, fullscreen]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      const raw = e.clientY - dragStartY.current
      let next  = raw
      // Rubber-band upward drags:
      //   • always when started from fullscreen (already at top)
      //   • also when started from partial but fullscreen is locked out
      //     (defaultFullscreen=false, i.e. success screen) — can't go up
      if (raw < 0) {
        const startedFull = fullscreenAtDragStart.current
        const canGoFull   = defaultFullscreenRef.current
        if (startedFull || !canGoFull) next = raw * RUBBER_BAND
      }
      setDragY(next)
      lastY.current = e.clientY
      lastT.current = e.timeStamp
    },
    [dragging]
  )

  const onPointerUp = useCallback(
    (e?: React.PointerEvent) => {
      if (!dragging) return
      setDragging(false)

      // If called from lostpointercapture (no event / pointer left window),
      // just snap back — no velocity, no commit.
      if (!e) { setDragY(0); return }

      const totalDy  = e.clientY - dragStartY.current
      const dt       = Math.max(1, e.timeStamp - lastT.current)
      const velocity = (e.clientY - lastY.current) / dt
      const flickDown = velocity > FLICK_VELOCITY
      const flickUp   = velocity < -FLICK_VELOCITY
      const startedFull = fullscreenAtDragStart.current

      if (startedFull) {
        if (totalDy > DRAG_DISMISS_PX || flickDown) setFullscreen(false)
        setDragY(0)
        return
      }
      if (totalDy > DRAG_DISMISS_PX || flickDown) { setDragY(0); onClose(); return }
      // Only allow snapping to fullscreen if this sheet is supposed to be fullscreenable
      if ((totalDy < -DRAG_FULLSCREEN_PX || flickUp) && defaultFullscreenRef.current) {
        setFullscreen(true); setDragY(0); return
      }
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

  const tailColor    = isInk ? "rgb(15,13,12)" : "rgb(234,213,167)"
  const handleColor  = isInk ? "rgba(251,241,217,0.30)" : "rgba(23,19,17,0.22)"
  const closeBg      = isInk ? "rgba(251,241,217,0.08)" : "rgba(23,19,17,0.06)"
  const closeBorder  = isInk ? "rgba(251,241,217,0.14)" : "rgba(23,19,17,0.12)"
  const closeStroke  = isInk ? "rgba(251,241,217,0.7)"  : "rgba(23,19,17,0.7)"

  const baseSlide    = visible ? 0 : (window.innerHeight || 800)
  const liveTranslate = baseSlide + dragY
  const transition   = dragging
    ? "none"
    : `transform 380ms ${TRANSITION}, border-radius 320ms ${TRANSITION}, top 380ms ${TRANSITION}`

  const radius = fullscreen ? 0 : 28

  if (!mounted) return null

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[2147483000] flex items-end justify-center overflow-hidden">
        {/* backdrop */}
        <button
          aria-label="Close"
          onClick={() => { if (!disableDrag && !lockDrag) onClose() }}
          tabIndex={-1}
          className={`absolute inset-0 transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
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
            position: fullscreen ? "absolute" : "relative",
            top:    fullscreen ? 0 : "auto",
            left:   0,
            right:  0,
            bottom: 0,
            height: fullscreen ? "100%" : "auto",
            transform: `translateY(${liveTranslate}px)`,
            transition,
            willChange: "transform"
          }}
        >
          {/* Tail — sits below the sheet inside the same translateY transform
              so it slides away with the sheet on close. Matches the bottom-edge
              color of the gradient exactly so there's no visible seam. */}
          <div
            className="pointer-events-none absolute left-0 right-0"
            style={{
              top: "100%",
              height: 300,
              background: tailColor,
              backdropFilter: "blur(28px) saturate(140%)",
              WebkitBackdropFilter: "blur(28px) saturate(140%)",
            }}
          />

          <div
            className="relative border border-b-0 overflow-hidden flex flex-col"
            style={{
              ...surfaceStyle,
              borderTopLeftRadius:     radius,
              borderTopRightRadius:    radius,
              borderBottomLeftRadius:  0,
              borderBottomRightRadius: 0,
              height:    fullscreen ? "100%" : "auto",
              maxHeight: fullscreen ? "100%" : "88vh",
            }}
          >
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

            {/* grab handle */}
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onLostPointerCapture={() => onPointerUp()}
              className="relative shrink-0 pt-2 pb-2"
              style={{
                touchAction: "none",
                cursor: (disableDrag || lockDrag) ? "default" : dragging ? "grabbing" : "grab",
                pointerEvents: lockDrag ? "none" : undefined
              }}
            >
              <div className="flex justify-center">
                <span
                  className="block h-1 w-10 rounded-full transition-colors"
                  style={{ background: handleColor }}
                />
              </div>
            </div>

            {/* close button — hidden only when disableDrag (busy/in-flight) */}
            {!disableDrag && (
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute top-3 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border transition-colors"
                style={{ background: closeBg, borderColor: closeBorder }}
              >
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
              style={{ maxHeight: fullscreen ? "100%" : undefined }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}