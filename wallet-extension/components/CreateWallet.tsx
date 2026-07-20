/**
 * CreateWallet.tsx — Onboarding flow for the FIRST wallet.
 *
 * Steps:
 *   seed     → display the generated mnemonic, confirm "I've saved it".
 *   name     → choose an in-wallet label (just a local alias).
 *   password → set the wallet password.
 *   done     → success screen.
 *
 * NAMING:
 *   in-wallet name = just "My Wallet" — stored as entry.name, editable later
 */

import React, { useEffect, useState } from "react"
import { generateMnemonicOnly, importFromMnemonic } from "../crypto/keyDerivation"
import type { FullWallet } from "../crypto/keyDerivation"
import { passwordStrength } from "../crypto/walletCrypto"
import { createInitialState } from "../lib/wallets"
import OpenWalletButton from "./OpenWalletButton"
import { caretPoint } from "./brand/AnimatedLogo"
import {
  CloudButton,
  ErrorText,
  FactRow,
  Field,
  Kicker,
  Label,
  Lede,
  Note,
  Panel,
  SetupShell,
  Spinner,
  Title,
  useGaze
} from "./brand/SetupUI"

type Step = "seed" | "name" | "password" | "done"

interface Props {
  onBack: () => void
}

export default function CreateWallet({ onBack }: Props) {
  const [step, setStep] = useState<Step>("seed")
  const [mnemonic, setMnemonic] = useState("")
  const [genError, setGenError] = useState("")
  const [copied, setCopied] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  // in-wallet label — no .meno
  const [walletLabel, setWalletLabel] = useState("")

  const [password, setPassword] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [pwError, setPwError] = useState("")
  const [saving, setSaving] = useState(false)
  const [savingLabel, setSavingLabel] = useState("Saving…")

  const [derivedWallet, setDerivedWallet] = useState<FullWallet | null>(null)
  const [savedAddress, setSavedAddress] = useState("")

  // the mark in the header watches whatever field is being typed into
  const { gaze, setGaze } = useGaze()

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
      const fullWallet = await importFromMnemonic(mnemonic)
      setDerivedWallet(fullWallet)
      setSavingLabel("Encrypting…")
      await createInitialState({
        name: walletLabel.trim() || "Account",
        password,
        fullWallet,
        registeredOpen: false,
        registeredNoid: false
      })
      setSavedAddress(fullWallet.normalAccount.address)
      setStep("done")
    } catch (e: any) {
      setPwError(e?.message ?? "Unknown error")
    } finally {
      setSaving(false)
    }
  }

  const words = mnemonic ? mnemonic.split(" ") : []
  const stepOrder: Step[] = ["seed", "name", "password", "done"]

  return (
    <SetupShell
      steps={stepOrder}
      step={step}
      gaze={gaze}
      onBack={() => {
        const i = stepOrder.indexOf(step)
        if (i <= 0) onBack()
        else setStep(stepOrder[i - 1])
      }}>
      {/* ── SEED ── */}
      {step === "seed" && (
        <Panel>
          <Kicker>Step 01</Kicker>
          <Title>Your secret recovery phrase</Title>
          <Lede>
            Write these 12 words down in order and keep them safe. This is the only way to recover
            your wallet.
          </Lede>

          <div className="mt-6">
            {genError ? (
              <ErrorText>{genError}</ErrorText>
            ) : words.length === 0 ? (
              <div className="grid grid-cols-3 gap-2.5">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded-xl bg-white/12" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2.5">
                {words.map((word, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-xl px-2.5 py-2.5"
                    style={{
                      background: "rgba(255,255,255,0.13)",
                      border: "1px solid rgba(255,255,255,0.22)"
                    }}>
                    <span className="w-3.5 shrink-0 font-mono text-[10px] text-white/45">{i + 1}</span>
                    <span className="truncate font-round text-[13px] font-medium text-white">{word}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-5 space-y-3">
            <button
              onClick={copyPhrase}
              disabled={!mnemonic}
              className="w-full rounded-2xl py-2.5 font-round text-[13px] font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-40"
              style={{
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.26)"
              }}>
              {copied ? "Copied to clipboard" : "Copy phrase"}
            </button>
            <Note>
              Never share your recovery phrase. Anyone who has it has full access to your wallet.
            </Note>
          </div>

          <button
            onClick={() => setConfirmed((v) => !v)}
            className="mt-5 flex w-full items-start gap-3 text-left">
            <span
              className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md transition-colors"
              style={{
                background: confirmed ? "#FFFFFF" : "rgba(255,255,255,0.12)",
                border: `1px solid ${confirmed ? "#FFFFFF" : "rgba(255,255,255,0.34)"}`
              }}>
              {confirmed && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path
                    d="M1 4L3.5 6.5L9 1"
                    stroke="#4E2F8E"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <span className="font-round text-[13px] leading-relaxed text-white/75">
              I've saved my recovery phrase somewhere safe.
            </span>
          </button>

          <div className="mt-6">
            <CloudButton disabled={!confirmed || !mnemonic} onClick={() => setStep("name")}>
              Continue — name your wallet
            </CloudButton>
          </div>
        </Panel>
      )}

      {/* ── NAME (in-wallet label, no .meno) ── */}
      {step === "name" && (
        <Panel>
          <Kicker>Step 02</Kicker>
          <Title>Name your account</Title>
          <Lede>
            This is your private in-wallet label — only visible to you. You can change it anytime.
          </Lede>

          <div className="mt-6">
            <Label>Account label</Label>
            <Field
              value={walletLabel}
              onChange={(e) => setWalletLabel(e.target.value)}
              placeholder="My Main Account"
              onKeyDown={(e) => e.key === "Enter" && walletLabel.trim() && setStep("password")}
            />
            <p className="mt-2 font-round text-[12px] text-white/50">
              Just a local label. Usernames others can find you by are set later.
            </p>
          </div>

          <div className="mt-6">
            <CloudButton disabled={!walletLabel.trim()} onClick={() => setStep("password")}>
              Continue — set password
            </CloudButton>
          </div>
        </Panel>
      )}

      {/* ── PASSWORD ── */}
      {step === "password" && (
        <Panel>
          <Kicker>Step 03</Kicker>
          <Title>Secure your wallet</Title>
          <Lede>This password encrypts your keys on this device. It cannot be recovered.</Lede>

          <div className="mt-6 space-y-4">
            <div>
              <Label>Password</Label>
              <Field
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setGaze(caretPoint(e.target))
                }}
                onBlur={() => setGaze(null)}
                placeholder="Enter password"
              />
              {password.length > 0 && (
                <div className="mt-2.5 space-y-1.5">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-1 flex-1 rounded-full transition-all duration-300"
                        style={{
                          backgroundColor:
                            i < strength.score ? strength.color : "rgba(255,255,255,0.18)"
                        }}
                      />
                    ))}
                  </div>
                  <p className="font-round text-[12px]" style={{ color: strength.color }}>
                    {strength.label}
                  </p>
                </div>
              )}
            </div>

            <div>
              <Label>Confirm password</Label>
              <Field
                type="password"
                value={confirmPw}
                invalid={confirmPw.length > 0 && password !== confirmPw}
                onChange={(e) => {
                  setConfirmPw(e.target.value)
                  setGaze(caretPoint(e.target))
                }}
                onBlur={() => setGaze(null)}
                placeholder="Re-enter password"
              />
              {confirmPw.length > 0 && password !== confirmPw && (
                <ErrorText>Passwords don't match</ErrorText>
              )}
            </div>

            <ErrorText>{pwError}</ErrorText>
          </div>

          <div className="mt-6">
            <CloudButton
              disabled={saving || strength.score < 2 || password !== confirmPw || !password}
              onClick={handleSavePassword}>
              {saving ? (
                <>
                  <Spinner />
                  {savingLabel}
                </>
              ) : (
                "Create wallet"
              )}
            </CloudButton>
          </div>
        </Panel>
      )}

      {/* ── DONE ── */}
      {step === "done" && (
        <Panel className="text-center">
          <div className="relative mx-auto mb-6 flex h-20 w-20 items-center justify-center">
            <span
              className="halo-pulse absolute inset-0 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,255,255,0.55) 0%, transparent 70%)",
                filter: "blur(10px)"
              }}
            />
            <span
              className="relative flex h-20 w-20 items-center justify-center rounded-full"
              style={{
                background: "rgba(255,255,255,0.2)",
                border: "1px solid rgba(255,255,255,0.34)"
              }}>
              <svg width="34" height="34" viewBox="0 0 36 36" fill="none">
                <path
                  d="M7 19L13.5 25.5L29 10"
                  stroke="#fff"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>

          <Kicker>All set</Kicker>
          <Title>Wallet created</Title>
          <Lede>Your wallet is encrypted and stored on this device. Open the extension to begin.</Lede>

          {savedAddress && (
            <div className="mt-6 space-y-2 text-left">
              <FactRow label="Label">{walletLabel.trim() || "Account"}</FactRow>
              <FactRow label="Address">
                {savedAddress.slice(0, 6)}…{savedAddress.slice(-4)}
              </FactRow>
              <FactRow label="Network">Monad</FactRow>
            </div>
          )}

          <div className="mt-7">
            <OpenWalletButton />
          </div>
        </Panel>
      )}
    </SetupShell>
  )
}
