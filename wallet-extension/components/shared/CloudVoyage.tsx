/**
 * CloudVoyage.tsx
 *
 * The in-flight "phase pointer" shown while a transaction is submitting —
 * replaces the old sailing-ship indicator. A small cloud drifts back and forth
 * across a track; the `AnimatedLogo` above it runs the `waiting` face whose eye
 * scan shares this same 2.4s period, so the mark reads as watching the cloud.
 *
 *   tone="light"          → a pale cloud on the open (light) sheet
 *   tone="dark" rain      → a storm cloud with falling rain on the noid sheet
 */

import React from "react"

export default function CloudVoyage({
  tone = "light",
  rain = false,
  label
}: {
  tone?: "light" | "dark"
  rain?: boolean
  label?: string
}) {
  const dark = tone === "dark"
  const cloudFill   = dark ? "#8E76C6" : "#F4EEFF"
  const cloudStroke = dark ? "rgba(18,9,42,0.35)" : "rgba(78,47,142,0.12)"
  const highlight   = dark ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.65)"
  const dropShadow  = dark ? "rgba(0,0,0,0.45)" : "rgba(48,26,96,0.22)"
  const horizon     = dark ? "rgba(244,238,255,0.12)" : "rgba(78,47,142,0.12)"
  const labelColor  = dark ? "rgba(244,238,255,0.62)" : "rgba(78,47,142,0.55)"

  return (
    <div style={{ position: "relative", width: "100%", height: 82, overflow: "hidden" }}>
      {/* horizon the cloud drifts along */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 22, height: 1, background: horizon }} />

      {/* drifting cloud (left animates across the track, matched to the eye scan) */}
      <div className="cv-drift" style={{ position: "absolute", top: 8, width: 72 }}>
        <div className="cv-bob" style={{ position: "relative", filter: `drop-shadow(0 6px 10px ${dropShadow})` }}>
          <svg viewBox="0 0 120 74" width="72" height="44" style={{ display: "block" }}>
            <g fill={cloudFill} stroke={cloudStroke} strokeWidth="1">
              <ellipse cx="42" cy="44" rx="27" ry="21" />
              <ellipse cx="72" cy="37" rx="31" ry="25" />
              <ellipse cx="95" cy="47" rx="21" ry="17" />
              <rect x="30" y="44" width="72" height="22" rx="11" />
            </g>
            <ellipse cx="64" cy="31" rx="18" ry="9" fill={highlight} />
          </svg>

          {/* The rain trails opposite the cloud's motion: it leans left as the
              cloud drifts right and right as it drifts left. The drops fall
              straight; the wrapper skews in sync with the drift (cvRainLean). */}
          {rain && (
            <svg viewBox="0 0 120 40" width="72" height="24" className="cv-rain-lean" style={{ position: "absolute", top: 42, left: 0, transformOrigin: "top center" }}>
              {[20, 40, 60, 80, 100].map((x, i) => (
                <line
                  key={i}
                  className="cv-rain"
                  style={{ animationDelay: `${i * 0.16}s` }}
                  x1={x}
                  y1="0"
                  x2={x}
                  y2="15"
                  stroke="#B9A6E8"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              ))}
            </svg>
          )}
        </div>
      </div>

      {label && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 3,
            textAlign: "center",
            fontSize: 10,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: labelColor,
            fontWeight: 600
          }}>
          {label}
        </div>
      )}

      <style>{`
        @keyframes cvDrift { 0%, 100% { left: 6%; } 50% { left: calc(94% - 72px); } }
        .cv-drift { animation: cvDrift 2.4s ease-in-out infinite; left: 6%; }
        @keyframes cvBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
        .cv-bob { animation: cvBob 1.7s ease-in-out infinite; }
        @keyframes cvRain { 0% { opacity: 0; transform: translateY(-6px); } 30% { opacity: 1; } 100% { opacity: 0; transform: translateY(12px); } }
        .cv-rain { animation: cvRain 0.9s linear infinite; }
        /* rain leans against the cloud's drift direction (in sync with cvDrift) */
        @keyframes cvRainLean { 0%, 50%, 100% { transform: skewX(0deg); } 25% { transform: skewX(-20deg); } 75% { transform: skewX(20deg); } }
        .cv-rain-lean { animation: cvRainLean 2.4s ease-in-out infinite; }
      `}</style>
    </div>
  )
}
