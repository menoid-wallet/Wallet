/**
 * AnimatedLogo.tsx
 *
 * The Menoid mark, alive.
 *
 * The body is the flat artwork with no face (`menoid-logo-blank.png`); the
 * eyes and smile are drawn over it in SVG so they can move. Three things
 * happen to the eyes:
 *
 *   idle     — the double-blink from the site (CSS, `.logo-eye`)
 *   pointer  — while the cursor is anywhere over the extension, both eyes
 *              aim at it, each from its own socket so they converge on
 *              anything close
 *   caret    — while the user is typing, `gaze` overrides the pointer and
 *              the eyes follow the last character into the password field
 *
 * The tracking translate lives on a wrapper <g>, never on the eye itself:
 * put both on one element and the blink's scaleY and the aim's translate
 * fight over the same `transform` (this is the bug the standalone logo.html
 * prototype hit first).
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import blankLogo from "data-base64:~assets/menoid-logo-blank.png"

/* Eye sockets in the artwork's own 1024-unit space. The SVG overlay is
   stretched over the <img>, so these hold at any rendered size.
 *
 * The website's copy of this artwork sits in a 1024 frame with the mark only
 * filling the middle 53% — fine on a page where the logo is 300px across, but
 * in a 360px popup it leaves the mark looking like a stamp on an envelope. The
 * extension's asset is that frame cropped to its centre 576 units, so these
 * coordinates are the site's put through `(v - 224) * 16/9`. Recrop the png
 * and every number below has to move with it. */
const EYE_L = { x: 295.1, y: 323.6, w: 85.3, h: 177.8 }
const EYE_R = { x: 641.8, y: 323.6, w: 85.3, h: 177.8 }
const EYE_R_RADIUS = 42.7
const eyeCentre = (e: typeof EYE_L) => ({ cx: e.x + e.w / 2, cy: e.y + e.h / 2 })

/* How far an eye may travel from its socket, in artwork units. Sideways has
   room to spare; downwards is capped well short of the smile, which starts at
   y≈517 — an eye that reaches it reads as a melting face, not a glance. */
const MAX_X = 66
const MAX_Y = 40

/* Distance (in screen px) at which the eyes are already at full deflection.
   Anything further away is the same look; anything nearer is proportional, so
   a cursor resting on the mark itself gets a soft, short glance rather than a
   hard snap to the edge.
 *
 * Scaled to the popup, not to a page: the whole surface is 360x600, so the
 * password field is only ~90px below the eyes. At the site's 300 that lands at
 * a third of the travel and the glance downward barely registers — the one
 * look that matters most, because it is the one the user triggers by typing. */
const REACH = 180

export type GazePoint = { x: number; y: number }

/** Facial states used by the modals. Openness (sleep↔awake) is a springy CSS
 *  transition on the lid so the states morph rather than snap:
 *   idle     — the default neutral face (gentle blink + optional gaze tracking)
 *   sleeping — eyes shut, floating + snoring, "z z z" drifting up
 *   awake    — just woke: eyes pop open with a startle and a big happy smile
 *   waiting  — eyes open, scanning side-to-side (watching the voyage cloud)
 *   wink     — the "confirmed!" beat: eyes settle, one eye winks fast with a
 *              shine, a big grin — the other eye stays still                     */
export type LogoExpression = "idle" | "sleeping" | "awake" | "waiting" | "wink"

type Props = {
  className?: string
  style?: React.CSSProperties
  /** Viewport-space point to look at. Overrides the pointer while set. */
  gaze?: GazePoint | null
  /** Follow the mouse while it is over the extension. */
  trackPointer?: boolean
  /** ms for the eyes to reach a new target. */
  ease?: number
  /** Facial expression. Defaults to "idle" so existing call sites are unchanged. */
  expression?: LogoExpression
}

export default function AnimatedLogo({
  className,
  style,
  gaze = null,
  trackPointer = true,
  ease = 180,
  expression = "idle"
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [pointer, setPointer] = useState<GazePoint | null>(null)
  const [offsets, setOffsets] = useState({
    l: { x: 0, y: 0 },
    r: { x: 0, y: 0 }
  })

  // Pointer/gaze tracking only applies to the idle face; the other expressions
  // drive the eyes themselves (CSS scan, closed arcs).
  const tracking = trackPointer && expression === "idle"

  /* ── follow the cursor across the whole extension surface ── */
  useEffect(() => {
    if (!tracking) return
    const onMove = (e: PointerEvent) => setPointer({ x: e.clientX, y: e.clientY })
    // The popup is the whole window, so "left the extension" is the document's
    // own mouseleave — there is no larger surface to fall back to.
    const onLeave = () => setPointer(null)
    window.addEventListener("pointermove", onMove, { passive: true })
    document.addEventListener("mouseleave", onLeave)
    window.addEventListener("blur", onLeave)
    return () => {
      window.removeEventListener("pointermove", onMove)
      document.removeEventListener("mouseleave", onLeave)
      window.removeEventListener("blur", onLeave)
    }
  }, [tracking])

  /* ── aim ──
     Each eye is aimed independently from where it actually sits on screen,
     which is what makes them converge: for a target between them the two
     unit vectors point inwards, for one far off to the side they run
     parallel. Layout effect so a target that arrives with a re-render (a
     keystroke) is measured against the frame it will be painted in. */
  const target = tracking ? (gaze ?? pointer) : null
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || !target) {
      setOffsets({ l: { x: 0, y: 0 }, r: { x: 0, y: 0 } })
      return
    }
    const r = host.getBoundingClientRect()
    if (!r.width || !r.height) return

    const aim = (e: typeof EYE_L) => {
      const { cx, cy } = eyeCentre(e)
      const vx = r.left + (cx / 1024) * r.width
      const vy = r.top + (cy / 1024) * r.height
      const dx = target.x - vx
      const dy = target.y - vy
      const dist = Math.hypot(dx, dy)
      if (dist < 1) return { x: 0, y: 0 }
      const k = Math.min(1, dist / REACH)
      return { x: (dx / dist) * k * MAX_X, y: (dy / dist) * k * MAX_Y }
    }

    setOffsets({ l: aim(EYE_L), r: aim(EYE_R) })
  }, [target?.x, target?.y])

  const track = (o: { x: number; y: number }): React.CSSProperties => ({
    transform: `translate(${o.x}px, ${o.y}px)`,
    transition: `transform ${ease}ms cubic-bezier(0.22, 1, 0.36, 1)`
  })

  const isSleeping = expression === "sleeping"
  const isWaiting  = expression === "waiting"
  const isWink     = expression === "wink"
  const isAwake    = expression === "awake"
  const shut       = isSleeping                       // the lid only drops asleep
  const blinking   = isAwake || expression === "idle" // gentle shared blink

  // Each eye is three nested groups: aim (scan / gaze translate) → lid (openness,
  // a springy CSS transition so sleep↔wake morphs) → blink/wink (scaleY keyframe).
  const eye = (e: typeof EYE_L, blinkClass: string) => {
    const aim = isWaiting
      ? { className: "al-scan" }
      : { style: track(e === EYE_L ? offsets.l : offsets.r) }
    return (
      <g {...aim}>
        <g className="al-lid" style={{ transform: `scaleY(${shut ? 0.07 : 1})` }}>
          <g className={blinkClass}>
            <rect x={e.x - 2.7} y={e.y} width={e.w} height={e.h} rx={EYE_R_RADIUS} ry={EYE_R_RADIUS} fill="#ffffff" />
            <rect x={e.x} y={e.y} width={e.w} height={e.h} rx={EYE_R_RADIUS} ry={EYE_R_RADIUS} fill="url(#al-eye)" />
          </g>
        </g>
      </g>
    )
  }

  // On "confirmed", the viewer's-left eye winks fast; its partner holds perfectly
  // still (no blink). Both share the gentle blink when awake / idle.
  const leftBlink  = isWink ? "al-winkfast" : blinking ? "al-blink" : ""
  const rightBlink = isWink ? ""            : blinking ? "al-blink" : ""

  // A big happy grin when awake or confirmed; a small snore "o" asleep; the
  // regular smile otherwise.
  const mouth = isSleeping ? (
    <g className="al-snore">
      <ellipse cx="510" cy="548" rx="30" ry="23" fill="url(#al-smile)" />
      <ellipse cx="500" cy="540" rx="9" ry="6" fill="#ffffff" opacity="0.4" />
    </g>
  ) : (
    <g>
      <path d="M 446.2 520 Q 510.2 580.4 574.2 520" fill="none" stroke="#ffffff" strokeWidth="39.1" strokeLinecap="round" />
      <path d="M 446.2 517.3 Q 510.2 577.8 574.2 517.3" fill="none" stroke="url(#al-smile)" strokeWidth="39.1" strokeLinecap="round" />
    </g>
  )

  // The whole mark floats + snores asleep, and does a one-time startle pop on wake.
  const rootAnim = isSleeping ? "al-sleep-float" : isAwake ? "al-wake" : ""

  return (
    <div ref={hostRef} className={`relative ${className || ""} ${rootAnim}`} style={style}>
      <img
        src={blankLogo}
        alt="Menoid"
        draggable={false}
        className="block h-full w-full select-none"
      />

      <svg
        viewBox="0 0 1024 1024"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden>
        <defs>
          <linearGradient id="al-eye" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4d30af" />
            <stop offset="10%" stopColor="#7b5add" />
            <stop offset="30%" stopColor="#8260e4" />
            <stop offset="90%" stopColor="#7d58df" />
          </linearGradient>
          <linearGradient id="al-smile" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#704bbd" />
            <stop offset="100%" stopColor="#956ff1" />
          </linearGradient>
          <radialGradient id="al-glow">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="45%" stopColor="#E4D6FF" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#C9B0FF" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* success shine — a glare that flares behind the winking eye */}
        {isWink && <circle className="al-shine" cx="335" cy="395" r="120" fill="url(#al-glow)" />}

        {eye(EYE_L, leftBlink)}
        {eye(EYE_R, rightBlink)}

        {mouth}

        {/* wink twinkle — a sparkle popping by the winking eye */}
        {isWink && (
          <path className="al-twinkle" d="M0 -22 L6 -6 L22 0 L6 6 L0 22 L-6 6 L-22 0 L-6 -6 Z" fill="#E3D3FF" />
        )}

        {/* sleeping z's, drifting up-right of the head */}
        {isSleeping && (
          <g fill="url(#al-eye)" fontFamily="Fredoka, ui-rounded, system-ui" fontWeight="700">
            <text className="al-z" style={{ animationDelay: "0s" }}    x="690" y="300" fontSize="70">z</text>
            <text className="al-z" style={{ animationDelay: "0.55s" }} x="748" y="250" fontSize="52">z</text>
            <text className="al-z" style={{ animationDelay: "1.1s" }}  x="792" y="212" fontSize="38">z</text>
          </g>
        )}
      </svg>

      <style>{`
        @keyframes al-scan { 0%,100% { transform: translate(-34px, 16px); } 50% { transform: translate(34px, 16px); } }
        .al-scan { animation: al-scan 2.4s ease-in-out infinite; }

        /* lid openness — springy: waking pops the eyes open, dozing lowers them */
        .al-lid { transform-box: fill-box; transform-origin: center; transition: transform 480ms cubic-bezier(0.34, 1.64, 0.5, 1); }

        /* the website's exact double-blink (awake / idle) */
        @keyframes al-blink { 0%, 2%, 6%, 10%, 100% { transform: scaleY(1); } 4%, 8% { transform: scaleY(0.12); } }
        .al-blink { transform-box: fill-box; transform-origin: center; animation: al-blink 3s infinite; }

        /* one eye, a fast wink at the double-blink's snap speed, repeated */
        @keyframes al-winkfast { 0%, 20%, 26%, 100% { transform: scaleY(1); } 23% { transform: scaleY(0.08); } }
        .al-winkfast { transform-box: fill-box; transform-origin: center; animation: al-winkfast 2.2s cubic-bezier(0.4,0,0.3,1) 0.2s infinite; }

        /* asleep: float + snore-breathe */
        @keyframes al-sleep-float { 0%,100% { transform: translateY(0) rotate(-1.6deg); } 50% { transform: translateY(-5%) rotate(1.6deg); } }
        .al-sleep-float { animation: al-sleep-float 3.6s ease-in-out infinite; }
        @keyframes al-snore { 0%,100% { transform: scaleY(0.8); } 45% { transform: scaleY(1.2); } }
        .al-snore { transform-box: fill-box; transform-origin: center; animation: al-snore 3.6s ease-in-out infinite; }

        /* woke up: a one-time startle pop */
        @keyframes al-wake { 0% { transform: translateY(7%) scale(0.9); } 45% { transform: translateY(-5%) scale(1.08); } 72% { transform: translateY(1.5%) scale(0.98); } 100% { transform: none; } }
        .al-wake { animation: al-wake 640ms cubic-bezier(0.34,1.58,0.6,1) both; }

        /* success shine + twinkle, just after the eyes settle */
        @keyframes al-shine { 0%,16% { opacity: 0; transform: scale(0.2); } 42% { opacity: 0.85; transform: scale(1.1); } 100% { opacity: 0; transform: scale(1.55); } }
        .al-shine { transform-box: fill-box; transform-origin: center; animation: al-shine 1.6s ease-out 0.3s infinite; }
        @keyframes al-twinkle { 0%, 42%, 88%, 100% { opacity: 0; transform: translate(252px,300px) scale(0.3) rotate(-30deg); } 60% { opacity: 1; transform: translate(252px,300px) scale(1.25) rotate(0deg); } 74% { opacity: 0.85; transform: translate(252px,300px) scale(0.95) rotate(10deg); } }
        .al-twinkle { animation: al-twinkle 1.6s ease-out 0.28s infinite; }

        @keyframes al-z { 0% { opacity: 0; transform: translateY(8px) scale(0.85); } 25% { opacity: 0.95; } 100% { opacity: 0; transform: translateY(-26px) scale(1.15); } }
        .al-z { animation: al-z 2.6s ease-in-out infinite; }
      `}</style>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────
   caretPoint — where the last typed character is, in viewport coordinates.

   Measured with a mirror span carrying the input's own computed font, because
   the field is a password: the value is real characters but what is *drawn*
   is a run of bullets, so the text itself measures nothing like what the user
   sees. Rendering the same number of bullets in the same font gets the run's
   width to within a pixel or two, which is far finer than the eyes resolve.
   ──────────────────────────────────────────────────────────────────────── */

let mirror: HTMLSpanElement | null = null

function getMirror(): HTMLSpanElement {
  if (mirror && mirror.isConnected) return mirror
  mirror = document.createElement("span")
  mirror.setAttribute("aria-hidden", "true")
  Object.assign(mirror.style, {
    position: "absolute",
    top: "-9999px",
    left: "-9999px",
    whiteSpace: "pre",
    visibility: "hidden",
    pointerEvents: "none"
  } as CSSStyleDeclaration)
  document.body.appendChild(mirror)
  return mirror
}

export function caretPoint(input: HTMLInputElement | null): GazePoint | null {
  if (!input) return null
  const rect = input.getBoundingClientRect()
  if (!rect.width) return null

  const cs = getComputedStyle(input)
  const m = getMirror()
  m.style.font = cs.font || `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  m.style.letterSpacing = cs.letterSpacing

  const caret = input.selectionStart ?? input.value.length
  m.textContent =
    input.type === "password" ? "•".repeat(caret) : input.value.slice(0, caret)

  const padL = parseFloat(cs.paddingLeft) || 0
  const padR = parseFloat(cs.paddingRight) || 0
  // Clamp inside the field: once the text overflows, the caret is pinned to
  // the right edge and the eyes should stop travelling with it.
  const run = Math.min(m.getBoundingClientRect().width, rect.width - padL - padR)

  return { x: rect.left + padL + run, y: rect.top + rect.height / 2 }
}

