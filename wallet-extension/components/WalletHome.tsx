/**
 * WalletHome.tsx
 *
 * Post-unlock shell.
 *
 * Mode switching uses <ModeMorph>: when the user toggles between Open
 * and Noid, the outgoing view scales down + fades while the incoming
 * view scales up + fades in over ~420ms. No theatrical overlay, just a
 * smooth morph in place.
 *
 * Settings split into a main panel and an Account Details sub-panel,
 * which is password-gated.
 */

import React, { useEffect, useState } from "react"
import { useWallet } from "../context/WalletContext"
import {
  applyChromeBehaviour,
  getViewMode,
  setViewMode
} from "../lib/viewMode"
import AccountDetails from "./AccountDetails"
import NoidModeView from "./modes/NoidModeView"
import OpenModeView from "./modes/OpenModeView"
import ModeMorph from "./shared/ModeMorph"

type Tab = "wallet" | "activity" | "settings"
type SettingsView = "main" | "account"

export default function WalletHome() {
  const { wallet, mode, setMode, lock } = useWallet()

  const [tab, setTab] = useState<Tab>("wallet")
  const [settingsView, setSettingsView] = useState<SettingsView>("main")

  const [sidebarMode, setSidebarMode] = useState(false)
  const [toggleHint, setToggleHint] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const m = await getViewMode()
      setSidebarMode(m === "sidebar")
    })()
  }, [])

  if (!wallet) return null

  async function handleSidebarToggle(val: boolean) {
    setSidebarMode(val)
    setToggleHint(null)
    try {
      await setViewMode(val ? "sidebar" : "popup")
      await applyChromeBehaviour(val ? "sidebar" : "popup")
      if (val) {
        const win = await chrome.windows.getCurrent()
        if (win?.id !== undefined) {
          await chrome.sidePanel.open({ windowId: win.id })
        }
        window.close()
      } else {
        try {
          await chrome.action.openPopup()
          window.close()
        } catch {
          setToggleHint(
            "Popup mode is on. Click the Menoid icon in your toolbar to open it."
          )
        }
      }
    } catch (e) {
      console.error("Failed to switch view mode:", e)
    }
  }

  return (
    <div className="relative bg-cream font-body text-ink overflow-hidden flex flex-col w-[360px] h-full">
      <Backdrop mode={mode} />

      {/* ─── Header ─── */}
      <header className="relative z-20 flex items-center justify-between px-5 pt-5 pb-4 border-b border-ink/10 shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-goldDeep" />
          <span className="font-display text-[11px] font-semibold tracking-[0.3em] text-ink">
            MENOID
          </span>
        </div>

        <ModePill mode={mode} onSwitch={setMode} />

        <button
          onClick={lock}
          title="Lock"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/[0.06] hover:bg-ink/12 transition-colors">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect
              x="2"
              y="6"
              width="10"
              height="7"
              rx="1.5"
              stroke="#171311"
              strokeOpacity="0.6"
              strokeWidth="1.2"
            />
            <path
              d="M4 6V4.5a3 3 0 116 0V6"
              stroke="#171311"
              strokeOpacity="0.6"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      {/* ─── Body ─── */}
      <div className="relative z-10 flex-1 overflow-y-auto">
        {tab === "wallet" && (
          // ModeMorph diffs `keyId` against its previous value and runs
          // the scale+fade crossfade only when mode changes.
          <ModeMorph keyId={mode}>
            {mode === "open" ? <OpenModeView /> : <NoidModeView />}
          </ModeMorph>
        )}

        {tab === "activity" && (
          <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
            <span className="text-4xl mb-3">📜</span>
            <p className="font-serif italic text-[14px] text-ink/55">
              Activity is shown inline with your treasury.
            </p>
            <p className="text-[11px] text-ink/35 mt-1">
              Switch back to the Wallet tab to see it.
            </p>
          </div>
        )}

        {tab === "settings" && settingsView === "main" && (
          <SettingsMain
            mode={mode}
            sidebarMode={sidebarMode}
            toggleHint={toggleHint}
            onSidebarToggle={handleSidebarToggle}
            onModeSwitch={setMode}
            onOpenAccountDetails={() => setSettingsView("account")}
            onLock={lock}
            walletAddress={wallet.normalAccount.address}
          />
        )}

        {tab === "settings" && settingsView === "account" && (
          <AccountDetails onBack={() => setSettingsView("main")} />
        )}
      </div>

      {/* ─── Bottom nav ─── */}
      <div className="relative z-20 border-t border-ink/10 bg-cream/90 backdrop-blur-sm shrink-0">
        <div className="flex items-center justify-around px-4 py-3">
          {(
            [
              ["wallet", "◈", "Wallet"],
              ["activity", "◉", "Activity"],
              ["settings", "◎", "Settings"]
            ] as [Tab, string, string][]
          ).map(([t, icon, label]) => (
            <button
              key={t}
              onClick={() => {
                setTab(t)
                if (t !== "settings") setSettingsView("main")
              }}
              className={`flex flex-col items-center gap-1 transition-colors ${
                tab === t
                  ? "text-goldDeep"
                  : "text-ink/35 hover:text-ink/60"
              }`}>
              <span className="text-base leading-none">{icon}</span>
              <span className="text-[9px] tracking-[0.3em] uppercase">
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── Header pill ──────────────────────────── */

function ModePill({
  mode,
  onSwitch
}: {
  mode: "open" | "noid"
  onSwitch: (target: "open" | "noid") => void
}) {
  return (
    <div
      className="relative inline-flex items-center rounded-full bg-ink/[0.06] border border-ink/10 p-0.5"
      style={{ width: 116 }}>
      <span
        className="absolute top-0.5 bottom-0.5 rounded-full bg-ink transition-all duration-300 ease-out shadow-[0_2px_8px_rgba(23,19,17,0.35)]"
        style={{
          width: 54,
          left: mode === "open" ? 2 : 60
        }}
      />
      <button
        onClick={() => onSwitch("open")}
        className={`relative z-10 px-3 py-1 text-[9px] font-semibold tracking-[0.25em] uppercase transition-colors ${
          mode === "open" ? "text-bone" : "text-ink/55"
        }`}
        style={{ width: 54 }}>
        Open
      </button>
      <button
        onClick={() => onSwitch("noid")}
        className={`relative z-10 px-3 py-1 text-[9px] font-semibold tracking-[0.25em] uppercase transition-colors ${
          mode === "noid" ? "text-bone" : "text-ink/55"
        }`}
        style={{ width: 54 }}>
        Noid
      </button>
    </div>
  )
}

/* ─────────────────────────── Settings main ────────────────────────── */

function SettingsMain({
  mode,
  sidebarMode,
  toggleHint,
  onSidebarToggle,
  onModeSwitch,
  onOpenAccountDetails,
  onLock,
  walletAddress
}: {
  mode: "open" | "noid"
  sidebarMode: boolean
  toggleHint: string | null
  onSidebarToggle: (v: boolean) => void
  onModeSwitch: (t: "open" | "noid") => void
  onOpenAccountDetails: () => void
  onLock: () => void
  walletAddress: string
}) {
  function trunc(s: string, a = 6, b = 4) {
    return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
  }
  return (
    <div className="px-5 pt-6 pb-6 space-y-3">
      <p className="text-[9px] tracking-[0.4em] uppercase text-ink/40 mb-2">
        Settings
      </p>

      <button
        onClick={onOpenAccountDetails}
        className="w-full text-left p-4 rounded-2xl bg-ink/[0.04] border border-ink/10 hover:border-goldDeep/40 hover:bg-goldDeep/5 transition-all">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-goldDeep/15 border border-goldDeep/25">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="4" cy="7" r="2.2" stroke="#A36E14" strokeWidth="1.3" />
              <path
                d="M6.2 7H13M11.5 7v2M9.5 7v1.4"
                stroke="#A36E14"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold">Account Details</p>
            <p className="text-[11px] text-ink/50 mt-0.5 leading-snug">
              Reveal your keys & recovery phrase
            </p>
          </div>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M3 1L7 5L3 9"
              stroke="#171311"
              strokeOpacity="0.35"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </button>

      <div className="p-4 rounded-2xl bg-ink/[0.04] border border-ink/10">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">Sidebar Mode</p>
            <p className="text-[11px] text-ink/50 mt-0.5 leading-snug">
              Show wallet as a side panel
            </p>
          </div>
          <Switch
            checked={sidebarMode}
            onChange={(v) => onSidebarToggle(v)}
          />
        </div>
        {toggleHint && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-xl bg-goldDeep/10 border border-goldDeep/25">
            <span className="h-1.5 w-1.5 rounded-full bg-goldDeep shrink-0 mt-1.5" />
            <p className="text-[11px] text-ink/75 leading-snug">{toggleHint}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-ink/[0.04] border border-ink/10">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">Noid Mode</p>
          <p className="text-[11px] text-ink/50 mt-0.5 leading-snug">
            Show ZK / Menoid-derived keys
          </p>
        </div>
        <Switch
          checked={mode === "noid"}
          onChange={(v) => onModeSwitch(v ? "noid" : "open")}
        />
      </div>

      <div className="p-4 rounded-2xl bg-ink/[0.04] border border-ink/10 space-y-2">
        <p className="text-[10px] tracking-[0.3em] uppercase text-ink/40">
          Open Account
        </p>
        <InfoRow label="Address" value={trunc(walletAddress)} />
        <InfoRow label="Network" value="Monad" />
      </div>

      <button
        onClick={onLock}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-ink/15 text-[12px] tracking-[0.2em] uppercase text-ink/60 hover:border-red-400/40 hover:text-red-500 transition-colors">
        <svg width="13" height="14" viewBox="0 0 13 14" fill="none">
          <rect
            x="1.5"
            y="6"
            width="10"
            height="7"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M3.5 6V4.5a3 3 0 116 0V6"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        Lock Wallet
      </button>
    </div>
  )
}

function Switch({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{ width: 40, height: 22 }}
      className={`relative shrink-0 inline-flex items-center rounded-full transition-colors duration-300 ${
        checked ? "bg-goldDeep" : "bg-ink/20"
      }`}>
      <span
        style={{
          width: 16,
          height: 16,
          transform: checked ? "translateX(21px)" : "translateX(3px)"
        }}
        className="absolute rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-300"
      />
    </button>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-ink/40">{label}</span>
      <span className="text-[11px] font-mono text-ink/70">{value}</span>
    </div>
  )
}

function Backdrop({ mode }: { mode: "open" | "noid" }) {
  return (
    <>
      <div className="absolute inset-0 bg-gradient-to-b from-[#FBF1D9] via-cream to-parchment" />
      <div
        className="pointer-events-none absolute inset-0 transition-colors duration-700"
        style={{
          backgroundImage:
            mode === "noid"
              ? "radial-gradient(ellipse at 50% 0%, rgba(74,108,182,0.18) 0%, rgba(246,233,208,0) 55%)"
              : "radial-gradient(ellipse at 50% 0%, rgba(232,174,58,0.2) 0%, rgba(246,233,208,0) 55%)"
        }}
      />
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-25" />
    </>
  )
}