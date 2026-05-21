/**
 * WalletSwitcher.tsx
 *
 * Full-screen modal that lists every saved wallet, lets the user switch
 * the active one, and exposes an "Add account" path that opens the
 * inline create / import flow.
 *
 * The modal is rendered as `absolute inset-0` inside WalletHome (NOT
 * portalled) so it covers the wallet popup but stays inside the same
 * stacking context as the rest of the home shell — that's what gives
 * the smooth "expand from the chip" feel.
 */

import React, { useEffect, useState } from "react"
import { useWallet } from "../context/WalletContext"
import AddWalletInline from "./AddWalletInline"

type View = "list" | "add"

interface Props {
  open: boolean
  onClose: () => void
}

export default function WalletSwitcher({ open, onClose }: Props) {
  const { wallets, entries, activeIndex, switchWallet, mode } = useWallet()
  const isNoid = mode === "noid"

  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [view, setView] = useState<View>("list")

  // Two-phase enter / exit so the open + close transitions both run.
  useEffect(() => {
    if (open) {
      setMounted(true)
      setView("list")
      // double rAF — guarantees the initial (hidden) class lands first,
      // then we flip to the visible class on the next paint
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setVisible(true))
      )
    } else if (mounted) {
      setVisible(false)
      const t = setTimeout(() => {
        setMounted(false)
        setView("list")
      }, 360)
      return () => clearTimeout(t)
    }
  }, [open, mounted])

  // ESC closes the modal
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  if (!mounted) return null

  return (
    <div
      className={`absolute inset-0 z-40 transition-all duration-[360ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
        visible
          ? "opacity-100 scale-100"
          : "opacity-0 scale-[0.96] pointer-events-none"
      }`}>
      <div
        className={`absolute inset-0 flex flex-col ${
          isNoid ? "bg-ink text-bone" : "bg-cream text-ink"
        }`}>
        {/* faint backdrop wash that matches WalletHome's vibe */}
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage: isNoid
              ? "radial-gradient(ellipse at 50% 0%, rgba(232,174,58,0.18) 0%, rgba(23,19,17,0) 55%)"
              : "radial-gradient(ellipse at 50% 0%, rgba(232,174,58,0.2) 0%, rgba(246,233,208,0) 55%)"
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 paper-grain"
          style={{ opacity: isNoid ? 0.08 : 0.22 }}
        />

        {/* header */}
        <div
          className={`relative flex items-center justify-between px-5 py-4 border-b shrink-0 ${
            isNoid ? "border-bone/10" : "border-ink/10"
          }`}>
          <button
            onClick={onClose}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
              isNoid
                ? "bg-bone/[0.08] hover:bg-bone/[0.18]"
                : "bg-ink/[0.06] hover:bg-ink/12"
            }`}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 2L10 10M10 2L2 10"
                stroke="currentColor"
                strokeOpacity="0.7"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <p
            className={`font-display text-[12px] font-semibold tracking-[0.25em] uppercase ${
              isNoid ? "text-bone" : "text-ink"
            }`}>
            {view === "list" ? "Accounts" : "Add account"}
          </p>
          <span className="w-8" />
        </div>

        {/* body */}
        <div className="relative flex-1 overflow-hidden">
          {view === "list" && (
            <div className="h-full overflow-y-auto px-5 py-5">
              <p
                className={`text-[9px] tracking-[0.35em] uppercase mb-3 ${
                  isNoid ? "text-bone/45" : "text-ink/45"
                }`}>
                {entries.length}{" "}
                {entries.length === 1 ? "account" : "accounts"} on this
                device
              </p>

              <div className="space-y-2">
                {entries.map((e, i) => {
                  const isActive = i === activeIndex
                  return (
                    <button
                      key={e.id}
                      onClick={async () => {
                        if (!isActive) await switchWallet(i)
                        onClose()
                      }}
                      className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 hover:-translate-y-[1px] ${
                        isActive
                          ? isNoid
                            ? "bg-goldDeep/[0.18] border-goldDeep/45"
                            : "bg-goldDeep/[0.12] border-goldDeep/45"
                          : isNoid
                            ? "bg-bone/[0.04] border-bone/15 hover:border-bone/30"
                            : "bg-ink/[0.04] border-ink/10 hover:border-ink/25"
                      }`}>
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-[13px] font-bold ${
                            isActive
                              ? "bg-goldDeep text-bone"
                              : isNoid
                                ? "bg-bone/[0.1] text-bone/75 border border-bone/15"
                                : "bg-ink/[0.06] text-ink/75 border border-ink/12"
                          }`}>
                          {i + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p
                              className={`font-display text-[13px] font-semibold truncate ${
                                isNoid ? "text-bone" : "text-ink"
                              }`}>
                              {e.name}
                            </p>
                            {isActive && (
                              <span className="text-[8px] tracking-[0.3em] uppercase text-goldDeep">
                                Active
                              </span>
                            )}
                          </div>
                          <p
                            className={`text-[10px] font-mono mt-0.5 truncate ${
                              isNoid ? "text-bone/55" : "text-ink/55"
                            }`}>
                            {e.openAddress.slice(0, 10)}…
                            {e.openAddress.slice(-6)}
                          </p>
                          <div className="mt-1.5 flex items-center gap-2 text-[9px]">
                            <span
                              className={`px-1.5 py-0.5 rounded-md tracking-[0.2em] uppercase ${
                                e.registeredOpen
                                  ? "bg-emerald-500/15 text-emerald-700"
                                  : isNoid
                                    ? "bg-bone/[0.08] text-bone/45"
                                    : "bg-ink/[0.06] text-ink/45"
                              }`}>
                              Open {e.registeredOpen ? "·linked" : "·offline"}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded-md tracking-[0.2em] uppercase ${
                                e.registeredNoid
                                  ? "bg-emerald-500/15 text-emerald-700"
                                  : isNoid
                                    ? "bg-bone/[0.08] text-bone/45"
                                    : "bg-ink/[0.06] text-ink/45"
                              }`}>
                              Noid {e.registeredNoid ? "·linked" : "·offline"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              <button
                onClick={() => setView("add")}
                className={`mt-5 w-full rounded-2xl border border-dashed py-4 flex items-center justify-center gap-2 transition-all hover:-translate-y-[1px] ${
                  isNoid
                    ? "border-bone/25 text-bone/70 hover:border-gold/60 hover:text-bone"
                    : "border-ink/20 text-ink/65 hover:border-goldDeep/60 hover:text-ink"
                }`}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M7 1V13M1 7H13"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="font-display text-[12px] font-semibold tracking-[0.15em] uppercase">
                  Add account
                </span>
              </button>
            </div>
          )}

          {view === "add" && (
            <AddWalletInline
              onClose={() => setView("list")}
              onAdded={() => {
                setView("list")
                onClose()
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
