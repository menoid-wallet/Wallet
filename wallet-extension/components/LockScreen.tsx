/**
 * LockScreen.tsx — Menoid purple sky edition
 *
 * The wallet's front door, in the same weather as the marketing site: a lilac
 * sky with a printed grid, cloud banks drifting along the bottom, and the mark
 * floating over a cloud in the middle.
 *
 * The mark watches you. Its eyes follow the cursor anywhere over the popup,
 * and the moment you start typing they drop to the password field and track
 * the last character in. See components/brand/AnimatedLogo.tsx — the aim is
 * computed per eye from its own socket, which is what makes them converge.
 *
 * The liquid wordmark loader (components/brand/MenoidLoader.tsx) covers this
 * screen on mount and fades once the pour has settled, so the first thing the
 * user ever sees is the brand being poured.
 *
 * Unlock choreography:
 *   1. mount    — the mark drops in from above, the form rises under it
 *   2. floating — the mark bobs while the user types
 *   3. rising   — on success the mark climbs out through the top of the sky
 *   4. onUnlock — the popup hands over to <WalletHome />
 */

import React, { useEffect, useRef, useState } from "react"
import {
  decryptAll,
  migrateLegacyIfNeeded,
  readWalletsState,
  type WalletEntry
} from "../lib/wallets"
import type { StoredWallet } from "../crypto/walletCrypto"
import AnimatedLogo, { caretPoint, type GazePoint } from "./brand/AnimatedLogo"
import MenoidWordmark from "./brand/MenoidWordmark"
import MenoidLoader from "./brand/MenoidLoader"
import CloudChip from "./brand/CloudChip"
import Sky from "./brand/Sky"
import { CloudBank, CloudDefs } from "./brand/Clouds"

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)"
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)"
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)"

interface UnlockPayload {
  wallets: StoredWallet[]
  entries: WalletEntry[]
  active: number
  password: string
}

interface Props {
  onUnlock: (payload: UnlockPayload) => void
}

type Stage = "entering" | "floating" | "rising"

export default function LockScreen({ onUnlock }: Props) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [stage, setStage] = useState<Stage>("entering")
  const [contentMounted, setContentMounted] = useState(false)
  const [shake, setShake] = useState(0)
  const pendingPayload = useRef<UnlockPayload | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const fieldRef = useRef<HTMLDivElement | null>(null)

  /* A rejected password shakes the field. Driven by the Web Animations API
     rather than a keyed remount or a toggled class: remounting would blow away
     the input's focus just as the user needs to retype, and a class needs a
     cleanup pass before it can fire a second time. */
  useEffect(() => {
    if (!shake) return
    fieldRef.current?.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-6px)", offset: 0.2 },
        { transform: "translateX(5px)", offset: 0.4 },
        { transform: "translateX(-3px)", offset: 0.6 },
        { transform: "translateX(2px)", offset: 0.8 },
        { transform: "translateX(0)" }
      ],
      { duration: 420, easing: EASE_OUT }
    )
  }, [shake])

  /* Where the mark is looking. `null` hands control back to the cursor —
     AnimatedLogo tracks that itself, so clearing this on any mouse movement is
     all it takes for the pointer to win back the gaze after a keystroke. */
  const [gaze, setGaze] = useState<GazePoint | null>(null)
  useEffect(() => {
    const release = () => setGaze(null)
    window.addEventListener("pointermove", release, { passive: true })
    return () => window.removeEventListener("pointermove", release)
  }, [])

  const lookAtCaret = () => setGaze(caretPoint(inputRef.current))

  // Kick off the entry animation just after mount so the transition actually
  // plays (paint the initial transform first, or it *is* the final one).
  //
  // A timer, not requestAnimationFrame: rAF does not run while the surface
  // isn't being painted, and the failure mode is the whole screen frozen in
  // its entry pose — mark parked off the top edge, form at opacity 0, nothing
  // to click. A door has to open even if the compositor is asleep.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setStage("floating")
      setContentMounted(true)
    }, 24)
    return () => window.clearTimeout(t)
  }, [])

  async function handleUnlock() {
    if (!password) {
      setError("Enter your password.")
      setShake((n) => n + 1)
      return
    }
    setLoading(true)
    setError("")
    try {
      let state = await readWalletsState()
      if (!state) state = await migrateLegacyIfNeeded(password)
      if (!state) throw new Error("Wallet not found.")

      const wallets = await decryptAll(state, password)
      const payload: UnlockPayload = {
        wallets,
        entries: state.list,
        active: Math.min(state.active, wallets.length - 1),
        password
      }

      // Let the mark climb out of frame, then hand off to <WalletHome />.
      pendingPayload.current = payload
      setStage("rising")
    } catch (e: any) {
      setLoading(false)
      setShake((n) => n + 1)
      setError(
        e?.message === "Wrong password"
          ? "Wrong password. Try again."
          : (e?.message ?? "Decryption failed.")
      )
    }
  }

  // Once the mark has left the sky, commit the unlock.
  function handleMarkTransitionEnd(e: React.TransitionEvent) {
    if (stage === "rising" && e.propertyName === "transform" && pendingPayload.current) {
      const payload = pendingPayload.current
      pendingPayload.current = null
      onUnlock(payload)
    }
  }

  const markTransform =
    stage === "entering"
      ? "translateY(-150%) scale(0.7)"
      : stage === "rising"
        ? "translateY(-260%) scale(0.55)"
        : "translateY(0) scale(1)"

  const markTransition =
    stage === "entering"
      ? `transform 1000ms ${SPRING}`
      : stage === "rising"
        ? `transform 850ms ${EASE}, opacity 850ms ${EASE}`
        : `transform 600ms ${EASE_OUT}`

  const formOpacity = stage === "rising" ? 0 : contentMounted ? 1 : 0
  const formTransform =
    stage === "rising" ? "translateY(10px)" : contentMounted ? "translateY(0)" : "translateY(16px)"

  const busy = loading || stage === "rising"

  return (
    <div className="relative isolate flex h-full min-h-[600px] w-full flex-col overflow-hidden font-body">
      <Sky />
      <CloudDefs />

      {/* distant clouds along the top */}
      <CloudBank layer="far" className="left-0 top-0 z-[1]" />

      {/* ── the mark, top-left, in its own little cloud ── */}
      <div
        className="absolute left-3.5 top-3.5 z-30"
        style={{
          opacity: contentMounted ? 1 : 0,
          transform: contentMounted ? "translateY(0)" : "translateY(-8px)",
          transition: `all 700ms ${EASE_OUT} 120ms`
        }}>
        <CloudChip className="gap-1.5 px-3.5 py-1">
          <AnimatedLogo
            className="h-[18px] w-[18px] shrink-0"
            gaze={gaze}
            style={{ filter: "drop-shadow(0 1px 3px rgba(64,36,122,0.28))" }}
          />
          <MenoidWordmark tone="violet" className="h-[11px] w-auto" />
        </CloudChip>
      </div>

      {/* ── mark, field, button ──
             Centred in whatever height the surface happens to be. This screen
             runs in a fixed 360x600 popup *and* in the side panel, which is as
             tall as the browser window; fixed top margins leave the whole thing
             stranded at the top of the taller one. The bottom padding reserves
             the cloud bank, so the group is centred in the sky above it rather
             than in the window. */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-6 pb-[122px] pt-14">
        <div
          className="flex w-full max-w-[300px] flex-col items-center"
          style={{
            opacity: formOpacity,
            transform: formTransform,
            transition: `all 600ms ${EASE_OUT} ${stage === "rising" ? "0ms" : "260ms"}`,
            pointerEvents: stage === "rising" ? "none" : "auto"
          }}>
          {/* the mark */}
          <div className="relative mb-6" style={{ width: 150, height: 128 }}>
            <div
              className="halo-pulse pointer-events-none absolute left-1/2 top-1/2 h-[190px] w-[190px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,255,255,0.5) 0%, rgba(240,229,254,0.24) 42%, transparent 70%)",
                filter: "blur(16px)",
                opacity: stage === "floating" ? 1 : 0.35,
                transition: `opacity 800ms ${EASE_OUT}`
              }}
            />
            <div
              className="absolute inset-x-0 top-0 flex justify-center will-change-transform"
              style={{
                transform: markTransform,
                opacity: stage === "rising" ? 0 : 1,
                transition: markTransition
              }}
              onTransitionEnd={handleMarkTransitionEnd}>
              <div className={stage === "floating" ? "logo-float" : undefined}>
                <AnimatedLogo
                  className="h-[132px] w-[132px]"
                  gaze={gaze}
                  style={{ filter: "drop-shadow(0 14px 18px rgba(64,36,122,0.30))" }}
                />
              </div>
            </div>
          </div>

          {/* The field. Much brighter glass than anything else on this screen,
              because the type inside it is violet rather than white — a
              password is the one thing on the page worth reading a character at
              a time, and it is set in wide monospace beads to make that easy
              (`.pw-field` in style.css). Violet on 16% white is a ghost, so the
              fill comes up to something close to frosted glass. */}
          <div
            ref={fieldRef}
            className="relative w-full rounded-2xl"
            style={{
              background: error ? "rgba(255,244,247,0.62)" : "rgba(255,255,255,0.52)",
              border: `1px solid ${error ? "rgba(214,92,140,0.65)" : "rgba(255,255,255,0.75)"}`,
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.7), 0 10px 26px -14px rgba(48,26,96,0.55)",
              transition: `border-color 260ms ${EASE_OUT}, background-color 260ms ${EASE_OUT}`
            }}>
            <input
              ref={inputRef}
              type={showPw ? "text" : "password"}
              value={password}
              disabled={busy}
              autoFocus
              onChange={(e) => {
                setPassword(e.target.value)
                setError("")
                lookAtCaret()
              }}
              // Arrow keys and backspace move the caret without changing the
              // value, so onChange alone would leave the eyes behind.
              onKeyUp={lookAtCaret}
              onClick={lookAtCaret}
              onFocus={lookAtCaret}
              onBlur={() => setGaze(null)}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              placeholder="Password"
              className="pw-field w-full rounded-2xl bg-transparent px-4 py-2.5 pr-11 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setShowPw((v) => !v)
                // the mask and the real text measure differently, so the eyes
                // have to be re-aimed after the swap paints
                requestAnimationFrame(lookAtCaret)
              }}
              aria-label={showPw ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--violet-deep)] opacity-55 transition-opacity hover:opacity-100">
              <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
                <path d="M1 8S3.5 3 8 3s7 5 7 5-2.5 5-7 5S1 8 1 8Z" stroke="currentColor" strokeWidth="1.4" />
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
                {!showPw && (
                  <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                )}
              </svg>
            </button>
          </div>

          {/* Plain coloured type, no plate.
              Dark ink with a light halo, rather than the pale rose you would
              reach for first: this sky runs from near-white in one corner to
              deep violet in the other, and a light error colour only survives
              one end of that. A deep rose is darker than every part of the
              gradient, and the white glow lifts it off the bottom-left pool —
              the same trick as the violet type on the cloud buttons, in the one
              hue that still reads as something going wrong. */}
          <div
            className="relative flex w-full justify-center overflow-hidden"
            style={{
              maxHeight: error ? 40 : 0,
              opacity: error ? 1 : 0,
              transition: `all 300ms ${EASE_OUT}`
            }}>
            <p
              className="mt-2 text-center font-round text-[12.5px] font-semibold leading-[1.5]"
              style={{
                color: "#9E1F55",
                textShadow: "0 1px 7px rgba(255,255,255,0.6), 0 0 14px rgba(255,255,255,0.45)"
              }}>
              {error}
            </p>
          </div>

          <div className="relative mt-6 flex w-full justify-center">
            <CloudChip
              as="button"
              onClick={handleUnlock}
              disabled={busy || !password}
              className="w-[60%] px-6 py-2.5 transition-transform duration-300 active:scale-[0.97]">
              <span className="flex items-center gap-2 font-round text-[14px] font-semibold text-[var(--violet-deep)]">
                {busy ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[rgba(78,47,142,0.25)] border-t-[var(--violet-deep)]" />
                    {stage === "rising" ? "Opening…" : "Unlocking…"}
                  </>
                ) : (
                  "Unlock"
                )}
              </span>
            </CloudChip>
          </div>
        </div>
      </div>

      {/* ── the cloud floor: two banks drifting at different speeds ── */}
      <CloudBank layer="mid" className="bottom-0 left-0 z-[3]" />
      <CloudBank layer="near" className="bottom-0 left-0 z-[4]" />

      {/* The pour. Covers the screen on mount and fades once it has settled. */}
      <MenoidLoader />
    </div>
  )
}
