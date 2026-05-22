/**
 * WalletSwitcherModal.tsx
 *
 * Updated to show separate Open and Noid account names. If a name isn't set,
 * show "Set up name" button for that account.
 */

import React, { useEffect, useMemo, useState } from "react"
import { useWallet } from "../context/WalletContext"
import ModalPortal from "./shared/ModalPortal"
import CreateWallet from "./CreateWallet"
import ImportWallet from "./ImportWallet"

interface Props {
  open: boolean
  onClose: () => void
}

type View = "list" | "addChoice" | "addCreate" | "addImport"

export default function WalletSwitcherModal({ open, onClose }: Props) {
  const { wallets, entries, activeId, switchActiveWallet, mode } = useWallet()

  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [view, setView] = useState<View>("list")
  const [editingNameId, setEditingNameId] = useState<string | null>(null)
  const [editingMode, setEditingMode] = useState<"open" | "noid" | null>(null)
  const [editingValue, setEditingValue] = useState("")

  // mount/unmount with transition
  useEffect(() => {
    if (open) {
      setMounted(true)
      setView("list")
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setVisible(true))
      )
    } else if (mounted) {
      setVisible(false)
      const t = setTimeout(() => {
        setMounted(false)
        setView("list")
      }, 340)
      return () => clearTimeout(t)
    }
  }, [open, mounted])

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [open, onClose])

  if (!mounted) return null

  async function pickWallet(id: string) {
    if (id !== activeId) await switchActiveWallet(id)
    onClose()
  }

  async function saveAccountName(
    walletId: string,
    accountMode: "open" | "noid",
    name: string
  ) {
    try {
      const r = await chrome.storage.local.get("menoid_wallets")
      if (r?.menoid_wallets) {
        const parsed = JSON.parse(r.menoid_wallets)
        const entry = parsed.list.find((e: any) => e.id === walletId)
        if (entry) {
          if (accountMode === "open") {
            entry.openName = name.trim() || undefined
          } else {
            entry.noidName = name.trim() || undefined
          }
          await chrome.storage.local.set({
            menoid_wallets: JSON.stringify(parsed)
          })
          setEditingNameId(null)
          setEditingMode(null)
          setEditingValue("")
          // Trigger a re-render by updating state
          window.dispatchEvent(new Event("wallet-names-updated"))
        }
      }
    } catch (e) {
      console.error("Failed to save account name:", e)
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[2147483000] overflow-hidden">
        {/* dim layer */}
        <div
          className={`absolute inset-0 bg-ink/55 backdrop-blur-sm transition-opacity duration-[340ms] ${
            visible ? "opacity-100" : "opacity-0"
          }`}
          onClick={onClose}
        />

        {/* fullscreen panel */}
        <div
          className={`relative h-full w-full bg-cream flex flex-col transition-all duration-[340ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            visible
              ? "scale-100 opacity-100"
              : "scale-[0.96] opacity-0"
          }`}>
          <Backdrop />

          {/* Header */}
          <div className="relative z-20 flex items-center justify-between px-5 pt-5 pb-4 border-b border-ink/10 shrink-0">
            {view === "list" ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-goldDeep" />
                  <span className="font-display text-[11px] font-semibold tracking-[0.3em] text-ink">
                    WALLETS
                  </span>
                </div>
                <button
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/[0.06] hover:bg-ink/12 transition-colors">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 2L10 10M10 2L2 10"
                      stroke="#171311"
                      strokeOpacity="0.7"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setView("list")}
                  className="flex items-center gap-2 text-[11px] tracking-[0.3em] uppercase text-ink/55 hover:text-ink transition-colors">
                  <svg width="16" height="9" viewBox="0 0 18 9" fill="none">
                    <path
                      d="M18 4.5H2M2 4.5L5.5 1M2 4.5L5.5 8"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                    />
                  </svg>
                  Back
                </button>
                <button
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/[0.06] hover:bg-ink/12 transition-colors">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 2L10 10M10 2L2 10"
                      stroke="#171311"
                      strokeOpacity="0.7"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Body */}
          <div className="relative z-10 flex-1 overflow-y-auto">
            {view === "list" && (
              <WalletList
                wallets={wallets}
                entries={entries}
                activeId={activeId}
                currentMode={mode}
                onPick={pickWallet}
                onAddClick={() => setView("addChoice")}
                editingNameId={editingNameId}
                editingMode={editingMode}
                editingValue={editingValue}
                onStartEdit={(id, m) => {
                  setEditingNameId(id)
                  setEditingMode(m)
                  const entry = entries.find(e => e.id === id)
                  if (m === "open") {
                    setEditingValue(entry?.openName || "")
                  } else {
                    setEditingValue(entry?.noidName || "")
                  }
                }}
                onSaveName={(id, m, name) => saveAccountName(id, m, name)}
                onCancelEdit={() => {
                  setEditingNameId(null)
                  setEditingMode(null)
                  setEditingValue("")
                }}
              />
            )}

            {view === "addChoice" && (
              <AddChoice
                onCreate={() => setView("addCreate")}
                onImport={() => setView("addImport")}
              />
            )}

            {view === "addCreate" && (
              <div className="-mt-4">
                <CreateWallet
                  onBack={() => setView("addChoice")}
                />
              </div>
            )}

            {view === "addImport" && (
              <div className="-mt-4">
                <ImportWallet
                  onBack={() => setView("addChoice")}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

// ──────────────────────────────────────────────────────────────────────────

function WalletList({
  wallets,
  entries,
  activeId,
  currentMode,
  onPick,
  onAddClick,
  editingNameId,
  editingMode,
  editingValue,
  onStartEdit,
  onSaveName,
  onCancelEdit
}: {
  wallets: any[]
  entries: any[]
  activeId: string | null
  currentMode: "open" | "noid"
  onPick: (id: string) => void
  onAddClick: () => void
  editingNameId: string | null
  editingMode: "open" | "noid" | null
  editingValue: string
  onStartEdit: (id: string, mode: "open" | "noid") => void
  onSaveName: (id: string, mode: "open" | "noid", name: string) => void
  onCancelEdit: () => void
}) {
  return (
    <div className="px-5 py-5 space-y-3">
      <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-1">
        Your wallets
      </p>
      <p className="text-[12px] text-ink/55 mb-2 leading-relaxed">
        Tap a wallet to switch. All are encrypted with the same password.
      </p>

      {entries.map((entry, idx) => {
        const wallet = wallets[idx]
        return (
          <WalletCard
            key={entry.id}
            entry={entry}
            wallet={wallet}
            index={idx + 1}
            isActive={entry.id === activeId}
            currentMode={currentMode}
            onPick={() => onPick(entry.id)}
            isEditing={editingNameId === entry.id}
            editingMode={editingMode}
            editingValue={editingValue}
            onStartEdit={(mode) => onStartEdit(entry.id, mode)}
            onSaveName={(mode, name) => onSaveName(entry.id, mode, name)}
            onCancelEdit={onCancelEdit}
          />
        )
      })}

      <button
        onClick={onAddClick}
        className="mt-2 w-full flex items-center justify-center gap-2 py-4 rounded-2xl border border-dashed border-goldDeep/40 text-goldDeep hover:bg-goldDeep/8 transition-colors">
        <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
          <path
            d="M9 0V18M0 9H18"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        Add Wallet
      </button>
    </div>
  )
}

interface WalletCardProps {
  entry: any
  wallet: any
  index: number
  isActive: boolean
  currentMode: "open" | "noid"
  onPick: () => void
  isEditing: boolean
  editingMode: "open" | "noid" | null
  editingValue: string
  onStartEdit: (mode: "open" | "noid") => void
  onSaveName: (mode: "open" | "noid", name: string) => void
  onCancelEdit: () => void
}

function WalletCard({
  entry,
  wallet,
  index,
  isActive,
  currentMode,
  onPick,
  isEditing,
  editingMode,
  editingValue,
  onStartEdit,
  onSaveName,
  onCancelEdit
}: WalletCardProps) {
  const [copiedOpen, setCopiedOpen] = useState(false)
  const [copiedNoid, setCopiedNoid] = useState(false)

  function copy(value: string, which: "open" | "noid") {
    navigator.clipboard.writeText(value)
    if (which === "open") {
      setCopiedOpen(true)
      setTimeout(() => setCopiedOpen(false), 1400)
    } else {
      setCopiedNoid(true)
      setTimeout(() => setCopiedNoid(false), 1400)
    }
  }

  const open = wallet?.normalAccount
  const noid = wallet?.noidAccount

  // Determine which name to display based on current mode
  const displayedAccountName = currentMode === "open" ? entry.openName : entry.noidName
  const displayedAddress = currentMode === "open" ? open?.address : noid?.zkPublicKey || noid?.publicKey

  return (
    <div
      onClick={onPick}
      className={`relative w-full text-left rounded-2xl border transition-all duration-300 cursor-pointer overflow-hidden ${
        isActive
          ? "bg-ink text-bone border-ink shadow-[0_18px_36px_-18px_rgba(23,19,17,0.5)]"
          : "bg-bone text-ink border-ink/10 hover:border-goldDeep/40 hover:-translate-y-[1px]"
      }`}>
      <div
        className={`pointer-events-none absolute inset-0 ${
          isActive
            ? "bg-[radial-gradient(circle_at_85%_15%,_rgba(232,174,58,0.32),transparent_60%)]"
            : ""
        }`}
      />

      <div className="relative p-4">
        <div className="flex items-start gap-3">
          {/* Index badge */}
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-display font-bold ${
              isActive
                ? "bg-goldDeep text-bone ring-2 ring-gold/30"
                : "bg-goldDeep/15 text-goldDeep ring-1 ring-goldDeep/25"
            }`}>
            {index}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="font-display text-[14px] font-semibold truncate">
                {entry.name || `Wallet ${index}`}
              </p>
              {isActive && (
                <span
                  className={`shrink-0 text-[9px] tracking-[0.3em] uppercase px-2 py-0.5 rounded-full bg-gold/20 text-gold border border-gold/30`}>
                  Active
                </span>
              )}
            </div>

            {/* Account names based on mode */}
            {isEditing && editingMode === "open" && currentMode === "open" ? (
              <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  type="text"
                  value={editingValue}
                  onChange={(e) => {
                    // Allow prop update from parent
                  }}
                  placeholder="Enter open account name"
                  className={`flex-1 px-2 py-1 rounded text-[11px] border focus:outline-none focus:ring-2 ${
                    isActive
                      ? "bg-bone/10 border-bone/30 text-bone focus:ring-gold/50"
                      : "bg-ink/10 border-ink/30 text-ink focus:ring-goldDeep/50"
                  }`}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onSaveName("open", editingValue)
                  }}
                  className={`px-2 py-1 rounded text-[9px] font-semibold uppercase transition-colors ${
                    isActive
                      ? "bg-gold text-ink hover:bg-gold/90"
                      : "bg-goldDeep text-bone hover:bg-goldDeep/90"
                  }`}>
                  Save
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCancelEdit()
                  }}
                  className={`px-2 py-1 rounded text-[9px] font-semibold uppercase border transition-colors ${
                    isActive
                      ? "border-bone/30 text-bone hover:bg-bone/10"
                      : "border-ink/30 text-ink hover:bg-ink/10"
                  }`}>
                  Cancel
                </button>
              </div>
            ) : isEditing && editingMode === "noid" && currentMode === "noid" ? (
              <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  type="text"
                  value={editingValue}
                  onChange={(e) => {
                    // Allow prop update from parent
                  }}
                  placeholder="Enter noid account name"
                  className={`flex-1 px-2 py-1 rounded text-[11px] border focus:outline-none focus:ring-2 ${
                    isActive
                      ? "bg-bone/10 border-bone/30 text-bone focus:ring-gold/50"
                      : "bg-ink/10 border-ink/30 text-ink focus:ring-goldDeep/50"
                  }`}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onSaveName("noid", editingValue)
                  }}
                  className={`px-2 py-1 rounded text-[9px] font-semibold uppercase transition-colors ${
                    isActive
                      ? "bg-gold text-ink hover:bg-gold/90"
                      : "bg-goldDeep text-bone hover:bg-goldDeep/90"
                  }`}>
                  Save
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCancelEdit()
                  }}
                  className={`px-2 py-1 rounded text-[9px] font-semibold uppercase border transition-colors ${
                    isActive
                      ? "border-bone/30 text-bone hover:bg-bone/10"
                      : "border-ink/30 text-ink hover:bg-ink/10"
                  }`}>
                  Cancel
                </button>
              </div>
            ) : (
              <div
                className={`text-[11px] mt-0.5 flex items-center gap-2 truncate ${
                  isActive ? "text-bone/55" : "text-ink/50"
                }`}>
                {displayedAccountName ? (
                  <>
                    <span className="font-semibold">{displayedAccountName}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onStartEdit(currentMode)
                      }}
                      className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
                        isActive
                          ? "text-bone/60 hover:text-bone hover:bg-bone/10"
                          : "text-ink/60 hover:text-ink hover:bg-ink/10"
                      }`}>
                      Edit
                    </button>
                  </>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onStartEdit(currentMode)
                    }}
                    className={`text-[10px] px-2 py-1 rounded font-semibold uppercase transition-colors ${
                      isActive
                        ? "text-gold hover:text-gold/80"
                        : "text-goldDeep hover:text-goldDeep/80"
                    }`}>
                    Set up name
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Copy rows */}
        <div className="relative mt-3 grid grid-cols-2 gap-2">
          <CopyRow
            kind="open"
            label="Open address"
            value={open?.address || ""}
            display={`${(open?.address || "").slice(0, 6)}…${(open?.address || "").slice(-4)}`}
            copied={copiedOpen}
            onCopy={(e) => {
              e.stopPropagation()
              copy(open?.address || "", "open")
            }}
            isActive={isActive}
          />
          <CopyRow
            kind="noid"
            label="Noid key"
            value={noid?.zkPublicKey || noid?.publicKey || ""}
            display={`${(noid?.zkPublicKey || noid?.publicKey || "").slice(
              0,
              6
            )}…${(noid?.zkPublicKey || noid?.publicKey || "").slice(-4)}`}
            copied={copiedNoid}
            onCopy={(e) => {
              e.stopPropagation()
              copy(noid?.zkPublicKey || noid?.publicKey || "", "noid")
            }}
            isActive={isActive}
          />
        </div>
      </div>
    </div>
  )
}

function CopyRow({
  kind,
  label,
  value,
  display,
  copied,
  onCopy,
  isActive
}: {
  kind: "open" | "noid"
  label: string
  value: string
  display: string
  copied: boolean
  onCopy: (e: React.MouseEvent) => void
  isActive: boolean
}) {
  return (
    <button
      onClick={onCopy}
      className={`flex items-center gap-2 p-2.5 rounded-xl border transition-colors ${
        isActive
          ? "bg-bone/[0.06] border-bone/15 hover:bg-bone/[0.12]"
          : "bg-ink/[0.04] border-ink/10 hover:bg-ink/[0.08]"
      }`}>
      <div className="min-w-0 flex-1 text-left">
        <p
          className={`text-[8px] tracking-[0.3em] uppercase ${
            isActive ? "text-bone/45" : "text-ink/45"
          }`}>
          {label}
        </p>
        <p
          className={`font-mono text-[10px] truncate ${
            isActive ? "text-bone/80" : "text-ink/75"
          }`}>
          {display}
        </p>
      </div>
      <span
        className={`shrink-0 ${
          copied ? "text-goldDeep" : isActive ? "text-bone/50" : "text-ink/40"
        }`}>
        {copied ? (
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path
              d="M2 6.5L5 9.5L11 3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <rect
              x="3.5"
              y="3.5"
              width="8"
              height="8"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.1"
            />
            <path
              d="M1 9V1.5A.5.5 0 011.5 1H9"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
    </button>
  )
}

function AddChoice({
  onCreate,
  onImport
}: {
  onCreate: () => void
  onImport: () => void
}) {
  return (
    <div className="px-5 py-6">
      <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">
        Add Wallet
      </p>
      <h2 className="font-display text-[26px] font-bold tracking-[-0.025em] leading-tight mb-2">
        How would you like to
        <br />
        <span className="font-serif italic font-medium text-goldDeep">
          add your wallet?
        </span>
      </h2>
      <p className="text-[13px] text-ink/55 leading-relaxed mb-8">
        The new wallet will be encrypted with your existing password.
      </p>

      <div className="space-y-3">
        <button
          onClick={onCreate}
          className="relative w-full text-left p-5 rounded-2xl bg-ink text-bone border border-ink hover:-translate-y-[2px] transition-all duration-300 overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,_rgba(232,174,58,0.35),transparent_60%)] opacity-0 hover:opacity-100 transition-opacity duration-500" />
          <div className="relative flex items-start gap-4">
            <span className="text-2xl">✨</span>
            <div className="flex-1 min-w-0">
              <h3 className="font-display text-[15px] font-semibold">
                Create new account
              </h3>
              <p className="text-[12px] mt-1 leading-relaxed text-bone/65">
                Generate a fresh seed phrase and a new identity.
              </p>
            </div>
          </div>
        </button>

        <button
          onClick={onImport}
          className="relative w-full text-left p-5 rounded-2xl bg-bone text-ink border border-ink/10 hover:border-goldDeep/40 hover:-translate-y-[2px] transition-all duration-300">
          <div className="flex items-start gap-4">
            <span className="text-2xl">📥</span>
            <div className="flex-1 min-w-0">
              <h3 className="font-display text-[15px] font-semibold">
                Import existing account
              </h3>
              <p className="text-[12px] mt-1 leading-relaxed text-ink/55">
                Bring in a wallet using a seed phrase or private key.
              </p>
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}

function Backdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-gradient-to-b from-[#FBF1D9] via-cream to-parchment" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,_rgba(232,174,58,0.2)_0%,_rgba(246,233,208,0)_55%)]" />
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-25" />
    </>
  )
}