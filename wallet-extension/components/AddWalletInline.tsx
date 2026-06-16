/**
 * AddWalletInline.tsx
 *
 * Add a new account from inside the wallet switcher.
 * Uses the existing session password — no re-prompt.
 *
 * NAMING:
 *   In-wallet label = just "My Wallet" — no .meno, editable
 *   Open username   = "captain.meno" — how others find you, set once
 *   Noid username   = "shadow.meno"  — private identity, set once
 */

import React, { useEffect, useState } from "react"
import {
  generateMnemonicOnly,
  importFromMnemonic,
  importFromPrivateKey,
  type FullWallet
} from "../crypto/keyDerivation"
import { useWallet } from "../context/WalletContext"
import bs58 from "bs58"
import { fromBase64 } from "@mysten/bcs";

type Mode = "menu" | "create" | "import"
type CreateStep = "seed" | "name" | "saving" | "done"
type ImportMethod = "seed" | "privatekey"
type ImportStep = "method" | "input" | "name" | "saving" | "done"

interface Props {
  onClose: () => void
  onAdded: () => void
}

export default function AddWalletInline({ onClose, onAdded }: Props) {
  const { mode: themeMode } = useWallet()
  const isNoid = themeMode === "noid"
  const [mode, setMode] = useState<Mode>("menu")

  return (
    <div className="flex flex-col h-full">
      <div className={`flex items-center justify-between px-5 py-4 border-b shrink-0 ${isNoid ? "border-bone/10" : "border-ink/10"}`}>
        <button
          onClick={mode === "menu" ? onClose : () => setMode("menu")}
          className={`flex items-center gap-2 text-[10px] tracking-[0.3em] uppercase transition-colors ${isNoid ? "text-bone/55 hover:text-bone" : "text-ink/50 hover:text-ink"}`}>
          <svg width="14" height="8" viewBox="0 0 14 8" fill="none">
            <path d="M14 4H2M2 4L5 1M2 4L5 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {mode === "menu" ? "Cancel" : "Back"}
        </button>
        <p className={`text-[10px] tracking-[0.3em] uppercase ${isNoid ? "text-bone/55" : "text-ink/55"}`}>Add wallet</p>
        <span className="w-12" />
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {mode === "menu" && <Menu onCreate={() => setMode("create")} onImport={() => setMode("import")} isNoid={isNoid} />}
        {mode === "create" && <CreateFlow onDone={onAdded} isNoid={isNoid} />}
        {mode === "import" && <ImportFlow onDone={onAdded} isNoid={isNoid} />}
      </div>
    </div>
  )
}

function Menu({ onCreate, onImport, isNoid }: { onCreate: () => void; onImport: () => void; isNoid: boolean }) {
  return (
    <div className="animate-revealUp">
      <p className="text-[10px] tracking-[0.35em] uppercase text-goldDeep mb-2">New on Menoid</p>
      <h2 className={`font-display text-[20px] font-bold tracking-[-0.025em] leading-tight mb-1 ${isNoid ? "text-bone" : "text-ink"}`}>
        Add an account
      </h2>
      <p className={`text-[12px] leading-relaxed mb-5 ${isNoid ? "text-bone/60" : "text-ink/55"}`}>
        Generate a brand-new account or import one. Encrypted with your existing password.
      </p>
      <div className="space-y-3">
        {[
          { id: "create", emoji: "✨", title: "Create new account", sub: "Fresh seed phrase and keys.", onClick: onCreate },
          { id: "import", emoji: "📜", title: "Import existing account", sub: "Restore via seed phrase or private key.", onClick: onImport }
        ].map((item) => (
          <button key={item.id} onClick={item.onClick}
            className={`w-full text-left p-4 rounded-2xl border transition-all hover:-translate-y-[1px] ${isNoid ? "bg-bone/[0.04] border-bone/15 hover:border-gold/40" : "bg-ink/[0.04] border-ink/10 hover:border-goldDeep/40"}`}>
            <div className="flex items-start gap-3">
              <span className="text-xl">{item.emoji}</span>
              <div>
                <p className={`font-display text-[14px] font-semibold ${isNoid ? "text-bone" : "text-ink"}`}>{item.title}</p>
                <p className={`text-[11px] leading-snug mt-1 ${isNoid ? "text-bone/55" : "text-ink/55"}`}>{item.sub}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ─────────────────────────── Create flow ──────────────────────────── */

function CreateFlow({ onDone, isNoid }: { onDone: () => void; isNoid: boolean }) {
  const { addWallet } = useWallet()
  const [step, setStep] = useState<CreateStep>("seed")
  const [mnemonic, setMnemonic] = useState("")
  const [copied, setCopied] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [walletLabel, setWalletLabel] = useState("")
  const [saveErr, setSaveErr] = useState("")

  useEffect(() => {
    try { setMnemonic(generateMnemonicOnly().mnemonic) }
    catch (e: any) { setSaveErr("Failed to generate seed.") }
  }, [])

  function copyPhrase() {
    if (!mnemonic) return
    navigator.clipboard.writeText(mnemonic)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function persistWallet(walletArg: FullWallet) {
    setStep("saving"); setSaveErr("")
    try {
      await addWallet({
        name: walletLabel.trim() || "Account",
        fullWallet: walletArg,
        registeredOpen: false,
        registeredNoid: false
      })
      setStep("done")
      setTimeout(() => onDone(), 700)
    } catch (e: any) {
      setSaveErr(e?.message ?? "Failed to save.")
      setStep("name")
    }
  }

  const words = mnemonic ? mnemonic.split(" ") : []

  return (
    <div className="animate-revealUp">
      {step === "seed" && (
        <>
          <p className="text-[10px] tracking-[0.35em] uppercase text-goldDeep mb-2">Step 01 · Seed</p>
          <h3 className={`font-display text-[18px] font-bold tracking-[-0.02em] mb-1 ${isNoid ? "text-bone" : "text-ink"}`}>Save these 12 words</h3>
          <p className={`text-[11px] mb-4 ${isNoid ? "text-bone/55" : "text-ink/55"}`}>Only way to recover this account.</p>
          {words.length === 0 ? (
            <div className="grid grid-cols-3 gap-2">{Array.from({ length: 12 }).map((_, i) => <div key={i} className={`h-8 rounded-lg animate-pulse ${isNoid ? "bg-bone/10" : "bg-ink/5"}`} />)}</div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {words.map((w, i) => (
                <div key={i} className={`flex items-center gap-1.5 rounded-lg px-2 py-2 ${isNoid ? "bg-bone/[0.06] border border-bone/15" : "bg-ink/[0.04] border border-ink/10"}`}>
                  <span className="font-serif italic text-[9px] text-goldDeep w-3 shrink-0">{i + 1}</span>
                  <span className={`font-display text-[11px] font-semibold truncate ${isNoid ? "text-bone" : "text-ink"}`}>{w}</span>
                </div>
              ))}
            </div>
          )}
          <button onClick={copyPhrase} disabled={!mnemonic}
            className="mt-4 w-full py-2.5 rounded-xl border border-goldDeep/40 text-goldDeep text-[10px] tracking-[0.3em] uppercase hover:bg-goldDeep/10 transition-colors disabled:opacity-40">
            {copied ? "Copied!" : "Copy phrase"}
          </button>
          <label className="mt-4 flex items-start gap-2 cursor-pointer">
            <button onClick={() => setConfirmed((v) => !v)}
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${confirmed ? "bg-goldDeep border-goldDeep" : isNoid ? "border-bone/25" : "border-ink/25"}`}>
              {confirmed && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#FBF1D9" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </button>
            <span className={`text-[11px] leading-snug ${isNoid ? "text-bone/60" : "text-ink/60"}`}>I've saved this phrase somewhere safe.</span>
          </label>
          <button disabled={!confirmed || !mnemonic} onClick={() => setStep("name")}
            className={`mt-5 w-full rounded-2xl py-3 font-display text-[12px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[1px] disabled:opacity-40 disabled:cursor-not-allowed ${isNoid ? "bg-bone text-ink" : "bg-ink text-bone"}`}>
            Continue — name account
          </button>
        </>
      )}

      {step === "name" && (
        <NameStep walletLabel={walletLabel} setWalletLabel={setWalletLabel} isNoid={isNoid}
          onContinue={() => persistWallet(importFromMnemonic(mnemonic))} />
      )}

      {step === "saving" && <Spinner label="Saving the new account…" isNoid={isNoid} />}
      {step === "done" && <Success isNoid={isNoid} label={walletLabel.trim() || "Account"} />}
    </div>
  )
}

/* ─────────────────────────── Import flow ──────────────────────────── */

function ImportFlow({ onDone, isNoid }: { onDone: () => void; isNoid: boolean }) {
  const { addWallet } = useWallet()
  const [step, setStep] = useState<ImportStep>("method")
  const [method, setMethod] = useState<ImportMethod>("seed")
  const [input, setInput] = useState("")
  const [inputErr, setInputErr] = useState("")
  const [walletLabel, setWalletLabel] = useState("")
  const [derivedWallet, setDerivedWallet] = useState<FullWallet | null>(null)
  const [privateKeyNetwork, setPrivateKeyNetwork] = useState<"ethereum" | "solana" | "sui" | "aptos">("ethereum")
  const [saveErr, setSaveErr] = useState("")

  function validateAndDerive(): FullWallet | null {
    const val = input.trim()
    if (!val) { setInputErr("Please enter your " + (method === "seed" ? "seed phrase" : "private key")); return null }
    try {
      if (method === "seed") {
        const wds = val.split(/\s+/)
        if (wds.length !== 12 && wds.length !== 24) { setInputErr("Must be 12 or 24 words."); return null }
        return importFromMnemonic(val)
      } else {
        if (privateKeyNetwork === "ethereum" || privateKeyNetwork === "aptos") {
          const clean = val.replace(/^0x/, "")
          if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
            setInputErr(`Invalid ${privateKeyNetwork === "ethereum" ? "Ethereum" : "Aptos"} private key. Must be 64 hex characters.`)
            return null
          }
        } else if (privateKeyNetwork === "solana") {
          try {
            const decoded = bs58.decode(val)
            if (decoded.length !== 64 && decoded.length !== 32) {
              setInputErr("Invalid Solana private key length. Must decode to 32 or 64 bytes.")
              return null
            }
          } catch {
            const clean = val.replace(/^0x/, "")
            if (!/^[0-9a-fA-F]{64}$/.test(clean) && !/^[0-9a-fA-F]{128}$/.test(clean)) {
              setInputErr("Invalid Solana private key format (must be base58 string or hex).")
              return null
            }
          }
        } else if (privateKeyNetwork === "sui") {
          if (val.startsWith("suiprivkey")) {
            if (val.length < 20) {
              setInputErr("Invalid Sui private key format.")
              return null
            }
          } else {
            try {
              fromBase64(val)
            } catch {
              const clean = val.replace(/^0x/, "")
              if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
                setInputErr("Invalid Sui private key (must start with suiprivkey..., be Base64, or 64 hex characters).")
                return null
              }
            }
          }
        }
        return importFromPrivateKey(val, privateKeyNetwork)
      }
    } catch (e: any) { setInputErr(e?.message ?? "Couldn't derive keys."); return null }
  }

  async function persistWallet() {
    if (!derivedWallet) return
    setStep("saving"); setSaveErr("")
    try {
      await addWallet({
        name: walletLabel.trim() || "Account",
        fullWallet: derivedWallet,
        registeredOpen: false,
        registeredNoid: false
      })
      setStep("done")
      setTimeout(() => onDone(), 700)
    } catch (e: any) {
      setSaveErr(e?.message ?? "Failed to save.")
      setStep("name")
    }
  }

  return (
    <div className="animate-revealUp">
      {step === "method" && (
        <>
          <p className="text-[10px] tracking-[0.35em] uppercase text-goldDeep mb-2">Step 01 · Method</p>
          <h3 className={`font-display text-[18px] font-bold tracking-[-0.02em] mb-3 ${isNoid ? "text-bone" : "text-ink"}`}>How would you like to import?</h3>
          <div className="grid gap-2">
            {([ ["seed", "📜", "Seed Phrase", "12 or 24 words"], ["privatekey", "🔑", "Private Key", "0x + 64 hex chars"] ] as const).map(([m, icon, title, sub]) => (
              <button key={m} onClick={() => setMethod(m as ImportMethod)}
                className={`text-left p-3 rounded-xl border transition-all ${method === m ? "bg-goldDeep/[0.1] border-goldDeep/40" : isNoid ? "bg-bone/[0.04] border-bone/15 hover:border-bone/30" : "bg-ink/[0.04] border-ink/10 hover:border-ink/25"}`}>
                <div className="flex items-center gap-3">
                  <span className="text-lg">{icon}</span>
                  <div className="flex-1">
                    <p className={`font-display text-[13px] font-semibold ${isNoid ? "text-bone" : "text-ink"}`}>{title}</p>
                    <p className={`text-[10px] mt-0.5 ${isNoid ? "text-bone/55" : "text-ink/55"}`}>{sub}</p>
                  </div>
                  {method === m && <span className="h-3 w-3 rounded-full bg-goldDeep" />}
                </div>
              </button>
            ))}
          </div>
          <button onClick={() => setStep("input")} className={`mt-5 w-full rounded-2xl py-3 font-display text-[12px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[1px] ${isNoid ? "bg-bone text-ink" : "bg-ink text-bone"}`}>Continue</button>
        </>
      )}

      {step === "input" && (
        <>
          <p className="text-[10px] tracking-[0.35em] uppercase text-goldDeep mb-2">Step 02 · {method === "seed" ? "Seed" : "Key"}</p>
          <h3 className={`font-display text-[18px] font-bold tracking-[-0.02em] mb-3 ${isNoid ? "text-bone" : "text-ink"}`}>Enter your {method === "seed" ? "recovery phrase" : "private key"}</h3>
          {method === "privatekey" && (
            <div className="mb-4">
              <label className={`block text-[10px] tracking-[0.3em] uppercase mb-2 ${isNoid ? "text-bone/50" : "text-ink/50"}`}>
                Select Network
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(
                  [
                    ["ethereum", "Ethereum"],
                    ["solana", "Solana"],
                    ["sui", "Sui"],
                    ["aptos", "Aptos"]
                  ] as const
                ).map(([net, label]) => (
                  <button
                    key={net}
                    type="button"
                    onClick={() => {
                      setPrivateKeyNetwork(net)
                      setInputErr("")
                    }}
                    className={`py-2 px-1 text-center rounded-xl border text-[10px] font-semibold tracking-wider transition-all uppercase ${
                      privateKeyNetwork === net
                        ? isNoid
                          ? "bg-bone text-ink border-bone"
                          : "bg-ink text-bone border-ink"
                        : isNoid
                        ? "bg-bone/[0.03] text-bone/70 border-bone/10 hover:border-gold/45"
                        : "bg-ink/[0.03] text-ink/70 border-ink/10 hover:border-goldDeep/45"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {method === "seed" ? (
            <textarea value={input} onChange={(e) => { setInput(e.target.value); setInputErr("") }} rows={4} placeholder="word1 word2 word3 …"
              className={`w-full rounded-xl px-3 py-2 text-[12px] font-mono leading-relaxed resize-none focus:outline-none transition-colors ${isNoid ? "bg-bone/[0.06] border border-bone/15 text-bone placeholder-bone/30 focus:border-gold/60" : "bg-ink/[0.05] border border-ink/12 text-ink placeholder-ink/30 focus:border-goldDeep/60"}`} />
          ) : (
            <input type="password" value={input} onChange={(e) => { setInput(e.target.value); setInputErr("") }} placeholder="Paste private key..."
              className={`w-full rounded-xl px-3 py-2 text-[12px] font-mono focus:outline-none transition-colors ${isNoid ? "bg-bone/[0.06] border border-bone/15 text-bone placeholder-bone/30 focus:border-gold/60" : "bg-ink/[0.05] border border-ink/12 text-ink placeholder-ink/30 focus:border-goldDeep/60"}`} />
          )}
          {inputErr && <p className="mt-2 text-[11px] text-red-500">{inputErr}</p>}
          <button onClick={() => { const w = validateAndDerive(); if (w) { setDerivedWallet(w); setStep("name") } }}
            className={`mt-5 w-full rounded-2xl py-3 font-display text-[12px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[1px] ${isNoid ? "bg-bone text-ink" : "bg-ink text-bone"}`}>Continue</button>
        </>
      )}

      {step === "name" && (
        <NameStep walletLabel={walletLabel} setWalletLabel={setWalletLabel} isNoid={isNoid}
          onContinue={() => persistWallet()} />
      )}

      {step === "saving" && <Spinner label="Saving the new account…" isNoid={isNoid} />}
      {step === "done" && <Success isNoid={isNoid} label={walletLabel.trim() || "Account"} />}
    </div>
  )
}

/* ─────────────────── Shared sub-components ─────────────────── */

function NameStep({ walletLabel, setWalletLabel, onContinue, isNoid }: {
  walletLabel: string; setWalletLabel: (v: string) => void; onContinue: () => void; isNoid: boolean
}) {
  return (
    <>
      <p className="text-[10px] tracking-[0.35em] uppercase text-goldDeep mb-2">Name your account</p>
      <h3 className={`font-display text-[18px] font-bold tracking-[-0.02em] mb-1 ${isNoid ? "text-bone" : "text-ink"}`}>Pick a label</h3>
      <p className={`text-[11px] mb-4 ${isNoid ? "text-bone/55" : "text-ink/55"}`}>
        A private in-wallet label — only visible to you. No .meno suffix.
      </p>
      <input value={walletLabel} onChange={(e) => setWalletLabel(e.target.value)} placeholder="My Main Account"
        className={`w-full rounded-xl pl-3 pr-4 py-2.5 text-[13px] focus:outline-none transition-colors ${isNoid ? "bg-bone/[0.06] border border-bone/15 text-bone placeholder-bone/30 focus:border-gold/60" : "bg-ink/[0.05] border border-ink/12 text-ink placeholder-ink/30 focus:border-goldDeep/60"}`} />
      <button disabled={!walletLabel.trim()} onClick={onContinue}
        className={`mt-5 w-full rounded-2xl py-3 font-display text-[12px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[1px] disabled:opacity-40 disabled:cursor-not-allowed ${isNoid ? "bg-bone text-ink" : "bg-ink text-bone"}`}>
        Create account
      </button>
    </>
  )
}

function Spinner({ label, isNoid }: { label: string; isNoid: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-10">
      <span className="h-7 w-7 rounded-full border-2 border-goldDeep/30 border-t-goldDeep animate-spin mb-3" />
      <p className={`text-[12px] ${isNoid ? "text-bone/65" : "text-ink/60"}`}>{label}</p>
    </div>
  )
}

function Success({ isNoid, label }: { isNoid: boolean; label: string }) {
  return (
    <div className="flex flex-col items-center text-center py-8">
      <div className="h-16 w-16 rounded-full bg-emerald-500/15 flex items-center justify-center mb-4 border border-emerald-500/30">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M5 12L10 17L19 7" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="text-[10px] tracking-[0.35em] uppercase text-goldDeep mb-1">All set</p>
      <h3 className={`font-display text-[18px] font-bold ${isNoid ? "text-bone" : "text-ink"}`}>{label} added</h3>
      <p className={`text-[11px] mt-1 ${isNoid ? "text-bone/55" : "text-ink/55"}`}>Switching to the new account…</p>
    </div>
  )
}