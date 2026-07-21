/**
 * SetupUI.tsx
 *
 * The pieces the full-page onboarding surfaces are built from — welcome,
 * create-wallet, import-wallet. All of them are the same sky as the lock
 * screen, opened out to a browser tab: cloud banks top and bottom, a glass
 * panel floating in the middle, white copy throughout.
 *
 * These are presentation only. None of them touch wallet state.
 */

import React, { useEffect, useState } from "react"
import AnimatedLogo, { type GazePoint } from "./AnimatedLogo"
import MenoidWordmark from "./MenoidWordmark"
import CloudChip from "./CloudChip"
import Sky from "./Sky"
import { CloudBank, CloudDefs } from "./Clouds"

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)"

/* ───────────────────────────── shell ───────────────────────────── */

/**
 * The page: sky, weather, header, and a content column.
 *
 * The whole thing is exactly one viewport tall and never scrolls as a page —
 * the cloud floor belongs at the bottom of the *view*, not at the bottom of a
 * document you have to go looking for. Anything taller than the sky scrolls
 * inside <main> instead, and `.clear-clouds-low` reserves the bank's height at
 * the end of that scroll so the primary button is never left underneath a
 * cloud (which is exactly what a page-length scroll under a pinned bank does).
 *
 * The floor runs at `height="low"` here: a full-height bank is ~16% of the
 * viewport width, which on a laptop leaves a four-step panel standing in a
 * strip of sky too short to hold it.
 *
 * The mark sits in the top-left corner with the back button, not centred over
 * the panel — centred it reads as a title above the card and pushes everything
 * down; in the corner it is chrome, and the panel gets the middle of the sky.
 */
export function SetupShell({
  onBack,
  backLabel = "Back",
  steps,
  step,
  gaze,
  children
}: {
  onBack?: () => void
  backLabel?: string
  steps?: string[]
  step?: string
  gaze?: GazePoint | null
  children: React.ReactNode
}) {
  return (
    <div className="relative isolate flex h-screen w-full flex-col overflow-hidden font-body">
      <Sky />
      <CloudDefs />
      <CloudBank layer="far" className="left-0 top-0 z-[1]" />

      <header className="relative z-30 mx-auto flex w-full max-w-[1100px] shrink-0 items-center justify-between gap-4 px-6 py-5 sm:px-10">
        <div className="flex items-center gap-3">
          <CloudChip className="gap-2 px-3.5 py-1.5">
            <AnimatedLogo className="h-7 w-7 shrink-0" gaze={gaze} />
            <MenoidWordmark tone="violet" className="h-[13px] w-auto" />
          </CloudChip>

          {onBack && (
            <button
              onClick={onBack}
              className="group flex items-center gap-2 rounded-full py-1.5 pl-2.5 pr-3.5 font-round text-[13px] font-medium text-white/75 transition-colors hover:bg-white/16 hover:text-white"
              style={{ textShadow: "0 1px 5px rgba(48,26,96,0.45)" }}>
              <svg width="18" height="9" viewBox="0 0 18 9" fill="none" className="transition-transform group-hover:-translate-x-0.5">
                <path d="M18 4.5H2M2 4.5L5.5 1M2 4.5L5.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              {backLabel}
            </button>
          )}
        </div>

        {steps && step ? (
          // The sky's top-right corner is its brightest point. White-on-white
          // is the whole problem here, so the steps still to come are drawn in
          // violet rather than a fainter white — the contrast has to run the
          // other way for them to exist at all. The shadow keeps the white ones
          // off the bloom.
          <div
            className="flex items-center gap-1.5"
            style={{ filter: "drop-shadow(0 1px 3px rgba(48,26,96,0.5))" }}>
            {steps.map((s) => {
              const done = steps.indexOf(s) < steps.indexOf(step)
              const current = s === step
              return (
                <span
                  key={s}
                  className={`h-1.5 rounded-full transition-all duration-500 ${current ? "w-6" : "w-3"}`}
                  style={{
                    background: current
                      ? "#FFFFFF"
                      : done
                        ? "rgba(255,255,255,0.85)"
                        : "rgba(78,47,142,0.4)"
                  }}
                />
              )
            })}
          </div>
        ) : (
          <span />
        )}
      </header>

      <main className="no-scrollbar relative z-20 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* min-h-full + items-center: the panel rides the middle of the sky
            when it fits, and falls back to a normal top-aligned scroll when it
            doesn't. The clearance is padding on this box, so it is part of the
            scrollable run rather than a gap under it. */}
        <div className="clear-clouds-low mx-auto flex min-h-full w-full max-w-[560px] items-center px-6 pt-1 sm:px-8">
          <div className="w-full">{children}</div>
        </div>
      </main>

      <CloudBank layer="mid" height="low" className="bottom-0 left-0 z-[3]" />
      <CloudBank layer="near" height="low" className="bottom-0 left-0 z-[4]" />
    </div>
  )
}

/* ───────────────────────────── panels ───────────────────────────── */

/** The glass card everything sits on. */
export function Panel({
  children,
  className = ""
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-3xl p-6 sm:p-7 ${className}`}
      style={{
        background: "rgba(255,255,255,0.14)",
        border: "1px solid rgba(255,255,255,0.26)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.32), 0 24px 60px -30px rgba(38,20,80,0.7)"
      }}>
      {children}
    </div>
  )
}

export function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-2 font-round text-[11px] font-semibold uppercase tracking-[0.32em] text-white/72"
      style={{ textShadow: "0 1px 5px rgba(48,26,96,0.35)" }}>
      {children}
    </p>
  )
}

export function Title({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="font-round text-[27px] font-semibold leading-[1.15] text-white sm:text-[30px]"
      style={{ textShadow: "0 10px 26px rgba(48,26,96,0.35)" }}>
      {children}
    </h2>
  )
}

export function Lede({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mt-2 font-round text-[14px] leading-relaxed text-white/82"
      style={{ textShadow: "0 1px 6px rgba(48,26,96,0.3)" }}>
      {children}
    </p>
  )
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-2 block font-round text-[11px] font-semibold uppercase tracking-[0.24em] text-white/72">
      {children}
    </label>
  )
}

/* ───────────────────────────── controls ───────────────────────────── */

const fieldStyle = (invalid?: boolean): React.CSSProperties => ({
  background: "rgba(255,255,255,0.14)",
  border: `1px solid ${invalid ? "rgba(255,190,205,0.55)" : "rgba(255,255,255,0.26)"}`,
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28)",
  transition: `border-color 240ms ${EASE_OUT}`
})

export function Field({
  invalid,
  className = "",
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      style={fieldStyle(invalid)}
      className={`w-full rounded-2xl px-4 py-3 font-round text-[14px] text-white caret-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30 ${className}`}
    />
  )
}

export function TextArea({
  invalid,
  className = "",
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...rest}
      style={fieldStyle(invalid)}
      className={`w-full resize-none rounded-2xl px-4 py-3 font-mono text-[14px] leading-relaxed text-white caret-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30 ${className}`}
    />
  )
}

/** The primary action: a white cloud with violet type. */
export function CloudButton({
  children,
  onClick,
  disabled,
  full = true,
  className = ""
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  full?: boolean
  className?: string
}) {
  return (
    <CloudChip
      as="button"
      onClick={onClick}
      disabled={disabled}
      className={`${full ? "w-full" : ""} px-6 py-3 transition-transform duration-300 active:scale-[0.98] ${className}`}>
      <span className="flex items-center justify-center gap-2.5 font-round text-[15px] font-semibold text-[var(--violet-deep)]">
        {children}
      </span>
    </CloudChip>
  )
}

/** A quieter action — glass, not cloud, so it never competes with the primary. */
export function GhostButton({
  children,
  onClick,
  disabled,
  className = ""
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={fieldStyle()}
      className={`w-full rounded-2xl px-5 py-3 font-round text-[14px] font-semibold text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-45 ${className}`}>
      {children}
    </button>
  )
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`h-4 w-4 animate-spin rounded-full border-2 border-[rgba(78,47,142,0.25)] border-t-[var(--violet-deep)] ${className}`}
    />
  )
}

/* ───────────────────────────── messages ───────────────────────────── */

/** A caution — amber would fight the sky, so it is a warmer white instead. */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-2xl px-3.5 py-3"
      style={{
        background: "rgba(255,255,255,0.12)",
        border: "1px solid rgba(255,235,190,0.30)"
      }}>
      <span className="mt-[1px] shrink-0 text-[13px]" style={{ color: "#FFE9A8" }}>
        ⚠
      </span>
      <p className="font-round text-[12px] leading-relaxed text-white/88">{children}</p>
    </div>
  )
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null
  return (
    <p
      className="mt-2 font-round text-[12.5px] font-medium"
      style={{ color: "#FFC4D6", textShadow: "0 1px 7px rgba(70,20,50,0.55)" }}>
      {children}
    </p>
  )
}

/**
 * The password strength meter — four bars and a word.
 *
 * Shared rather than copy-pasted into both onboarding flows, because the one
 * thing it has to get right is legibility on the sky and that is easy to fix in
 * one place and forget in the other. The colours come from passwordStrength()
 * (see crypto/walletCrypto.ts); the shadow here is what stops a pale mint
 * "Very strong" dissolving into the bright corner of the gradient.
 */
export function StrengthMeter({
  score,
  label,
  color
}: {
  score: number
  label: string
  color: string
}) {
  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-1.5 flex-1 rounded-full transition-all duration-300"
            style={{
              backgroundColor: i < score ? color : "rgba(255,255,255,0.22)",
              boxShadow: i < score ? `0 0 10px -1px ${color}` : "none"
            }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="font-round text-[11px] font-medium uppercase tracking-[0.2em] text-white/60">
          Strength
        </span>
        <span
          className="font-round text-[12.5px] font-semibold"
          style={{ color, textShadow: "0 1px 7px rgba(48,26,96,0.55)" }}>
          {label}
        </span>
      </div>
    </div>
  )
}

/** A row of facts on the success screens. */
export function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-2xl px-4 py-3"
      style={{
        background: "rgba(255,255,255,0.14)",
        border: "1px solid rgba(255,255,255,0.26)"
      }}>
      <span className="font-round text-[11px] font-semibold uppercase tracking-[0.22em] text-white/65">
        {label}
      </span>
      <span className="truncate font-mono text-[12px] font-medium text-white/95">{children}</span>
    </div>
  )
}

/* ─────────────────────────── gaze plumbing ───────────────────────────
   Same contract as the lock screen: the mark follows the cursor by itself,
   and whatever the user is typing into wins until the mouse moves again.
   ──────────────────────────────────────────────────────────────────── */

export function useGaze() {
  const [gaze, setGaze] = useState<GazePoint | null>(null)
  useEffect(() => {
    const release = () => setGaze(null)
    window.addEventListener("pointermove", release, { passive: true })
    return () => window.removeEventListener("pointermove", release)
  }, [])
  return { gaze, setGaze }
}
