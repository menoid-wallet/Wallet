/**
 * OpenWalletButton.tsx
 * Post-onboarding CTA. States:
 *   idle        → the primary cloud button "Open Menoid"
 *   loading     → inline spinner
 *   openedPopup → "Wallet is open in your toolbar" success card with a manual
 *                 close-tab button. We do NOT auto-close the tab in popup mode
 *                 because Chrome action popups close on focus loss — closing
 *                 the welcome tab would dismiss the popup the user just opened.
 *   needsPin    → instruction card with arrow + sidepanel fallback button,
 *                 shown when neither popup nor sidepanel could be opened.
 *
 * Lives on the onboarding sky, so everything here is glass and white type.
 */

import React, { useState } from "react"
import { openSidepanelNow, openWalletInPreferredMode } from "../lib/viewMode"
import { CloudButton, GhostButton, Spinner } from "./brand/SetupUI"

type State = "idle" | "loading" | "openedPopup" | "needsPin"

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.14)",
  border: "1px solid rgba(255,255,255,0.28)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.32)"
}

export default function OpenWalletButton() {
  const [state, setState] = useState<State>("idle")

  async function handleOpen() {
    setState("loading")
    const r = await openWalletInPreferredMode()
    if (!r.opened) {
      setState("needsPin")
      return
    }
    if (r.openedAs === "sidebar") {
      // sidepanel persists across tab focus changes — safe to close the tab
      setTimeout(() => window.close(), 150)
    } else {
      // popup mode — closing this tab would kill the popup. Swap to success view.
      setState("openedPopup")
    }
  }

  async function openInSidebar() {
    setState("loading")
    const ok = await openSidepanelNow()
    if (ok) {
      setTimeout(() => window.close(), 150)
    } else {
      setState("needsPin")
    }
  }

  if (state === "openedPopup") {
    return (
      <div className="animate-revealUp w-full rounded-3xl p-5 text-left" style={cardStyle}>
        <div className="flex items-start gap-4">
          <span
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ background: "rgba(255,255,255,0.22)", border: "1px solid rgba(255,255,255,0.32)" }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M3 9.5L7 13.5L15 5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-round text-[11px] uppercase tracking-[0.28em] text-white/55">
              Menoid is open
            </p>
            <h4 className="mt-1 font-round text-[17px] font-semibold text-white">
              Check your toolbar
            </h4>
            <p className="mt-1.5 font-round text-[12.5px] leading-[1.55] text-white/68">
              The wallet popup is open in the top-right of your browser. When you&apos;re done with
              this tab, close it.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2.5">
          <CloudButton onClick={() => window.close()}>Close this tab</CloudButton>
          <GhostButton onClick={handleOpen} className="!w-auto shrink-0 !px-5">
            Reopen
          </GhostButton>
        </div>
      </div>
    )
  }

  if (state === "needsPin") {
    return (
      <div className="animate-revealUp w-full rounded-3xl p-5 text-left" style={cardStyle}>
        <div className="flex items-start gap-4">
          <svg width="38" height="38" viewBox="0 0 38 38" fill="none" className="animate-bob mt-0.5 shrink-0 text-white">
            <path d="M8 30L30 8M30 8H14M30 8V24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="font-round text-[11px] uppercase tracking-[0.28em] text-white/55">
              One last step
            </p>
            <h4 className="mt-1 font-round text-[18px] font-semibold text-white">
              Click the Menoid icon
            </h4>
            <p className="mt-1.5 font-round text-[12.5px] leading-[1.55] text-white/68">
              Find it in your browser toolbar. If it&apos;s hidden, click the puzzle icon and pin
              Menoid.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2.5">
          <GhostButton onClick={handleOpen}>Try again</GhostButton>
          <CloudButton onClick={openInSidebar}>Use side panel</CloudButton>
        </div>
      </div>
    )
  }

  return (
    <CloudButton onClick={handleOpen} disabled={state === "loading"}>
      {state === "loading" ? (
        <>
          <Spinner />
          Opening…
        </>
      ) : (
        <>
          Open Menoid
          <svg width="20" height="10" viewBox="0 0 22 10" fill="none" aria-hidden>
            <path d="M0 5H20M20 5L16 1M20 5L16 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </>
      )}
    </CloudButton>
  )
}
