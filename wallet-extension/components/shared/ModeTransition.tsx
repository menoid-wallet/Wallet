/**
 * ModeTransition.tsx
 *
 * Full-screen pirate "tide" transition played whenever the user switches
 * between Open and Noid mode. Three beats over ~1100ms:
 *
 *   1) FLOOD (0   – 550ms)  — water rises from below to cover the panel,
 *      two SVG wave paths slide horizontally so the surface looks alive;
 *      bubbles rise; a ship silhouette bobs on the crest.
 *   2) HOLD  (550 – 700ms)  — banner ("OPEN" / "NOID") flashes mid-screen.
 *   3) EBB   (700 – 1100ms) — water recedes downward, revealing the new
 *      mode underneath.
 *
 * Palette:
 *   - to "noid" → deep ocean indigo + gold rim (private waters)
 *   - to "open" → daylight teal + cream/gold rim (open seas)
 *
 * The whole component is `position: fixed inset-0 pointer-events-none` so
 * it never blocks input. Caller controls timing via `duration` and is
 * notified once via `onDone`.
 */

import React, { useEffect, useMemo, useState } from "react"

interface Props {
  to: "open" | "noid"
  onDone: () => void
  duration?: number
}

type Phase = "init" | "flood" | "hold" | "ebb"

export default function ModeTransition({ to, onDone, duration = 1100 }: Props) {
  const [phase, setPhase] = useState<Phase>("init")

  const tFlood = Math.round(duration * 0.5)
  const tHold = Math.round(duration * 0.14)
  const tEbb = duration - tFlood - tHold

  useEffect(() => {
    // commit "init" frame first (water below the screen) so the subsequent
    // flip to "flood" produces an actual transition
    const a = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase("flood"))
    })
    const b = setTimeout(() => setPhase("hold"), tFlood)
    const c = setTimeout(() => setPhase("ebb"), tFlood + tHold)
    const d = setTimeout(onDone, duration)
    return () => {
      cancelAnimationFrame(a)
      clearTimeout(b)
      clearTimeout(c)
      clearTimeout(d)
    }
  }, [duration, tFlood, tHold, onDone])

  const palette = useMemo(() => {
    if (to === "noid") {
      return {
        deep: "#0E1A2B",
        mid: "#152843",
        crest: "#2A4773",
        foam: "rgba(232,174,58,0.55)",
        rim: "#E8AE3A",
        label: "NOID",
        sub: "Private waters",
        text: "#FBF1D9"
      }
    }
    return {
      deep: "#0d6c6a",
      mid: "#129b8f",
      crest: "#43b8a8",
      foam: "rgba(251,241,217,0.65)",
      rim: "#FBF1D9",
      label: "OPEN",
      sub: "The open seas",
      text: "#FBF1D9"
    }
  }, [to])

  // bubbles — stable across the run
  const bubbles = useMemo(
    () =>
      Array.from({ length: 14 }).map(() => ({
        x: 6 + Math.random() * 88,
        size: 4 + Math.random() * 10,
        delay: Math.random() * 250,
        dur: 700 + Math.random() * 500,
        sway: (Math.random() - 0.5) * 30
      })),
    []
  )

  function wavePath(amp: number, freq: number, phaseShift: number, y: number) {
    const w = 1440
    const segs = 24
    let d = `M 0 ${(y + amp * Math.sin(phaseShift)).toFixed(1)} `
    for (let i = 1; i <= segs; i++) {
      const x = (w / segs) * i
      const yy =
        y + amp * Math.sin(phaseShift + (i / segs) * freq * Math.PI * 2)
      d += `L ${x.toFixed(1)} ${yy.toFixed(1)} `
    }
    d += `L ${w} 600 L 0 600 Z`
    return d
  }

  // translateY per phase
  let translateY = "110%"
  let transition = "none"
  if (phase === "flood") {
    translateY = "0%"
    transition = `transform ${tFlood}ms cubic-bezier(0.22,0.85,0.32,1)`
  } else if (phase === "hold") {
    translateY = "0%"
    transition = "none"
  } else if (phase === "ebb") {
    translateY = "110%"
    transition = `transform ${tEbb}ms cubic-bezier(0.55,0,0.78,0.4)`
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[200] overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          transform: `translateY(${translateY})`,
          transition
        }}>
        {/* gradient base */}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, ${palette.crest} 0%, ${palette.mid} 40%, ${palette.deep} 100%)`
          }}
        />

        {/* caustics */}
        <div
          className="absolute inset-0 opacity-25 mix-blend-soft-light"
          style={{
            backgroundImage: `radial-gradient(ellipse at 20% 20%, ${palette.foam}, transparent 55%), radial-gradient(ellipse at 80% 60%, ${palette.foam}, transparent 60%)`
          }}
        />

        {/* moving wave surface */}
        <svg
          className="absolute inset-x-0 top-0 w-full h-full"
          viewBox="0 0 1440 600"
          preserveAspectRatio="none">
          <g className="menoid-wave-back">
            <path d={wavePath(14, 2, 0, 70)} fill={palette.mid} opacity="0.75" />
          </g>
          <g className="menoid-wave-front">
            <path
              d={wavePath(10, 3, Math.PI / 2, 50)}
              fill={palette.crest}
              opacity="0.95"
            />
          </g>
          <path
            d={wavePath(6, 4, 0, 42)}
            fill="none"
            stroke={palette.foam}
            strokeWidth="1.2"
          />
        </svg>

        {/* ship silhouette */}
        <div className="menoid-ship absolute top-[10%] left-[58%] -translate-x-1/2">
          <ShipSilhouette color={palette.rim} />
        </div>

        {/* rising bubbles */}
        <div className="absolute inset-0">
          {bubbles.map((b, i) => (
            <span
              key={i}
              className="menoid-bubble absolute rounded-full"
              style={{
                left: `${b.x}%`,
                bottom: "0%",
                width: b.size,
                height: b.size,
                background:
                  "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.95), rgba(255,255,255,0.25) 50%, rgba(255,255,255,0) 70%)",
                border: "1px solid rgba(255,255,255,0.45)",
                animationDelay: `${b.delay}ms`,
                animationDuration: `${b.dur}ms`,
                ["--sway" as any]: `${b.sway}px`
              }}
            />
          ))}
        </div>

        {/* mode banner */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
            phase === "hold" ? "opacity-100" : "opacity-0"
          }`}>
          <div className="flex flex-col items-center text-center px-6">
            <div
              className="flex items-center gap-3 px-5 py-2 rounded-full border"
              style={{
                borderColor: `${palette.rim}66`,
                background: "rgba(0,0,0,0.18)"
              }}>
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: palette.rim }}
              />
              <span
                className="font-display text-[10px] tracking-[0.5em] uppercase"
                style={{ color: palette.text }}>
                Entering
              </span>
            </div>
            <h2
              className="mt-4 font-display font-bold tracking-[-0.03em]"
              style={{
                color: palette.text,
                fontSize: 48,
                textShadow: `0 4px 24px ${palette.deep}`
              }}>
              {palette.label}
            </h2>
            <p
              className="mt-1 font-serif italic text-[13px]"
              style={{ color: `${palette.text}cc` }}>
              {palette.sub}
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes menoid-wave-slide-back {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-220px); }
        }
        @keyframes menoid-wave-slide-front {
          0%   { transform: translateX(-120px); }
          100% { transform: translateX(40px); }
        }
        .menoid-wave-back {
          animation: menoid-wave-slide-back 1.6s linear infinite;
        }
        .menoid-wave-front {
          animation: menoid-wave-slide-front 1.1s linear infinite;
        }
        @keyframes menoid-bubble-up {
          0%   { transform: translate(0, 0) scale(0.7); opacity: 0; }
          15%  { opacity: 1; }
          100% { transform: translate(var(--sway, 0px), -110vh) scale(1); opacity: 0; }
        }
        .menoid-bubble {
          animation-name: menoid-bubble-up;
          animation-timing-function: cubic-bezier(0.22, 0.85, 0.4, 1);
          animation-fill-mode: forwards;
          animation-iteration-count: 1;
        }
        @keyframes menoid-ship-bob {
          0%, 100% { transform: translate(-50%, 0) rotate(-3deg); }
          50%      { transform: translate(-50%, -6px) rotate(2deg); }
        }
        .menoid-ship {
          animation: menoid-ship-bob 1.1s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}

function ShipSilhouette({ color }: { color: string }) {
  return (
    <svg width="78" height="58" viewBox="0 0 78 58" fill="none">
      <line
        x1="39"
        y1="4"
        x2="39"
        y2="38"
        stroke={color}
        strokeOpacity="0.95"
        strokeWidth="1.2"
      />
      <path d="M39 8 L60 22 L39 30 Z" fill={color} opacity="0.95" />
      <path d="M39 12 L22 26 L39 32 Z" fill={color} opacity="0.75" />
      <path d="M39 4 L46 6 L39 9 Z" fill={color} />
      <path
        d="M14 38 Q39 48 64 38 L60 46 Q39 54 18 46 Z"
        fill={color}
        opacity="0.95"
      />
    </svg>
  )
}