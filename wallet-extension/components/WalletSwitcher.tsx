/**
 * WalletSwitcher.tsx
 *
 * Full-screen modal listing every saved wallet.
 *
 * Per-card layout:
 *   [ # badge ]  [ in-wallet label (editable) ]  [ Active ]
 *                [ username — loading / set / read-only ]
 *                [ address / key ]
 *
 * Username logic:
 *   - On open: immediately fetch /users/all (open mode) or /noidusers/all
 *     (noid mode) to pre-populate names. Show "Loading name…" skeleton while
 *     in flight, then the real name (gold, read-only) or "Set username" button.
 *   - If NOT set: show "Set username" button that expands inline.
 *   - Only the in-wallet label (entry.name) can be renamed at any time.
 *   - Usernames posted to /api/users or /api/noidusers on save.
 */

import React, { useEffect, useRef, useState } from "react"
import { useWallet } from "../context/WalletContext"
import AddWalletInline from "./AddWalletInline"
import { patchWalletInName, readWalletsState, writeWalletsState } from "../lib/wallets"
import {
  checkNoidNameAvailable,
  checkOpenNameAvailable,
  createNoidUserApi,
  createOpenUser,
} from "../services/users"
import { ensureMenoSuffix } from "../lib/wallets"

type View = "list" | "add"
type AvailState = "idle" | "checking" | "available" | "taken" | "error"
interface Props {
  open: boolean
  onClose: () => void
}

export default function WalletSwitcher({ open, onClose }: Props) {
  const { wallets, entries, activeIndex, switchWallet, mode, refreshEntries, openNamesMap, noidNamesMap, namesLoading, refreshNames } = useWallet()
  const isNoid = mode === "noid"

  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [view, setView] = useState<View>("list")


  // ── In-wallet label rename ──
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null)
  const [editingLabelValue, setEditingLabelValue] = useState("")
  const [editLabelSaving, setEditLabelSaving] = useState(false)

  // ── Username setup (for accounts with no username) ──
  const [settingUsernameId, setSettingUsernameId] = useState<string | null>(null)
  const [usernameInput, setUsernameInput] = useState("")
  const [usernameAvail, setUsernameAvail] = useState<AvailState>("idle")
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [usernameErr, setUsernameErr] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)


  useEffect(() => {
    if (open) {
      setMounted(true)
      setView("list")
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    } else if (mounted) {
      setVisible(false)
      const t = setTimeout(() => {
        setMounted(false)
        setView("list")
        setEditingLabelId(null)
        setSettingUsernameId(null)
      }, 360)
      return () => clearTimeout(t)
    }
  }, [open, mounted])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (settingUsernameId) { cancelUsernameSetup(); return }
        if (editingLabelId) { setEditingLabelId(null); return }
        onClose()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose, editingLabelId, settingUsernameId])

  if (!mounted) return null

  // ── Resolve name for a given entry using context name maps ──
  function resolveEntryName(e: typeof entries[0]): string {
    const keyLower = (mode === "open" ? e.openAddress : e.noidPublicKey).toLowerCase()
    const fromContext = mode === "open" ? openNamesMap[keyLower] : noidNamesMap[keyLower]
    if (fromContext) return fromContext
    // Fallback: what's stored in the wallet entry itself
    const stored = mode === "open" ? e.openName : e.noidName
    return stored ?? ""
  }

  // ── Label rename ──
  function startLabelEdit(id: string, current: string) {
    setEditingLabelId(id)
    setEditingLabelValue(current)
  }

  async function commitLabelEdit(id: string) {
    if (!editingLabelValue.trim()) return
    setEditLabelSaving(true)
    try {
      await patchWalletInName(id, editingLabelValue.trim())
      if (refreshEntries) await refreshEntries()
    } catch (e) {
      console.error("Failed to save label:", e)
    } finally {
      setEditLabelSaving(false)
      setEditingLabelId(null)
    }
  }

  // ── Username setup ──
  function startUsernameSetup(id: string) {
    setSettingUsernameId(id)
    setUsernameInput("")
    setUsernameAvail("idle")
    setUsernameErr("")
  }

  function cancelUsernameSetup() {
    setSettingUsernameId(null)
    setUsernameInput("")
    setUsernameAvail("idle")
    setUsernameErr("")
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }

  function handleUsernameInputChange(val: string) {
    setUsernameInput(val)
    setUsernameErr("")
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!val.trim()) { setUsernameAvail("idle"); return }
    const withMeno = ensureMenoSuffix(val)
    setUsernameAvail("checking")
    debounceRef.current = setTimeout(async () => {
      try {
        const avail = mode === "open"
          ? await checkOpenNameAvailable(withMeno)
          : await checkNoidNameAvailable(withMeno)
        setUsernameAvail(avail ? "available" : "taken")
      } catch {
        setUsernameAvail("error")
      }
    }, 500)
  }

  async function commitUsernameSetup(entryId: string) {
    if (!usernameInput.trim()) { setUsernameErr("Please enter a username."); return }
    if (usernameAvail === "taken") { setUsernameErr("This username is already taken."); return }
    if (usernameAvail === "checking") { setUsernameErr("Still checking availability…"); return }

    const withMeno = ensureMenoSuffix(usernameInput)
    setUsernameSaving(true)
    setUsernameErr("")
    try {
      const state = await readWalletsState()
      if (!state) throw new Error("No wallet state found.")
      const entry = state.list.find((e) => e.id === entryId)
      if (!entry) throw new Error("Entry not found.")

      if (mode === "open") {
        await createOpenUser({ name: withMeno, realAddress: entry.openAddress })
        entry.openName = withMeno
        entry.registeredOpen = true
      } else {
        await createNoidUserApi({
          name: withMeno,
          noidModePublicKey: entry.noidPublicKey,
          zkPublicKey: entry.zkPublicKey
        })
        entry.noidName = withMeno
        entry.registeredNoid = true
      }

      await writeWalletsState(state)
      if (refreshEntries) await refreshEntries()
      // Re-fetch names so all cards reflect the new name immediately
      void refreshNames()
      cancelUsernameSetup()
    } catch (e: any) {
      const msg = e?.message ?? "Failed to save username."
      if (msg.toLowerCase().includes("already exists")) {
        setUsernameErr("This username is already registered.")
      } else {
        setUsernameErr(msg)
      }
    } finally {
      setUsernameSaving(false)
    }
  }

  return (
    <div className={`absolute inset-0 z-40 transition-all duration-[360ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
      visible ? "opacity-100 scale-100" : "opacity-0 scale-[0.96] pointer-events-none"
    }`}>
      <div className={`absolute inset-0 flex flex-col ${isNoid ? "bg-ink text-bone" : "bg-cream text-ink"}`}>
        {/* backdrop wash */}
        <div className="pointer-events-none absolute inset-0 opacity-60" style={{
          backgroundImage: isNoid
            ? "radial-gradient(ellipse at 50% 0%, rgba(232,174,58,0.18) 0%, rgba(23,19,17,0) 55%)"
            : "radial-gradient(ellipse at 50% 0%, rgba(232,174,58,0.2) 0%, rgba(246,233,208,0) 55%)"
        }} />
        <div className="pointer-events-none absolute inset-0 paper-grain" style={{ opacity: isNoid ? 0.08 : 0.22 }} />

        {/* header */}
        <div className={`relative flex items-center justify-between px-5 py-4 border-b shrink-0 ${isNoid ? "border-bone/10" : "border-ink/10"}`}>
          <button
            onClick={onClose}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${isNoid ? "bg-bone/[0.08] hover:bg-bone/[0.18]" : "bg-ink/[0.06] hover:bg-ink/12"}`}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <p className={`font-display text-[12px] font-semibold tracking-[0.25em] uppercase ${isNoid ? "text-bone" : "text-ink"}`}>
            {view === "list" ? "Accounts" : "Add account"}
          </p>
          <span className="w-8" />
        </div>

        {/* body */}
        <div className="relative flex-1 overflow-hidden">
          {view === "list" && (
            <div className="h-full overflow-y-auto px-5 py-5">
              <p className={`text-[9px] tracking-[0.35em] uppercase mb-3 ${isNoid ? "text-bone/45" : "text-ink/45"}`}>
                {entries.length} {entries.length === 1 ? "account" : "accounts"} · {isNoid ? "noid mode" : "open mode"}
              </p>

              <div className="space-y-2">
                {entries.map((e, i) => {
                  const isActive = i === activeIndex
                  const resolvedName = resolveEntryName(e)
                  const modeAddress = mode === "open" ? e.openAddress : e.noidPublicKey
                  const isEditingLabel = editingLabelId === e.id
                  const isSettingUsername = settingUsernameId === e.id

                  // Selected account = a mini treasure card (dark for open, light
                  // for noid) with grid; its content flips to contrast.
                  const fg = isActive
                    ? (isNoid ? "23,19,17" : "244,231,204")
                    : (isNoid ? "250,245,233" : "23,19,17")
                  const activeCardBg = isNoid
                    ? "linear-gradient(145deg, #FBF1D9 0%, #F0E0B6 55%, #EAD5A7 100%)"
                    : "linear-gradient(145deg, #1A1410 0%, #0D0A07 60%, #171311 100%)"
                  const activeGrid = isNoid ? "#171311" : "#FBF1D9"

                  return (
                    <button
                      key={e.id}
                      onClick={async () => {
                        if (editingLabelId || settingUsernameId) return
                        if (!isActive) await switchWallet(i)
                        onClose()
                      }}
                      className={`relative overflow-hidden w-full text-left p-4 rounded-2xl border transition-all duration-200 hover:-translate-y-[1px] ${
                        isActive
                          ? isNoid ? "border-[#EAD5A7]/55 shadow-[0_10px_28px_-12px_rgba(163,110,20,0.4)]" : "border-[#3A2C1C]/60 shadow-[0_10px_28px_-12px_rgba(0,0,0,0.7)]"
                          : isNoid ? "bg-[#F4E7CC]/[0.05] border-bone/15 hover:border-bone/30" : "bg-ink/[0.04] border-ink/10 hover:border-ink/25"
                      }`}
                      style={isActive ? { background: activeCardBg } : undefined}>
                      {isActive && (
                        <>
                          <div className="pointer-events-none absolute inset-0" style={{
                            backgroundImage: `linear-gradient(to right,${activeGrid} 1px,transparent 1px),linear-gradient(to bottom,${activeGrid} 1px,transparent 1px)`,
                            backgroundSize: "22px 22px",
                            opacity: isNoid ? 0.05 : 0.04
                          }} />
                          <div className="pointer-events-none absolute inset-0 paper-grain" style={{ opacity: isNoid ? 0.26 : 0.12 }} />
                        </>
                      )}
                      <div className="relative flex items-start gap-3">

                        {/* Number badge */}
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-[13px] font-bold mt-0.5 border"
                          style={{
                            background: `rgba(${fg},0.14)`,
                            borderColor: `rgba(${fg},0.22)`,
                            color: `rgba(${fg},0.95)`
                          }}>
                          {i + 1}
                        </div>

                        <div className="min-w-0 flex-1">

                          {/* ── In-wallet label row ── */}
                          {isEditingLabel ? (
                            <div className="flex items-center gap-1.5 mb-1" onClick={(ev) => ev.stopPropagation()}>
                              <input
                                autoFocus
                                value={editingLabelValue}
                                onChange={(ev) => setEditingLabelValue(ev.target.value)}
                                onKeyDown={(ev) => {
                                  if (ev.key === "Enter") commitLabelEdit(e.id)
                                  if (ev.key === "Escape") setEditingLabelId(null)
                                }}
                                placeholder="Account label"
                                className={`flex-1 min-w-0 rounded-lg px-2 py-1 text-[12px] focus:outline-none transition-colors ${
                                  isNoid
                                    ? "bg-bone/[0.1] border border-bone/25 text-bone placeholder-bone/35 focus:border-gold/60"
                                    : "bg-ink/[0.07] border border-ink/15 text-ink placeholder-ink/35 focus:border-goldDeep/60"
                                }`}
                              />
                              <button
                                onClick={(ev) => { ev.stopPropagation(); commitLabelEdit(e.id) }}
                                disabled={editLabelSaving}
                                className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold uppercase transition-colors ${
                                  isNoid ? "bg-bone text-ink hover:bg-bone/90" : "bg-goldDeep text-bone hover:bg-goldDeep/90"
                                }`}>
                                {editLabelSaving ? "…" : "Save"}
                              </button>
                              <button
                                onClick={(ev) => { ev.stopPropagation(); setEditingLabelId(null) }}
                                className={`shrink-0 text-[12px] px-1.5 transition-colors ${isNoid ? "text-bone/50 hover:text-bone" : "text-ink/50 hover:text-ink"}`}>
                                ✕
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-display text-[13px] font-semibold truncate" style={{ color: `rgba(${fg},0.96)` }}>
                                {e.name}
                              </p>
                              {isActive && (
                                <span className="text-[8px] tracking-[0.3em] uppercase shrink-0" style={{ color: `rgba(${fg},0.6)` }}>Active</span>
                              )}
                              {/* Rename button */}
                              <button
                                onClick={(ev) => { ev.stopPropagation(); startLabelEdit(e.id, e.name) }}
                                className="shrink-0 text-[9px] tracking-[0.2em] uppercase px-1.5 py-0.5 rounded transition-opacity hover:opacity-100"
                                style={{ color: `rgba(${fg},0.45)`, opacity: 0.85 }}>
                                rename
                              </button>
                            </div>
                          )}

 

                          {/* Address / key */}
                          <p className="text-[10px] font-mono truncate mt-0.5" style={{ color: `rgba(${fg},0.5)` }}>
                            {modeAddress.slice(0, 10)}…{modeAddress.slice(-6)}
                          </p>
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
                  <path d="M7 1V13M1 7H13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                <span className="font-display text-[12px] font-semibold tracking-[0.15em] uppercase">Add account</span>
              </button>
            </div>
          )}

          {view === "add" && (
            <AddWalletInline
              onClose={() => setView("list")}
              onAdded={() => { setView("list"); onClose() }}
            />
          )}
        </div>
      </div>
    </div>
  )
}