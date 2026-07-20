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
import { CloudBank, CloudDefs, StillCloud } from "../components/brand/Clouds"
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
    <div className="relative isolate min-h-screen w-full overflow-x-hidden font-body">
      <Sky />
      <CloudDefs />
      <CloudBank layer="far" className="left-0 top-0 z-[1]" />
      <CloudBank layer="mid" className="bottom-0 left-0 z-[1]" />
      <CloudBank layer="near" className="bottom-0 left-0 z-[2]" />

      {/* ── top chrome ── */}
      <header className="relative z-40 mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-6 py-6 sm:px-10">
        <CloudChip className="gap-2.5 px-4 py-1.5">
          <AnimatedLogo className="h-8 w-8 shrink-0" />
          <MenoidWordmark tone="violet" className="h-[15px] w-auto" />
        </CloudChip>

        {/* The sky's top-right corner is its brightest point, so this needs the
            shadow to stay readable where it sits. */}
        <nav
          className="hidden items-center gap-6 font-round text-[12px] text-white/75 sm:flex"
          style={{ textShadow: "0 1px 6px rgba(48,26,96,0.5)" }}>
          <span>Est. MMXXVI</span>
          <span className="h-1 w-1 rounded-full bg-white/45" />
          <span>v0.0.1</span>
        </nav>
      </header>

      {/* ── main ── */}
      <main className="clear-clouds relative z-30 mx-auto max-w-[1180px] px-6 pt-4 sm:px-10">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-8">
          {/* ── copy + actions ── */}
          <div className="lg:col-span-7">
            <div className="mb-5 inline-flex items-center gap-2.5 rounded-full px-4 py-1.5"
              style={{
                background: "rgba(255,255,255,0.14)",
                border: "1px solid rgba(255,255,255,0.26)",
                backdropFilter: "blur(14px)"
              }}>
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-white" />
              <span className="font-round text-[12px] text-white/80">A private crypto wallet</span>
            </div>

            <h1
              className="font-round font-semibold leading-[1.06] text-white"
              style={{ fontSize: "clamp(38px, 5vw, 60px)" }}>
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

            <p className="mt-4 max-w-[440px] font-round text-[16px] leading-relaxed text-white/80">
              Keep your on-chain activity to yourself — across every chain you use.
            </p>

            {walletExists && (
              <div
                className="mt-6 flex items-center gap-3 rounded-2xl px-4 py-3"
                style={{
                  background: "rgba(255,255,255,0.14)",
                  border: "1px solid rgba(255,255,255,0.26)",
                  backdropFilter: "blur(14px)"
                }}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" />
                <p className="font-round text-[13px] text-white/80">
                  A wallet is already set up — open the extension to unlock it.
                </p>
              </div>
            )}

            {/* ── the two doors ── */}
            <div className="mt-8 grid max-w-[600px] grid-cols-1 gap-4 sm:grid-cols-2">
              {walletExists ? (
                <SetupCard
                  kicker="Already set up"
                  title="Open extension"
                  desc="Your wallet is ready. Unlock it to continue."
                  glyph="open"
                  onClick={async () => {
                    const r = await openWalletInPreferredMode()
                    if (r.opened) window.close()
                  }}
                />
              ) : (
                <SetupCard
                  kicker="Fresh start"
                  title="Create wallet"
                  desc="Generate a new private account in a minute."
                  glyph="plus"
                  onClick={() => setView("create")}
                />
              )}
              <SetupCard
                kicker="Returning"
                title="Import wallet"
                desc="Restore from a seed phrase or private key."
                glyph="import"
                onClick={() => setView("import")}
              />
            </div>

            {/* ── trust strip ── */}
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
              {["Non-custodial", "Zero-knowledge", "Multichain"].map((t) => (
                <span key={t} className="inline-flex items-center gap-2">
                  <svg className="h-2.5 w-2.5 shrink-0 fill-white/70" viewBox="0 0 24 24" aria-hidden>
                    <path d="M12 0c0 6.6 5.4 12 12 12-6.6 0-12 5.4-12 12 0-6.6-5.4-12-12-12 6.6 0 12-5.4 12-12z" />
                  </svg>
                  <span className="font-round text-[13px] text-white/65">{t}</span>
                </span>
              ))}
            </div>
          </div>

          {/* ── the mark on its cloud ── */}
          <div className="lg:col-span-5">
            <div className="relative mx-auto w-full max-w-[380px]">
              <div
                className="halo-pulse pointer-events-none absolute left-1/2 top-[34%] h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  background:
                    "radial-gradient(circle, rgba(255,255,255,0.5) 0%, rgba(240,229,254,0.24) 42%, transparent 70%)",
                  filter: "blur(20px)"
                }}
              />
              <StillCloud
                className="absolute bottom-0 left-1/2 w-[340px] -translate-x-1/2"
                style={{ filter: "drop-shadow(0 16px 26px rgba(48,26,96,0.24))" }}
              />
              <div className="relative flex justify-center pb-[86px] pt-6">
                <div className="logo-float">
                  <AnimatedLogo
                    className="h-[200px] w-[200px]"
                    style={{ filter: "drop-shadow(0 20px 26px rgba(48,26,96,0.34))" }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

/* ─────────────────────────────── pieces ─────────────────────────────── */

function SetupCard({
  kicker,
  title,
  desc,
  glyph,
  onClick
}: {
  kicker: string
  title: string
  desc: string
  glyph: "plus" | "import" | "open"
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-3xl p-5 text-left transition-transform duration-500 hover:-translate-y-1"
      style={{
        background: "rgba(255,255,255,0.15)",
        border: "1px solid rgba(255,255,255,0.28)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.34), 0 22px 50px -28px rgba(38,20,80,0.7)"
      }}>
      {/* a bloom that lights up on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(circle at 85% 12%, rgba(255,255,255,0.35), transparent 62%)"
        }}
      />

      <span className="relative flex h-9 w-9 items-center justify-center rounded-full"
        style={{ background: "rgba(255,255,255,0.22)", border: "1px solid rgba(255,255,255,0.3)" }}>
        <CardGlyph kind={glyph} />
      </span>

      <span className="relative mt-5 block font-round text-[11px] uppercase tracking-[0.28em] text-white/55">
        {kicker}
      </span>
      <span className="relative mt-1 block font-round text-[19px] font-semibold leading-tight text-white">
        {title}
      </span>
      <span className="relative mt-1.5 block font-round text-[13px] leading-[1.5] text-white/68">
        {desc}
      </span>

      <span className="relative mt-5 inline-flex items-center gap-2 font-round text-[12px] font-medium text-white/80">
        Begin
        <svg width="20" height="9" viewBox="0 0 22 9" fill="none" className="transition-transform duration-300 group-hover:translate-x-1">
          <path d="M0 4.5H20M20 4.5L16.5 1M20 4.5L16.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </span>
    </button>
  )
}

function CardGlyph({ kind }: { kind: "plus" | "import" | "open" }) {
  if (kind === "plus")
    return (
      <svg width="13" height="13" viewBox="0 0 18 18" fill="none">
        <path d="M9 0V18M0 9H18" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  if (kind === "open")
    return (
      <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
        <path d="M5 9h9M14 9l-3.5-3.5M14 9l-3.5 3.5M2 2v14" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  return (
    <svg width="15" height="13" viewBox="0 0 20 18" fill="none">
      <path d="M19 9H7M7 9L11 5M7 9L11 13M1 1V17" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default Welcome
