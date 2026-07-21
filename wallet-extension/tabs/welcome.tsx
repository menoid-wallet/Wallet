/**
 * welcome.tsx
 *
 * The onboarding landing, in the Menoid sky. Manages its own view state — no
 * new tabs opened:
 *
 *   view = "landing"  → this page
 *   view = "create"   → CreateWallet, inline
 *   view = "import"   → ImportWallet, inline
 *
 * If a wallet already exists, the first card offers to open the extension
 * instead of creating another one.
 */

import React, { useEffect, useState } from "react"
import CreateWallet from "../components/CreateWallet"
import ImportWallet from "../components/ImportWallet"
import AnimatedLogo from "../components/brand/AnimatedLogo"
import MenoidWordmark from "../components/brand/MenoidWordmark"
import CloudChip from "../components/brand/CloudChip"
import Sky from "../components/brand/Sky"
import { CloudBank, CloudCard, CloudDefs, StillCloud } from "../components/brand/Clouds"
import { openWalletInPreferredMode } from "../lib/viewMode"
import "../style.css"

type View = "landing" | "create" | "import"

function Welcome() {
  const [view, setView] = useState<View>("landing")
  const [walletExists, setWalletExists] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const result = await chrome.storage.local.get([
          "menoid_onboarding",
          "menoid_wallets",
          "menoid_wallet"
        ])
        if (result?.menoid_onboarding && (result?.menoid_wallets || result?.menoid_wallet)) {
          setWalletExists(true)
        }
      } catch {
        // ignore
      }
    })()
  }, [])

  if (view === "create") return <CreateWallet onBack={() => setView("landing")} />
  if (view === "import") return <ImportWallet onBack={() => setView("landing")} />

  return (
    /* Exactly one viewport, and it never scrolls. The cloud floor is the bottom
       of the sky, so it has to be the bottom of the *window* — pushed below the
       fold it stops being weather and becomes a thing you have to go and find.
       Everything above it is sized off `vh` as well as `vw` so the column
       shrinks to fit a short laptop screen rather than running off the end. */
    <div className="relative isolate flex h-screen w-full flex-col overflow-hidden font-body">
      <Sky />
      <CloudDefs />
      <CloudBank layer="far" className="left-0 top-0 z-[1]" />

      {/* ── top chrome ── */}
      <header className="relative z-40 mx-auto flex w-full max-w-[1180px] shrink-0 items-center justify-between gap-4 px-6 py-5 sm:px-10">
        <CloudChip className="gap-2.5 px-4 py-1.5">
          <AnimatedLogo className="h-8 w-8 shrink-0" />
          <MenoidWordmark tone="violet" className="h-[15px] w-auto" />
        </CloudChip>

        {/* The sky's top-right corner is its brightest point, so this needs the
            shadow to stay readable where it sits. */}
        <nav
          className="hidden items-center gap-6 font-round text-[12px] font-medium text-white sm:flex"
          style={{ textShadow: "0 1px 7px rgba(48,26,96,0.65)" }}>
          <span>Est. MMXXVI</span>
          <span className="h-1 w-1 rounded-full bg-white/45" />
          <span>v1</span>
        </nav>
      </header>

      {/* ── main ──
             Two bands, not one column: the copy takes whatever height is left
             over (`flex-1`) and the two doors are parked on the floor beneath
             it. That is what stops the page reading as one congested stack —
             the headline gets the middle of the sky, and the buttons get the
             horizon.

             overflow-y-auto is a safety valve, not the plan: the rhythm here is
             sized so everything fits every reasonable window, and this only ever
             engages on something genuinely tiny. The scrollbar is hidden either
             way, so at normal sizes the page reads as fixed. */}
      <main className="no-scrollbar relative z-30 flex min-h-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {/* ── the mark on its cloud ──
               Absolute rather than a grid cell, so it centres against the whole
               sky — copy band AND doors band — instead of only against the copy.
               In a cell it sat level with the headline and left the bottom-right
               quarter of the page empty. The clearance padding keeps the centre
               above the cloud floor, or it would drift down into the weather.

               pointer-events-none because it is scenery: the eyes track the
               cursor from a window listener, not from hover, so nothing is lost
               and it can never swallow a click meant for a door. */}
        <div className="clear-clouds-auto pointer-events-none absolute inset-0 z-0 mx-auto hidden w-full max-w-[1180px] items-center justify-end px-6 sm:px-10 lg:flex">
          <div className="relative w-[42%]">
            <div
              className="halo-pulse absolute left-1/2 top-[38%] h-[54vh] max-h-[420px] w-[54vh] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,255,255,0.5) 0%, rgba(240,229,254,0.24) 42%, transparent 70%)",
                filter: "blur(24px)"
              }}
            />
            <StillCloud
              className="hero-cloud absolute bottom-0 left-1/2 -translate-x-1/2"
              style={{ filter: "drop-shadow(0 20px 32px rgba(48,26,96,0.24))" }}
            />
            <div className="relative flex justify-center pb-[14%] pt-[2%]">
              <div className="logo-float">
                <AnimatedLogo
                  className="hero-mark"
                  style={{ filter: "drop-shadow(0 22px 30px rgba(48,26,96,0.34))" }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-[1180px] flex-1 items-center px-6 sm:px-10">
          <div className="grid w-full grid-cols-1 items-center gap-8 lg:grid-cols-12">
            {/* ── copy ──
                   Centred until the mark appears at `lg`. Below that the mark
                   is hidden and the doors have no column to hang off, so a
                   left-aligned column would sit against a wide empty right
                   half with the buttons centred underneath it. */}
            <div className="hero-stack flex flex-col items-center text-center lg:col-span-7 lg:items-start lg:text-left">
              <div className="inline-flex items-center gap-2.5 rounded-full px-4 py-1.5"
                style={{
                  background: "rgba(255,255,255,0.18)",
                  border: "1px solid rgba(255,255,255,0.34)",
                  backdropFilter: "blur(14px)"
                }}>
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-white" />
                <span className="font-round text-[12px] text-white/90">A private crypto wallet</span>
              </div>

              <h1 className="hero-title font-round font-semibold leading-[1.06] text-white">
                <span style={{ textShadow: "0 14px 30px rgba(48,26,96,0.42)" }}>Your Crypto.</span>
                <br />
                {/* Gradient fill, and no shadow of any kind on this line: a
                    text-shadow shows straight through the transparent glyphs, and
                    a filter anywhere up the tree drops the background-clip and
                    floods the whole box. backgroundImage, not `background` — the
                    shorthand resets the clip. */}
                <span
                  style={{
                    backgroundImage: "linear-gradient(180deg, #FFFFFF 0%, #FBF4FF 40%, #E3CEFF 100%)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent"
                  }}>
                  Your Privacy.
                </span>
              </h1>

              <p
                className="hero-lede max-w-[440px] font-round leading-relaxed text-white/88"
                style={{ textShadow: "0 1px 8px rgba(48,26,96,0.32)" }}>
                Keep your on-chain activity to yourself — across every chain you use.
              </p>

              {walletExists && (
                <div
                  className="flex items-center gap-3 rounded-2xl px-4 py-2.5"
                  style={{
                    background: "rgba(255,255,255,0.18)",
                    border: "1px solid rgba(255,255,255,0.32)",
                    backdropFilter: "blur(14px)"
                  }}>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" />
                  <p className="font-round text-[13px] text-white/90">
                    A wallet is already set up — open the extension to unlock it.
                  </p>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* ── the two doors, floating just above the floor ── */}
        {/* Left-aligned on a wide screen, not centred: the container's left
            edge is where "Your Crypto." starts, so the doors hang off the same
            line as the copy instead of floating loose in the middle. */}
        <div className="clear-clouds-auto mx-auto flex w-full max-w-[1180px] shrink-0 flex-wrap items-end justify-center gap-x-[3vw] gap-y-4 px-6 pt-[1vh] sm:px-10 lg:justify-start">
          {walletExists ? (
            <CloudDoor
              title="Open extension"
              desc="Your wallet is ready."
              glyph="open"
              onClick={async () => {
                const r = await openWalletInPreferredMode()
                if (r.opened) window.close()
              }}
            />
          ) : (
            <CloudDoor
              title="Create wallet"
              desc="A new private account."
              glyph="plus"
              onClick={() => setView("create")}
            />
          )}
          <CloudDoor
            title="Import wallet"
            desc="From a seed phrase or key."
            glyph="import"
            onClick={() => setView("import")}
          />
        </div>
      </main>

      {/* ── the cloud floor, at the bottom of the view ── */}
      <CloudBank layer="mid" height="auto" className="bottom-0 left-0 z-[1]" />
      <CloudBank layer="near" height="auto" className="bottom-0 left-0 z-[2]" />

      {/* ── trust strip, printed on the floor ──
             Sits *on* the near bank rather than in the sky above it, which is
             why it flips to violet ink: down here the backdrop is the deck's
             white-to-lilac, and the white type it used to be would be gone.
             Above the banks in z, and pointer-events-none so it never eats a
             click aimed at a door hanging over the horizon. */}
      <div className="pointer-events-none absolute bottom-0 left-0 z-[35] w-full">
        <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-1 px-6 pb-[2.2vh] sm:px-10">
          {["Non-custodial", "Zero-knowledge", "Multichain"].map((t) => (
            <span key={t} className="inline-flex items-center gap-2">
              <svg
                className="h-2.5 w-2.5 shrink-0"
                viewBox="0 0 24 24"
                fill="var(--violet-deep)"
                aria-hidden>
                <path d="M12 0c0 6.6 5.4 12 12 12-6.6 0-12 5.4-12 12 0-6.6-5.4-12-12-12 6.6 0 12-5.4 12-12z" />
              </svg>
              <span
                className="font-round text-[13px] font-medium"
                style={{ color: "rgba(60,34,112,0.82)" }}>
                {t}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────── pieces ─────────────────────────────── */

/**
 * A door out of the sky: an actual cloud you press, rather than a glass
 * rectangle laid over the weather.
 *
 * The shape is <CloudCard />, stretched behind the label — `preserveAspectRatio
 * ="none"` plus a solid body under the puffs, so one cumulus covers whatever
 * the copy needs. Everything inside is violet, because the silhouette is white.
 *
 * The padding is percentages on BOTH axes (CSS resolves padding-block against
 * the width too), which is what keeps the copy inside the silhouette at any
 * aspect the stretch happens to produce. 15%/12% is measured, not guessed —
 * looser and the last line rides out over a lobe.
 */
function CloudDoor({
  title,
  desc,
  glyph,
  onClick
}: {
  title: string
  desc: string
  glyph: "plus" | "import" | "open"
  onClick: () => void
}) {
  return (
    <button onClick={onClick} className="cloud-door group relative shrink-0">
      <CloudCard />
      <span className="relative block px-[15%] pb-[15%] pt-[12%] text-center">
        <span
          className="cloud-door-disc mx-auto mb-2.5 flex items-center justify-center rounded-full"
          style={{ background: "var(--violet-deep)" }}>
          <DoorGlyph kind={glyph} />
        </span>
        <span className="cloud-door-title block font-round font-semibold leading-tight text-[var(--violet-deep)]">
          {title}
        </span>
        <span
          className="cloud-door-desc mt-1 block font-round leading-[1.45]"
          style={{ color: "rgba(78,47,142,0.68)" }}>
          {desc}
        </span>
        <span className="mt-2 inline-flex items-center gap-2 font-round text-[12px] font-semibold text-[var(--violet-deep)]">
          Begin
          <svg width="20" height="9" viewBox="0 0 22 9" fill="none" className="transition-transform duration-300 group-hover:translate-x-1">
            <path d="M0 4.5H20M20 4.5L16.5 1M20 4.5L16.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
      </span>
    </button>
  )
}

/* White ink — the glyph sits in a solid violet disc, the one dark thing on an
   otherwise white cloud. */
function DoorGlyph({ kind }: { kind: "plus" | "import" | "open" }) {
  if (kind === "plus")
    return (
      <svg width="13" height="13" viewBox="0 0 18 18" fill="none">
        <path d="M9 0V18M0 9H18" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  if (kind === "open")
    return (
      <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
        <path d="M5 9h9M14 9l-3.5-3.5M14 9l-3.5 3.5M2 2v14" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  return (
    <svg width="15" height="13" viewBox="0 0 20 18" fill="none">
      <path d="M19 9H7M7 9L11 5M7 9L11 13M1 1V17" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default Welcome
