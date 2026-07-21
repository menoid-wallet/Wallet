/**
 * Rain.tsx
 *
 * Noid mode's weather. Ported from website/src/components/Rain.tsx and scaled
 * down: the site rains over a section thousands of pixels tall, this rains
 * inside a 360x600 popup, so the drop counts come down by roughly 4x or the
 * surface turns into static.
 *
 * Two layers is what sells the depth. `far` sits behind the content — thin,
 * dim, slow, and partly masked by whatever is laid over it. `near` sits in
 * front of everything, brighter and blurred, so a few drops pass between the
 * user and the UI.
 *
 * Drops are seeded from a fixed number rather than Math.random: a remount (and
 * every mode switch is one) would otherwise reshuffle the whole field, which
 * reads as a glitch rather than as rain.
 *
 * The animation itself lives in style.css (`.rain-drop`) — one keyframe shared
 * by every drop, so the compositor animates transforms and nothing here
 * re-renders per frame.
 */

import React from "react"

/* mulberry32 — small, fast, deterministic */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Drop = {
  left: number
  top: number
  len: number
  width: number
  opacity: number
  duration: number
  delay: number
}

/* Tops are spread over the whole surface and each drop falls further than the
   gap to the next, so there is no band where the rain thins out. Negative
   delays start the field mid-flight — otherwise the first second after every
   mode switch is visibly empty sky. */
function makeDrops(count: number, seed: number, near: boolean): Drop[] {
  const rnd = seeded(seed)
  return Array.from({ length: count }, () => {
    const speed = rnd()
    return {
      left: rnd() * 100,
      top: rnd() * 100,
      len: near ? 20 + speed * 30 : 11 + speed * 20,
      width: near ? 1.5 : 1,
      opacity: near ? 0.22 + speed * 0.26 : 0.1 + speed * 0.2,
      duration: near ? 0.62 + (1 - speed) * 0.5 : 0.95 + (1 - speed) * 0.9,
      delay: rnd() * -2.4
    }
  })
}

const FAR = makeDrops(34, 20260721, false)
const NEAR = makeDrops(11, 987654321, true)

function Layer({ drops, className }: { drops: Drop[]; className: string }) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden>
      {drops.map((d, i) => (
        <span
          key={i}
          className="rain-drop"
          style={{
            left: `${d.left}%`,
            top: `${d.top}%`,
            height: d.len,
            width: d.width,
            opacity: d.opacity,
            animationDuration: `${d.duration}s`,
            animationDelay: `${d.delay}s`
          }}
        />
      ))}
    </div>
  )
}

/** The back curtain — goes with the sky, under the content. */
export function RainFar({ className = "" }: { className?: string }) {
  return <Layer drops={FAR} className={className} />
}

/**
 * The front curtain — goes over everything, blurred, so a handful of drops
 * pass between the user and the UI. Blurred and few: sharp drops in front of
 * type make the type look out of focus instead.
 */
export function RainNear({ className = "" }: { className?: string }) {
  return <Layer drops={NEAR} className={`blur-[1.1px] ${className}`} />
}

/**
 * The whole storm behind the content: rain, and the occasional flash across
 * the top of the sky. Drop it next to <Sky /> inside a `relative isolate`
 * parent.
 */
export default function Storm({ className = "" }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      {/* the flash sits at the top, where the sky's bloom already is, so the
          light has somewhere to have come from */}
      <div
        className="storm-flash absolute inset-x-0 top-0 h-[45%]"
        style={{
          background:
            "linear-gradient(180deg, rgba(226,214,255,0.85) 0%, rgba(190,166,250,0.28) 45%, transparent 100%)"
        }}
      />
      <RainFar />
    </div>
  )
}
