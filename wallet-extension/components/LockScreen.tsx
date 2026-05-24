/**
 * LockScreen.tsx — Liquid iOS Edition
 *
 * Matches the design language used in OpenModeView / NoidModeView:
 *   - Spring physics + glass morphism
 *   - Dark luxury gradient with floating gold orbs
 *   - Paper grain + sheen overlay
 *
 * The hero element is a ship-with-Meno scene composed from the existing
 * ship.png and meno_hi_text.png assets. The composite plays a four-stage
 * animation tied to the unlock flow:
 *
 *   1. mount           — ship slides in from the left
 *   2. floating        — ship gently bobs in the centre while the user types
 *   3. success         — ship sails off to the right with a sheen flash
 *   4. onUnlock fires  — popup hands control to <WalletHome />
 */

import React, { useEffect, useRef, useState } from "react"
import shipImg from "data-base64:~assets/meno/meno_hi_ship.png"
import {
  decryptAll,
  migrateLegacyIfNeeded,
  readWalletsState,
  type WalletEntry
} from "../lib/wallets"
import type { StoredWallet } from "../crypto/walletCrypto"

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

type ShipStage = "entering" | "floating" | "sailing"

export default function LockScreen({ onUnlock }: Props) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [stage, setStage] = useState<ShipStage>("entering")
  const [contentMounted, setContentMounted] = useState(false)
  const pendingPayload = useRef<UnlockPayload | null>(null)

  // 1) Kick off the entry animation a frame after mount so the transition
  //    actually plays (otherwise the initial transform is the final one).
  useEffect(() => {
    const r = requestAnimationFrame(() => {
      setStage("floating")
      setContentMounted(true)
    })
    return () => cancelAnimationFrame(r)
  }, [])

  async function handleUnlock() {
    if (!password) {
      setError("Enter your password.")
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

      // Trigger sail-away, then hand off to <WalletHome />.
      pendingPayload.current = payload
      setStage("sailing")
    } catch (e: any) {
      setLoading(false)
      setError(
        e?.message === "Wrong password"
          ? "Wrong password. Try again."
          : e?.message ?? "Decryption failed."
      )
    }
  }

  // Once the ship has sailed off-screen, commit the unlock.
  function handleShipTransitionEnd(e: React.TransitionEvent) {
    if (
      stage === "sailing" &&
      e.propertyName === "transform" &&
      pendingPayload.current
    ) {
      const payload = pendingPayload.current
      pendingPayload.current = null
      onUnlock(payload)
    }
  }

  // Ship transform per stage.
  const shipTransform =
    stage === "entering"
      ? "translateX(-140%) translateY(0) rotate(-6deg)"
      : stage === "sailing"
      ? "translateX(160%) translateY(-6px) rotate(4deg)"
      : "translateX(0) translateY(0) rotate(0deg)"

  const shipTransition =
    stage === "entering"
      ? `transform 1100ms ${SPRING}`
      : stage === "sailing"
      ? `transform 900ms ${EASE}`
      : `transform 600ms ${EASE_OUT}`

  // Form should fade out once the ship is sailing.
  const formOpacity = stage === "sailing" ? 0 : contentMounted ? 1 : 0
  const formTransform =
    stage === "sailing"
      ? "translateY(8px)"
      : contentMounted
      ? "translateY(0)"
      : "translateY(14px)"

  return (
    <div
      className="relative w-[360px] h-full font-body text-ink overflow-hidden"
      style={{
        background:
          "linear-gradient(160deg, #FBF1D9 0%, #F4E7CC 55%, #EAD5A7 100%)"
      }}>
      <LiquidBackdrop />

      {/* ── Header ── */}
      <div
        className="relative z-20 flex items-center justify-center pt-7"
        style={{
          opacity: contentMounted ? 1 : 0,
          transform: contentMounted ? "translateY(0)" : "translateY(-8px)",
          transition: `all 700ms ${EASE_OUT} 120ms`
        }}>
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{
            background: "rgba(255,255,255,0.45)",
            border: "1px solid rgba(163,110,20,0.18)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.7), 0 4px 12px -6px rgba(163,110,20,0.25)"
          }}>
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: "#A36E14",
              boxShadow: "0 0 8px rgba(232,174,58,0.6)"
            }}
          />
          <span className="font-display text-[10px] font-semibold tracking-[0.4em] text-ink">
            MENOID
          </span>
        </div>
      </div>

      {/* ── Ship + Meno scene ── */}
      <div className="relative z-10 mt-3 px-6">
        <div
          className="relative mx-auto"
          style={{ width: 260, height: 200 }}>
          {/* Glow halo behind the ship */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background:
                "radial-gradient(circle at 50% 55%, rgba(232,174,58,0.55) 0%, rgba(232,174,58,0.18) 40%, transparent 70%)",
              filter: "blur(20px)",
              opacity: stage === "floating" ? 1 : 0.4,
              transition: `opacity 800ms ${EASE_OUT}`
            }}
          />

          {/* The composite that actually slides in/out */}
          <div
            className="absolute inset-0 will-change-transform"
            style={{
              transform: shipTransform,
              transition: shipTransition
            }}
            onTransitionEnd={handleShipTransitionEnd}>
            <div
              className="absolute inset-0 flex items-end justify-center"
              style={{
                animation:
                  stage === "floating"
                    ? "shipBob 4.6s ease-in-out infinite"
                    : "none"
              }}>
              {/* Ship */}
              <img
                src={shipImg}
                alt="Ship"
                draggable={false}
                style={{
                  width: 250,
                  filter:
                    "drop-shadow(0 16px 12px rgba(92,58,33,0.28)) drop-shadow(0 0 24px rgba(232,174,58,0.30))",
                  userSelect: "none"
                }}
              />
            </div>
          </div>

          {/* Water reflection / shimmer line under the ship */}
          <div
            className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
            style={{
              bottom: 4,
              width: "70%",
              height: 6,
              borderRadius: "50%",
              background:
                "radial-gradient(ellipse at center, rgba(232,174,58,0.45) 0%, transparent 70%)",
              filter: "blur(4px)",
              opacity: stage === "floating" ? 0.9 : 0.3,
              transition: `opacity 700ms ${EASE_OUT}`
            }}
          />
        </div>
      </div>

      {/* ── Unlock form ── */}
      <div
        className="relative z-20 px-6 mt-2"
        style={{
          opacity: formOpacity,
          transform: formTransform,
          transition: `all 600ms ${EASE_OUT} ${
            stage === "sailing" ? "0ms" : "260ms"
          }`,
          pointerEvents: stage === "sailing" ? "none" : "auto"
        }}>
        <p className="text-center font-serif italic text-[12px] text-goldDeep mb-1">
          Welcome back
        </p>
        <h2 className="text-center font-display text-[22px] font-bold tracking-[-0.025em] mb-1 text-ink">
          Unlock your wallet
        </h2>
        <p className="text-center text-[11px] text-ink/45 mb-5">
          Enter your password to set sail
        </p>

        <div
          className="relative rounded-2xl"
          style={{
            background: "rgba(255,255,255,0.55)",
            border: "1px solid rgba(163,110,20,0.18)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.7), 0 8px 24px -14px rgba(92,58,33,0.35)"
          }}>
          <input
            type={showPw ? "text" : "password"}
            value={password}
            disabled={loading || stage === "sailing"}
            onChange={(e) => {
              setPassword(e.target.value)
              setError("")
            }}
            onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
            placeholder="Password"
            className="w-full bg-transparent px-4 py-3 pr-10 text-[14px] text-ink placeholder-ink/35 focus:outline-none rounded-2xl"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink/75 transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M1 8S3.5 3 8 3s7 5 7 5-2.5 5-7 5S1 8 1 8Z"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
              {!showPw && (
                <line
                  x1="2"
                  y1="2"
                  x2="14"
                  y2="14"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>

        <div
          className="overflow-hidden"
          style={{
            maxHeight: error ? 28 : 0,
            opacity: error ? 1 : 0,
            transition: `all 300ms ${EASE_OUT}`
          }}>
          <p className="mt-2 text-[11px] text-rust text-center">{error}</p>
        </div>

        <LiquidPressButton
          onClick={handleUnlock}
          disabled={loading || !password || stage === "sailing"}>
          {loading || stage === "sailing" ? (
            <>
              <span className="h-3.5 w-3.5 rounded-full border-2 border-ink/30 border-t-ink animate-spin" />
              {stage === "sailing" ? "Setting sail…" : "Unlocking…"}
            </>
          ) : (
            "Unlock"
          )}
        </LiquidPressButton>

        <div className="mt-5 flex items-center justify-center gap-3">
          <span
            className="h-px w-6"
            style={{
              background:
                "linear-gradient(to right, transparent, rgba(232,174,58,0.55))"
            }}
          />
          <p className="font-serif italic text-[11px] text-ink/45">
            Yer keys, yer kingdom.
          </p>
          <span
            className="h-px w-6"
            style={{
              background:
                "linear-gradient(to left, transparent, rgba(232,174,58,0.55))"
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes shipBob {
          0%, 100% { transform: translateY(0) rotate(-1.2deg); }
          50%      { transform: translateY(-10px) rotate(1.2deg); }
        }
        @keyframes menoWave {
          0%, 100% { transform: translateX(-58%) rotate(-1deg); }
          50%      { transform: translateX(-58%) translateY(-3px) rotate(1deg); }
        }
        @keyframes lockOrb1 {
          0%, 100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(20px,-12px) scale(1.08); }
        }
        @keyframes lockOrb2 {
          0%, 100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(-18px,14px) scale(1.05); }
        }
        @keyframes lockSheen {
          0%, 100% { transform: translateX(-30%); opacity: 0; }
          50%      { transform: translateX(30%);  opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}

/* ─────────────────────────── Liquid press button ─────────────────────────── */
function LiquidPressButton({
  children,
  onClick,
  disabled
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  const [pressed, setPressed] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      className="mt-4 w-full rounded-2xl py-3.5 font-display text-[12px] font-semibold tracking-[0.1em] uppercase flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background:
          "linear-gradient(180deg, #F4D27A 0%, #E8AE3A 55%, #A36E14 100%)",
        color: "#171311",
        border: "1px solid rgba(251,241,217,0.25)",
        boxShadow: disabled
          ? "inset 0 1px 0 rgba(255,255,255,0.18)"
          : pressed
          ? "inset 0 2px 6px rgba(0,0,0,0.25), 0 2px 6px rgba(232,174,58,0.25)"
          : "inset 0 1px 0 rgba(255,255,255,0.4), 0 10px 24px -10px rgba(232,174,58,0.6), 0 4px 10px rgba(0,0,0,0.35)",
        transform: pressed ? "scale(0.96)" : "scale(1)",
        transition: `all 350ms ${SPRING}`
      }}>
      {children}
    </button>
  )
}

/* ───────────────────────────── Liquid backdrop ───────────────────────────── */
function LiquidBackdrop() {
  return (
    <>
      {/* Floating gold orbs */}
      <div
        className="pointer-events-none absolute"
        style={{
          top: "-14%",
          right: "-18%",
          width: 280,
          height: 280,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(232,174,58,0.55) 0%, transparent 65%)",
          filter: "blur(38px)",
          animation: "lockOrb1 11s ease-in-out infinite"
        }}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          bottom: "-18%",
          left: "-22%",
          width: 300,
          height: 300,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(244,210,122,0.55) 0%, transparent 65%)",
          filter: "blur(48px)",
          animation: "lockOrb2 13s ease-in-out infinite 2s"
        }}
      />
      {/* Diagonal sheen */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.30) 50%, transparent 70%)",
          animation: "lockSheen 8s ease-in-out infinite"
        }}
      />
      {/* Faint grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right,#171311 1px,transparent 1px),linear-gradient(to bottom,#171311 1px,transparent 1px)",
          backgroundSize: "28px 28px"
        }}
      />
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-[0.25]" />
    </>
  )
}
