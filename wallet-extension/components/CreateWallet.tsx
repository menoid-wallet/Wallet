/**
 * CreateWallet.tsx — Onboarding flow for the FIRST wallet.
 *
 * Steps:
 *   seed     → display the generated mnemonic, confirm "I've saved it".
 *   name     → choose a wallet name; the .meno suffix is auto-appended.
 *   password → set the wallet password (encrypts the keys locally).
 *   identity → check /api/users & /api/noidusers; ask the user whether
 *              to register the open and/or noid identities. If both are
 *              already registered for this exact wallet, this step
 *              auto-advances.
 *   done     → success screen with the open address + "Open extension".
 */

import React, { useEffect, useState } from "react"
import {
  generateMnemonicOnly,
  importFromMnemonic
} from "../crypto/keyDerivation"
import type { FullWallet } from "../crypto/keyDerivation"
import { passwordStrength } from "../crypto/walletCrypto"
import { createInitialState, ensureMenoSuffix } from "../lib/wallets"
import { ensureIdentities, isNoidRegistered, isOpenRegistered } from "../services/users"
import OpenWalletButton from "./OpenWalletButton"

type Step = "seed" | "name" | "password" | "identity" | "done"

interface Props {
  onBack: () => void
}

export default function CreateWallet({ onBack }: Props) {
  const [step, setStep] = useState<Step>("seed")
  const [mnemonic, setMnemonic] = useState("")
  const [genError, setGenError] = useState("")
  const [copied, setCopied] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const [name, setName] = useState("")

  const [password, setPassword] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [pwError, setPwError] = useState("")
  const [saving, setSaving] = useState(false)
  const [savingLabel, setSavingLabel] = useState("Saving…")

  // identity step
  const [identityChecking, setIdentityChecking] = useState(false)
  const [identityErr, setIdentityErr] = useState("")
  const [openExists, setOpenExists] = useState(false)
  const [noidExists, setNoidExists] = useState(false)
  const [wantOpen, setWantOpen] = useState(true)
  const [wantNoid, setWantNoid] = useState(true)
  const [identitySaving, setIdentitySaving] = useState(false)

  const [derivedWallet, setDerivedWallet] = useState<FullWallet | null>(null)
  const [savedAddress, setSavedAddress] = useState("")

  const strength = passwordStrength(password)

  useEffect(() => {
    try {
      const { mnemonic: m } = generateMnemonicOnly()
      setMnemonic(m)
    } catch (e: any) {
      setGenError("Failed to generate wallet: " + (e?.message ?? String(e)))
    }
  }, [])

  function copyPhrase() {
    if (!mnemonic) return
    navigator.clipboard.writeText(mnemonic)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleSavePassword() {
    if (password.length < 8) {
      setPwError("Password must be at least 8 characters.")
      return
    }
    if (password !== confirmPw) {
      setPwError("Passwords don't match.")
      return
    }
    setPwError("")
    setSaving(true)
    try {
      setSavingLabel("Deriving keys…")
      const fullWallet = importFromMnemonic(mnemonic)
      setDerivedWallet(fullWallet)

      setSavingLabel("Encrypting…")
      await createInitialState({
        name: ensureMenoSuffix(name),
        password,
        fullWallet,
        registeredOpen: false,
        registeredNoid: false
      })

      setSavedAddress(fullWallet.normalAccount.address)
      setStep("identity")
    } catch (e: any) {
      setPwError(e?.message ?? "Unknown error")
      console.error("[CreateWallet] save error:", e)
    } finally {
      setSaving(false)
    }
  }

  // When we enter the identity step, hit the backend to learn which
  // identities (if any) already exist for this exact wallet. If both are
  // present, auto-advance to "done" without bothering the user.
  useEffect(() => {
    if (step !== "identity" || !derivedWallet) return
    let cancelled = false
    ;(async () => {
      setIdentityChecking(true)
      setIdentityErr("")
      try {
        const [open, noid] = await Promise.all([
          isOpenRegistered(derivedWallet.normalAccount.address),
          isNoidRegistered(derivedWallet.noidAccount.publicKey)
        ])
        if (cancelled) return
        setOpenExists(open.registered)
        setNoidExists(noid.registered)
        setWantOpen(!open.registered)
        setWantNoid(!noid.registered)
        if (open.registered && noid.registered) {
          // nothing to do — already known on both backends
          setStep("done")
        }
      } catch (e: any) {
        if (!cancelled) {
          setIdentityErr(
            e?.message ?? "Couldn't reach Menoid backend to check identities."
          )
        }
      } finally {
        if (!cancelled) setIdentityChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [step, derivedWallet])

  async function handleConfirmIdentity() {
    if (!derivedWallet) return
    setIdentitySaving(true)
    setIdentityErr("")
    try {
      const finalName = ensureMenoSuffix(name)
      const { registeredOpen, registeredNoid } = await ensureIdentities({
        name: finalName,
        realAddress: derivedWallet.normalAccount.address,
        noidModePublicKey: derivedWallet.noidAccount.publicKey,
        zkPublicKey: derivedWallet.noidAccount.zkPublicKey,
        registerOpen: wantOpen && !openExists,
        registerNoid: wantNoid && !noidExists
      })

      // patch the persisted entry with the new flags
      const r = await chrome.storage.local.get("menoid_wallets")
      if (r?.menoid_wallets) {
        const parsed = JSON.parse(r.menoid_wallets)
        if (parsed?.list?.[0]) {
          parsed.list[0].registeredOpen = registeredOpen
          parsed.list[0].registeredNoid = registeredNoid
          await chrome.storage.local.set({
            menoid_wallets: JSON.stringify(parsed)
          })
        }
      }
      setStep("done")
    } catch (e: any) {
      setIdentityErr(e?.message ?? "Identity registration failed.")
    } finally {
      setIdentitySaving(false)
    }
  }

  const words = mnemonic ? mnemonic.split(" ") : []
  const stepOrder: Step[] = ["seed", "name", "password", "identity", "done"]
  const previewName = ensureMenoSuffix(name)

  return (
    <div className="relative min-h-screen w-full bg-cream font-body text-ink overflow-hidden">
      <Backdrop />

      <header className="relative z-20 flex items-center justify-between px-8 py-5 border-b border-ink/10">
        <button
          onClick={() => {
            const i = stepOrder.indexOf(step)
            if (i <= 0) onBack()
            else setStep(stepOrder[i - 1])
          }}
          className="flex items-center gap-2 text-[11px] tracking-[0.3em] uppercase text-ink/50 hover:text-ink transition-colors">
          <svg width="18" height="9" viewBox="0 0 18 9" fill="none">
            <path
              d="M18 4.5H2M2 4.5L5.5 1M2 4.5L5.5 8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
          Back
        </button>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-goldDeep" />
          <span className="font-display text-[11px] font-semibold tracking-[0.3em] text-ink">
            MENOID
          </span>
        </div>
        <div className="flex items-center gap-2">
          {stepOrder.map((s) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                s === step
                  ? "w-6 bg-goldDeep"
                  : stepOrder.indexOf(s) < stepOrder.indexOf(step)
                    ? "w-3 bg-goldDeep/50"
                    : "w-3 bg-ink/15"
              }`}
            />
          ))}
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-[540px] px-8 py-12">
        {step === "seed" && (
          <div className="animate-revealUp">
            <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">
              Step 01
            </p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-2">
              Your Secret
              <br />
              <span className="font-serif italic font-medium text-goldDeep">
                Recovery Phrase
              </span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed mb-8">
              Write these 12 words down in order and keep them safe. This is
              the only way to recover your wallet.
            </p>

            {genError ? (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-[13px]">
                {genError}
              </div>
            ) : words.length === 0 ? (
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-10 rounded-xl bg-ink/5 animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {words.map((word, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-xl bg-ink/[0.05] border border-ink/10 px-3 py-2.5">
                    <span className="font-serif italic text-[10px] text-goldDeep w-4 shrink-0">
                      {i + 1}
                    </span>
                    <span className="font-display text-[13px] font-semibold">
                      {word}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3">
              <button
                onClick={copyPhrase}
                disabled={!mnemonic}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-goldDeep/40 text-goldDeep text-[11px] tracking-[0.3em] uppercase hover:bg-goldDeep/10 transition-colors disabled:opacity-40">
                {copied ? "Copied!" : "Copy phrase"}
              </button>
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <span className="text-amber-500 text-sm mt-0.5">⚠</span>
                <p className="text-[11px] text-ink/60 leading-relaxed">
                  Never share your recovery phrase. Anyone with it has full
                  access to your wallet.
                </p>
              </div>
            </div>

            <label className="mt-6 flex items-start gap-3 cursor-pointer">
              <div
                onClick={() => setConfirmed((v) => !v)}
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  confirmed ? "bg-goldDeep border-goldDeep" : "border-ink/25"
                }`}>
                {confirmed && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path
                      d="M1 4L3.5 6.5L9 1"
                      stroke="#FBF1D9"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
              <span className="text-[12px] text-ink/60 leading-relaxed">
                I've saved my recovery phrase somewhere safe.
              </span>
            </label>

            <button
              disabled={!confirmed || !mnemonic}
              onClick={() => setStep("name")}
              className="mt-8 w-full rounded-2xl bg-ink text-bone py-4 font-display text-[13px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[2px] disabled:opacity-40 disabled:cursor-not-allowed">
              Continue — Name your wallet
            </button>
          </div>
        )}

        {step === "name" && (
          <div className="animate-revealUp">
            <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">
              Step 02
            </p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-2">
              Pick a
              <br />
              <span className="font-serif italic font-medium text-goldDeep">
                .meno name
              </span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed mb-8">
              This is how other Menoid users will see you. The{" "}
              <span className="font-mono text-goldDeep">.meno</span> suffix is
              attached automatically.
            </p>

            <label className="block text-[10px] tracking-[0.3em] uppercase text-ink/50 mb-2">
              Wallet name
            </label>
            <div className="relative">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="captain"
                className="w-full rounded-xl bg-ink/[0.05] border border-ink/12 pl-4 pr-20 py-3 text-[14px] placeholder-ink/30 focus:outline-none focus:border-goldDeep/60 transition-colors"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] font-mono text-goldDeep/80 pointer-events-none">
                .meno
              </span>
            </div>

            <div className="mt-4 p-3 rounded-xl bg-ink/[0.04] border border-ink/10">
              <p className="text-[10px] tracking-[0.3em] uppercase text-ink/45 mb-1">
                Preview
              </p>
              <p className="font-mono text-[14px] text-ink">
                {name.trim() ? previewName : "your-name.meno"}
              </p>
            </div>

            <button
              disabled={!name.trim()}
              onClick={() => setStep("password")}
              className="mt-8 w-full rounded-2xl bg-ink text-bone py-4 font-display text-[13px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[2px] disabled:opacity-40 disabled:cursor-not-allowed">
              Continue — Set Password
            </button>
          </div>
        )}

        {step === "password" && (
          <div className="animate-revealUp">
            <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">
              Step 03
            </p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-2">
              Secure Your
              <br />
              <span className="font-serif italic font-medium text-goldDeep">
                Wallet
              </span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed mb-8">
              This password encrypts your keys locally. It cannot be recovered.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] tracking-[0.3em] uppercase text-ink/50 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full rounded-xl bg-ink/[0.05] border border-ink/12 px-4 py-3 text-[14px] placeholder-ink/30 focus:outline-none focus:border-goldDeep/60 transition-colors"
                />
                {password.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="flex gap-1">
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className="h-1 flex-1 rounded-full transition-all duration-300"
                          style={{
                            backgroundColor:
                              i < strength.score
                                ? strength.color
                                : "rgba(23,19,17,0.1)"
                          }}
                        />
                      ))}
                    </div>
                    <p className="text-[11px]" style={{ color: strength.color }}>
                      {strength.label}
                    </p>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.3em] uppercase text-ink/50 mb-2">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full rounded-xl bg-ink/[0.05] border border-ink/12 px-4 py-3 text-[14px] placeholder-ink/30 focus:outline-none focus:border-goldDeep/60 transition-colors"
                />
                {confirmPw.length > 0 && password !== confirmPw && (
                  <p className="mt-1 text-[11px] text-red-500">
                    Passwords don't match
                  </p>
                )}
              </div>
              {pwError && (
                <p className="text-[12px] text-red-500 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                  {pwError}
                </p>
              )}
            </div>

            <button
              disabled={
                saving ||
                strength.score < 2 ||
                password !== confirmPw ||
                !password
              }
              onClick={handleSavePassword}
              className="mt-8 w-full rounded-2xl bg-ink text-bone py-4 font-display text-[13px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[2px] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3">
              {saving ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-bone/30 border-t-bone animate-spin" />
                  {savingLabel}
                </>
              ) : (
                "Continue — Identities"
              )}
            </button>
          </div>
        )}

        {step === "identity" && (
          <div className="animate-revealUp">
            <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">
              Step 04
            </p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-2">
              Claim your
              <br />
              <span className="font-serif italic font-medium text-goldDeep">
                identities
              </span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed mb-8">
              Menoid keeps two parallel identities — one public (Open) and one
              private (Noid). We'll register{" "}
              <span className="font-mono text-goldDeep">{previewName}</span> for
              each side that's not already taken by this wallet.
            </p>

            {identityChecking ? (
              <div className="p-5 rounded-2xl bg-ink/[0.04] border border-ink/10 flex items-center gap-3">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-goldDeep/30 border-t-goldDeep animate-spin" />
                <p className="text-[12px] text-ink/60">
                  Checking with Menoid backend…
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <IdentityCard
                  title="Open identity"
                  subtitle={
                    openExists
                      ? "Already registered for this wallet."
                      : "Will be registered on /api/users"
                  }
                  preview={`${previewName} → ${derivedWallet?.normalAccount.address.slice(
                    0,
                    8
                  )}…`}
                  checked={openExists ? true : wantOpen}
                  disabled={openExists}
                  onToggle={() => setWantOpen((v) => !v)}
                  done={openExists}
                />
                <IdentityCard
                  title="Noid identity"
                  subtitle={
                    noidExists
                      ? "Already registered for this wallet."
                      : "Will be registered on /api/noidusers"
                  }
                  preview={`${previewName} → ${derivedWallet?.noidAccount.publicKey.slice(
                    0,
                    8
                  )}…`}
                  checked={noidExists ? true : wantNoid}
                  disabled={noidExists}
                  onToggle={() => setWantNoid((v) => !v)}
                  done={noidExists}
                />
              </div>
            )}

            {identityErr && (
              <p className="mt-4 text-[12px] text-red-500 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                {identityErr}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2">
              <button
                disabled={
                  identityChecking ||
                  identitySaving ||
                  (!openExists && !wantOpen && !noidExists && !wantNoid)
                }
                onClick={handleConfirmIdentity}
                className="w-full rounded-2xl bg-ink text-bone py-4 font-display text-[13px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[2px] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {identitySaving ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-bone/30 border-t-bone animate-spin" />
                    Registering…
                  </>
                ) : (
                  "Confirm & continue"
                )}
              </button>
              <button
                onClick={() => setStep("done")}
                disabled={identitySaving}
                className="w-full rounded-2xl bg-transparent border border-ink/15 text-ink/60 py-3 font-display text-[11px] tracking-[0.25em] uppercase hover:border-ink/30 hover:text-ink transition-colors disabled:opacity-40">
                Skip for now
              </button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="animate-revealUp flex flex-col items-center text-center py-8">
            <div className="relative mb-8">
              <div className="h-24 w-24 rounded-full bg-goldDeep/20 flex items-center justify-center">
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                  <path
                    d="M7 19L13.5 25.5L29 10"
                    stroke="#A36E14"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="absolute inset-0 rounded-full bg-gold/30 blur-xl animate-shimmer" />
            </div>
            <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">
              All Set
            </p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-3">
              Wallet Created
              <br />
              <span className="font-serif italic font-medium text-goldDeep">
                Successfully
              </span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed max-w-[320px] mb-8">
              Your wallet is encrypted and stored locally. Open the extension
              to begin.
            </p>
            {savedAddress && (
              <div className="w-full space-y-2 mb-8">
                <div className="flex items-center justify-between p-3 rounded-xl bg-ink/[0.04] border border-ink/10">
                  <span className="text-[11px] tracking-[0.25em] uppercase text-ink/50">
                    Name
                  </span>
                  <span className="font-mono text-[11px] text-ink/70">
                    {previewName}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-ink/[0.04] border border-ink/10">
                  <span className="text-[11px] tracking-[0.25em] uppercase text-ink/50">
                    Address
                  </span>
                  <span className="font-mono text-[11px] text-ink/70">
                    {savedAddress.slice(0, 6)}…{savedAddress.slice(-4)}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-ink/[0.04] border border-ink/10">
                  <span className="text-[11px] tracking-[0.25em] uppercase text-ink/50">
                    Network
                  </span>
                  <span className="text-[11px] text-ink/70 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Monad
                  </span>
                </div>
              </div>
            )}
            <OpenWalletButton />
          </div>
        )}
      </div>
    </div>
  )
}

function IdentityCard({
  title,
  subtitle,
  preview,
  checked,
  disabled,
  onToggle,
  done
}: {
  title: string
  subtitle: string
  preview: string
  checked: boolean
  disabled: boolean
  onToggle: () => void
  done: boolean
}) {
  return (
    <div
      className={`flex items-center gap-3 p-4 rounded-2xl border transition-colors ${
        disabled
          ? "bg-emerald-500/[0.06] border-emerald-500/25"
          : checked
            ? "bg-goldDeep/[0.07] border-goldDeep/35"
            : "bg-ink/[0.04] border-ink/10"
      }`}>
      <button
        onClick={onToggle}
        disabled={disabled}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
          checked
            ? "bg-goldDeep border-goldDeep"
            : "border-ink/25 bg-transparent"
        } ${disabled ? "cursor-default" : "cursor-pointer"}`}>
        {checked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path
              d="M1 4L3.5 6.5L9 1"
              stroke="#FBF1D9"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-ink">{title}</p>
        <p className="text-[11px] text-ink/55 mt-0.5">{subtitle}</p>
        <p className="text-[11px] font-mono text-ink/65 mt-1 truncate">
          {preview}
        </p>
      </div>
      {done && (
        <span className="text-[9px] tracking-[0.3em] uppercase text-emerald-700">
          Linked
        </span>
      )}
    </div>
  )
}

function Backdrop() {
  return (
    <>
      <div className="fixed inset-0 bg-gradient-to-br from-[#FBF1D9] via-cream to-parchment" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_80%_20%,_rgba(232,174,58,0.25)_0%,_rgba(246,233,208,0)_55%)]" />
      <div className="pointer-events-none fixed inset-0 paper-grain opacity-35" />
    </>
  )
}
