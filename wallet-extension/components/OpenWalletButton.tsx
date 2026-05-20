/**
 * OpenWalletButton.tsx
 * Post-onboarding CTA. States:
 *   idle        → bold primary button "Open Menoid"
 *   loading     → inline spinner
 *   openedPopup → "Wallet is open in your toolbar" success card with a manual
 *                 close-tab button. We do NOT auto-close the tab in popup mode
 *                 because Chrome action popups close on focus loss — closing
 *                 the welcome tab would dismiss the popup the user just opened.
 *   needsPin    → instruction card with arrow + sidepanel fallback button,
 *                 shown when neither popup nor sidepanel could be opened.
 */

import React, { useState } from "react"
import {
  openSidepanelNow,
  openWalletInPreferredMode
} from "../lib/viewMode"

type State = "idle" | "loading" | "openedPopup" | "needsPin"

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
      <div className="w-full animate-revealUp">
        <div className="relative rounded-2xl bg-bone border border-ink/10 overflow-hidden p-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,_rgba(232,174,58,0.22),transparent_55%)]" />
          <div className="relative flex items-start gap-4">
            <div className="shrink-0 mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-goldDeep/12 ring-1 ring-goldDeep/25">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M3 9.5L7 13.5L15 5"
                  stroke="#A36E14"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] tracking-[0.4em] uppercase text-goldDeep">
                Menoid is open
              </p>
              <h4 className="mt-1 font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
                Check your toolbar
              </h4>
              <p className="mt-1.5 text-[12px] leading-[1.55] text-ink/60">
                The wallet popup is open in the top-right of your browser. When
                you&apos;re done with this tab, close it.
              </p>
            </div>
          </div>

          <div className="relative mt-5 flex items-center gap-2">
            <button
              onClick={() => window.close()}
              className="flex-1 rounded-xl bg-ink text-bone hover:-translate-y-[1px] transition py-2.5 text-[11px] tracking-[0.3em] uppercase">
              Close this tab
            </button>
            <button
              onClick={handleOpen}
              className="rounded-xl bg-ink/[0.04] hover:bg-ink/[0.08] border border-ink/10 px-4 py-2.5 text-[11px] tracking-[0.3em] uppercase text-ink/70">
              Reopen
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (state === "needsPin") {
    return (
      <div className="w-full animate-revealUp">
        <div className="relative rounded-2xl bg-ink text-bone overflow-hidden p-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,_rgba(232,174,58,0.35),transparent_60%)]" />
          <div className="relative flex items-start gap-4">
            <div className="shrink-0 mt-0.5">
              <svg
                width="38"
                height="38"
                viewBox="0 0 38 38"
                fill="none"
                className="animate-bob text-gold">
                <path
                  d="M8 30L30 8M30 8H14M30 8V24"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] tracking-[0.4em] uppercase text-gold/85">
                One last step
              </p>
              <h4 className="mt-1 font-display text-[18px] font-semibold tracking-[-0.01em]">
                Click the Menoid icon
              </h4>
              <p className="mt-1.5 text-[12px] leading-[1.55] text-bone/65">
                Find it in your browser toolbar. If hidden, click the puzzle
                icon and pin Menoid.
              </p>
            </div>
          </div>

          <div className="relative mt-5 flex items-center gap-2">
            <button
              onClick={handleOpen}
              className="flex-1 rounded-xl bg-bone/[0.08] hover:bg-bone/[0.14] border border-bone/15 py-2.5 text-[11px] tracking-[0.3em] uppercase transition">
              Try again
            </button>
            <button
              onClick={openInSidebar}
              className="flex-1 rounded-xl bg-gold text-ink hover:bg-goldLight border border-gold py-2.5 text-[11px] tracking-[0.3em] uppercase transition">
              Use side panel
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={handleOpen}
      disabled={state === "loading"}
      className="group relative w-full overflow-hidden rounded-2xl bg-ink text-bone py-4 px-5 transition-all duration-300 hover:-translate-y-[2px] hover:shadow-[0_20px_40px_-18px_rgba(23,19,17,0.7)] disabled:opacity-70 disabled:cursor-wait">
      <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,_rgba(232,174,58,0.45),transparent_55%)] opacity-0 group-hover:opacity-100 transition duration-500" />
      <span className="relative flex items-center justify-between">
        <span className="flex items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-gold ring-2 ring-gold/30" />
          <span className="text-left">
            <span className="block font-display text-[15px] font-semibold tracking-[-0.005em]">
              Open Menoid
            </span>
            <span className="block text-[10px] tracking-[0.3em] uppercase text-bone/55 mt-0.5">
              Launch your wallet
            </span>
          </span>
        </span>
        <span className="flex items-center gap-2">
          {state === "loading" ? (
            <span className="h-4 w-4 rounded-full border-2 border-bone/30 border-t-bone animate-spin" />
          ) : (
            <svg
              width="22"
              height="10"
              viewBox="0 0 22 10"
              fill="none"
              className="transition group-hover:translate-x-1.5">
              <path
                d="M0 5H20M20 5L16 1M20 5L16 9"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          )}
        </span>
      </span>
    </button>
  )
}
