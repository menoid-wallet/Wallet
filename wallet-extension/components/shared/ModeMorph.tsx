/**
 * ModeTransition.tsx
 *
 * A subtle scale-and-fade morph between the two mode views. There is
 * intentionally no overlay, no banner, no "theme animation" — just two
 * stacked layers cross-fading while one shrinks and the other grows.
 *
 * The outgoing view: scale 1 → 0.88, opacity 1 → 0
 * The incoming view: scale 0.94 → 1, opacity 0 → 1
 * Both run on the same ~420ms curve so they meet visually in the middle.
 *
 * Usage from the parent (WalletHome):
 *   - When the user toggles modes, render <ModeMorph keyId={mode}> with
 *     the current view as children. The component diffs its `keyId`
 *     prop and runs an outgoing pass on the old subtree before
 *     committing the new one.
 *
 * This file exports `ModeMorph`, which is a stateful crossfade wrapper.
 * The previous `ModeTransition` overlay component is no longer needed
 * and has been removed.
 */

import React, { useEffect, useRef, useState } from "react"

interface Props {
  /** When this changes, run the morph */
  keyId: string
  children: React.ReactNode
  durationMs?: number
}

interface Slot {
  id: string
  node: React.ReactNode
  /** "in"  — animating in toward (scale 1, opacity 1)
   *  "out" — animating out toward (scale 0.88, opacity 0) */
  state: "enter" | "in" | "out"
}

export default function ModeMorph({
  keyId,
  children,
  durationMs = 420
}: Props) {
  // We keep up to two slots: the current child, and (briefly) the
  // previous child while it animates out.
  const [slots, setSlots] = useState<Slot[]>([
    { id: keyId, node: children, state: "in" }
  ])
  const lastKey = useRef(keyId)

  useEffect(() => {
    if (keyId === lastKey.current) {
      // Same view re-rendering — just update its node so React keeps
      // state inside it (balance polling, etc.) without restarting.
      setSlots((prev) =>
        prev.map((s) => (s.id === keyId ? { ...s, node: children } : s))
      )
      return
    }

    // Mode change: mark the old slot as "out" and add a new "enter" slot.
    setSlots((prev) => {
      const out = prev.map((s) => ({ ...s, state: "out" as const }))
      return [...out, { id: keyId, node: children, state: "enter" }]
    })
    lastKey.current = keyId

    // Next frame: flip the entering slot to "in" so the transition fires.
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSlots((prev) =>
          prev.map((s) =>
            s.id === keyId && s.state === "enter"
              ? { ...s, state: "in" }
              : s
          )
        )
      })
    })

    // After the duration: drop the outgoing slot.
    const t = setTimeout(() => {
      setSlots((prev) => prev.filter((s) => s.state !== "out"))
    }, durationMs)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
    }
  }, [keyId, children, durationMs])

  return (
    <div className="relative w-full h-full">
      {slots.map((slot) => {
        // visual state → transform/opacity
        let transform = "scale(1)"
        let opacity = 1
        let pointer: "auto" | "none" = "auto"
        if (slot.state === "enter") {
          transform = "scale(0.94)"
          opacity = 0
          pointer = "none"
        } else if (slot.state === "out") {
          transform = "scale(0.88)"
          opacity = 0
          pointer = "none"
        }
        // Only one slot is interactive at a time (the most recent "in" one)
        const isTop = slot.id === lastKey.current && slot.state !== "out"
        return (
          <div
            key={slot.id}
            className="absolute inset-0 will-change-[transform,opacity]"
            style={{
              transform,
              opacity,
              pointerEvents: pointer,
              transition: `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`,
              zIndex: isTop ? 2 : 1
            }}>
            {slot.node}
          </div>
        )
      })}
    </div>
  )
}