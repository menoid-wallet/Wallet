/**
 * QRCanvas.tsx
 *
 * Renders a QR code to a <canvas>. Uses the `qrcode` npm package.
 *
 *   npm install qrcode @types/qrcode
 *
 * If you'd rather avoid the dep, swap the inner draw call for any
 * other QR generator — the public surface (data, size, fg/bg) stays.
 */

import React, { useEffect, useRef } from "react"
import QRCode from "qrcode"

interface Props {
  data: string
  size?: number
  fg?: string
  bg?: string
  /** L | M | Q | H — higher = more redundancy = bigger center logo allowed */
  errorCorrectionLevel?: "L" | "M" | "Q" | "H"
  className?: string
}

export default function QRCanvas({
  data,
  size = 220,
  fg = "#171311",
  bg = "#FBF1D9",
  errorCorrectionLevel = "H",
  className = ""
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!canvasRef.current || !data) return
    QRCode.toCanvas(canvasRef.current, data, {
      width: size,
      margin: 1,
      errorCorrectionLevel,
      color: { dark: fg, light: bg }
    }).catch((e) => {
      console.error("QR render failed:", e)
    })
  }, [data, size, fg, bg, errorCorrectionLevel])

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  )
}