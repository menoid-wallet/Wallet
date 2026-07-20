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
 * The page: sky, weather, header, and a scrollable content column.
 *
 * The banks are absolute to the page, not fixed to the viewport. Fixed reads
 * better only until the panel is taller than the window — then the bank is
 * pinned across the bottom of the screen and the panel scrolls straight
 * underneath it, which puts the primary button behind a cloud. Absolute makes
 * the clouds the *end of the sky*, and `.clear-clouds` on the content column
 * keeps the copy off them.
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
    <div className="relative isolate min-h-screen w-full overflow-x-hidden font-body">
      <Sky />
      <CloudDefs />
      <CloudBank layer="far" className="left-0 top-0 z-[1]" />
      <CloudBank layer="near" className="bottom-0 left-0 z-[1] opacity-90" />

      <header className="relative z-30 mx-auto flex max-w-[1100px] items-center justify-between gap-4 px-6 py-5 sm:px-10">
        {onBack ? (
          <button
            onClick={onBack}
            className="group flex items-center gap-2 font-round text-[13px] font-medium text-white/70 transition-colors hover:text-white">
            <svg width="18" height="9" viewBox="0 0 18 9" fill="none" className="transition-transform group-hover:-translate-x-0.5">
              <path d="M18 4.5H2M2 4.5L5.5 1M2 4.5L5.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            {backLabel}
          </button>
        ) : (
          <span />
        )}

        <CloudChip className="gap-2 px-3.5 py-1.5">
          <AnimatedLogo className="h-7 w-7 shrink-0" gaze={gaze} />
          <MenoidWordmark tone="violet" className="h-[13px] w-auto" />
        </CloudChip>

        {steps && step ? (
          // The sky's top-right corner is its brightest point, so plain white
          // pips vanish into it — the shadow is what makes them readable there.
          <div
            className="flex items-center gap-1.5"
            style={{ filter: "drop-shadow(0 1px 3px rgba(48,26,96,0.55))" }}>
            {steps.map((s) => {
              const done = steps.indexOf(s) < steps.indexOf(step)
              return (
                <span
                  key={s}
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    s === step ? "w-6 bg-white" : done ? "w-3 bg-white/70" : "w-3 bg-white/35"
                  }`}
                />
              )
            })}
          </div>
        ) : (
          <span />
        )}
      </header>

      <main className="clear-clouds relative z-20 mx-auto w-full max-w-[560px] px-6 pt-2 sm:px-8">
        {children}
      </main>
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
    <p className="mb-2 font-round text-[11px] font-medium uppercase tracking-[0.32em] text-white/60">
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
  return <p className="mt-2 font-round text-[14px] leading-relaxed text-white/72">{children}</p>
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-2 block font-round text-[11px] font-medium uppercase tracking-[0.24em] text-white/60">
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
      <p className="font-round text-[12px] leading-relaxed text-white/78">{children}</p>
    </div>
  )
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null
  return (
    <p
      className="mt-2 font-round text-[12.5px]"
      style={{ color: "#FFD3DE", textShadow: "0 1px 6px rgba(70,20,50,0.35)" }}>
      {children}
    </p>
  )
}

/** A row of facts on the success screens. */
export function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-2xl px-4 py-3"
      style={{
        background: "rgba(255,255,255,0.11)",
        border: "1px solid rgba(255,255,255,0.20)"
      }}>
      <span className="font-round text-[11px] uppercase tracking-[0.22em] text-white/55">{label}</span>
      <span className="truncate font-mono text-[12px] text-white/85">{children}</span>
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
