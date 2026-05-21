/**
 * AnimatedNumber.tsx
 *
 * Renders a numeric value as a row of digit columns. When the value
 * changes, each column "rolls" vertically from its old digit to the
 * new digit, like a mechanical odometer.
 *
 * Behavior:
 *   - `value` is the string representation already formatted by the
 *     caller (e.g. "0.5000"). Non-digit chars (".", ",", "-") render
 *     statically and don't animate, so decimal points stay anchored.
 *   - When the formatted length changes, we let the layout flow rather
 *     than padding — the parent decides what to show.
 *   - Each digit column is a fixed-height window over a strip listing
 *     0..9. We translate the strip so the target digit is in the
 *     window. Tailwind transitions handle the easing.
 *
 * Sizing: `height` controls the visual line-height; the strip uses
 * the same height per digit so alignment stays clean.
 */

import React, { useEffect, useState } from "react"

interface Props {
  value: string
  /** pixel line-height of one digit */
  height?: number
  /** css class on the wrapper (font, color, weight…) */
  className?: string
  /** transition duration in ms */
  duration?: number
}

export default function AnimatedNumber({
  value,
  height = 36,
  className = "",
  duration = 600
}: Props) {
  // Mount-time animation: start each column from 0 so the first paint
  // rolls up to the real value rather than appearing instantly.
  const [hasMounted, setHasMounted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setHasMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const chars = value.split("")

  return (
    <span
      className={`inline-flex items-baseline ${className}`}
      style={{ lineHeight: `${height}px` }}>
      {chars.map((ch, i) => {
        if (/\d/.test(ch)) {
          const target = Number(ch)
          return (
            <DigitColumn
              key={`${i}-d`}
              digit={hasMounted ? target : 0}
              height={height}
              duration={duration}
            />
          )
        }
        // static char (decimal point, sign, comma)
        return (
          <span
            key={`${i}-s`}
            style={{ height, lineHeight: `${height}px` }}
            className="inline-block">
            {ch}
          </span>
        )
      })}
    </span>
  )
}

function DigitColumn({
  digit,
  height,
  duration
}: {
  digit: number
  height: number
  duration: number
}) {
  // Strip lists 0..9 stacked vertically; translate to expose the target.
  return (
    <span
      className="inline-block overflow-hidden align-baseline"
      style={{ height, width: `${Math.round(height * 0.55)}px` }}>
      <span
        className="block will-change-transform"
        style={{
          transform: `translateY(-${digit * height}px)`,
          transition: `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`
        }}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <span
            key={n}
            className="block text-center tabular-nums"
            style={{ height, lineHeight: `${height}px` }}>
            {n}
          </span>
        ))}
      </span>
    </span>
  )
}