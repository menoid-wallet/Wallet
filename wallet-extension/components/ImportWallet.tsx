/**
 * ImportWallet.tsx — Onboarding flow for the FIRST wallet, via import.
 *
 * Steps:
 *   method   → choose seed phrase OR private key.
 *   input    → paste the seed phrase / private key.
 *   name     → choose an in-wallet label (just a local alias).
 *   password → set the wallet password (encrypts the keys locally).
 *   done     → success screen.
 */

import React, { useState } from "react"
import {
  importFromMnemonic,
  importFromPrivateKey,
  type FullWallet
} from "../crypto/keyDerivation"
import { passwordStrength } from "../crypto/walletCrypto"
import { createInitialState } from "../lib/wallets"
import OpenWalletButton from "./OpenWalletButton"
import bs58 from "bs58"
import { fromBase64 } from "@mysten/bcs"
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
  StrengthMeter,
  TextArea,
  Title,
  useGaze
} from "./brand/SetupUI"

type Method = "seed" | "privatekey"
type Step = "method" | "input" | "name" | "password" | "done"

interface Props {
  onBack: () => void
}

export default function ImportWallet({ onBack }: Props) {
  const [step, setStep] = useState<Step>("method")
  const [method, setMethod] = useState<Method>("seed")
  const [input, setInput] = useState("")
  const [inputError, setInputError] = useState("")
  const [privateKeyNetwork, setPrivateKeyNetwork] = useState<
    "ethereum" | "solana" | "sui" | "aptos"
  >("ethereum")

  const [name, setName] = useState("")

  const [password, setPassword] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [pwError, setPwError] = useState("")
  const [saving, setSaving] = useState(false)

  const [derivedWallet, setDerivedWallet] = useState<FullWallet | null>(null)
  const [savedAddress, setSavedAddress] = useState("")

  // the mark in the header watches whatever field is being typed into
  const { gaze, setGaze } = useGaze()

  const strength = passwordStrength(password)

  function validateInput() {
    setInputError("")
    const val = input.trim()
    if (!val) {
      setInputError("Please enter your " + (method === "seed" ? "seed phrase" : "private key"))
      return false
    }
    if (method === "seed") {
      const words = val.split(/\s+/)
      if (words.length !== 12 && words.length !== 24) {
        setInputError("Seed phrase must be 12 or 24 words.")
        return false
      }
    } else {
      if (privateKeyNetwork === "ethereum" || privateKeyNetwork === "aptos") {
        const clean = val.replace(/^0x/, "")
        if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
          setInputError(
            `Invalid ${privateKeyNetwork === "ethereum" ? "Ethereum" : "Aptos"} private key. Must be 64 hex characters.`
          )
          return false
        }
      } else if (privateKeyNetwork === "solana") {
        try {
          const decoded = bs58.decode(val)
          if (decoded.length !== 64 && decoded.length !== 32) {
            setInputError("Invalid Solana private key length. Must decode to 32 or 64 bytes.")
            return false
          }
        } catch {
          const clean = val.replace(/^0x/, "")
          if (!/^[0-9a-fA-F]{64}$/.test(clean) && !/^[0-9a-fA-F]{128}$/.test(clean)) {
            setInputError("Invalid Solana private key format (must be base58 string or hex).")
            return false
          }
        }
      } else if (privateKeyNetwork === "sui") {
        if (val.startsWith("suiprivkey")) {
          if (val.length < 20) {
            setInputError("Invalid Sui private key format.")
            return false
          }
        } else {
          try {
            fromBase64(val)
          } catch {
            const clean = val.replace(/^0x/, "")
            if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
              setInputError(
                "Invalid Sui private key (must start with suiprivkey..., be Base64, or 64 hex characters)."
              )
              return false
            }
          }
        }
      }
    }
    return true
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
      const fullWallet =
        method === "seed"
          ? await importFromMnemonic(input.trim())
          : await importFromPrivateKey(input.trim(), privateKeyNetwork)
      setDerivedWallet(fullWallet)

      await createInitialState({
        name: name.trim() || "Account",
        password,
        fullWallet,
        registeredOpen: false,
        registeredNoid: false
      })

      let addressStr = ""
      if (fullWallet.importedNetwork === "solana") addressStr = fullWallet.solanaAccount?.address || ""
      else if (fullWallet.importedNetwork === "sui") addressStr = fullWallet.suiAccount?.address || ""
      else if (fullWallet.importedNetwork === "aptos") addressStr = fullWallet.aptosAccount?.address || ""
      else addressStr = fullWallet.normalAccount?.address || ""

      setSavedAddress(addressStr)

      setStep("done")
    } catch (e: any) {
      setPwError(e?.message ?? "Import failed. Check your credentials.")
      console.error("[ImportWallet] error:", e)
    } finally {
      setSaving(false)
    }
  }

  const stepOrder: Step[] = ["method", "input", "name", "password", "done"]

  return (
    <SetupShell
      steps={stepOrder}
      step={step}
      gaze={gaze}
      onBack={() => {
        const idx = stepOrder.indexOf(step)
        if (idx === 0) onBack()
        else setStep(stepOrder[idx - 1])
      }}>
      {/* ── METHOD ── */}
      {step === "method" && (
        <Panel>
          <Kicker>Import wallet</Kicker>
          <Title>How would you like to import?</Title>
          <Lede>Choose the method you have to hand.</Lede>

          <div className="mt-6 space-y-3">
            {(
              [
                ["seed", "📜", "Seed phrase", "Restore using your 12 or 24 word recovery phrase."],
                ["privatekey", "🔑", "Private key", "Import directly with your wallet's private key."]
              ] as const
            ).map(([m, icon, title, desc]) => {
              const active = method === m
              return (
                <button
                  key={m}
                  onClick={() => setMethod(m as Method)}
                  className="relative w-full overflow-hidden rounded-2xl p-4 text-left transition-all duration-300"
                  style={{
                    background: active ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.11)",
                    border: `1px solid ${active ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.20)"}`,
                    boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,0.4)" : "none"
                  }}>
                  <div className="flex items-start gap-3.5">
                    <span className="text-[22px] leading-none">{icon}</span>
                    <div className="min-w-0">
                      <h3 className="font-round text-[16px] font-semibold text-white">{title}</h3>
                      <p className="mt-0.5 font-round text-[12.5px] leading-relaxed text-white/68">
                        {desc}
                      </p>
                    </div>
                  </div>
                  {active && (
                    <span className="absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-white">
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path
                          d="M1 4L3.5 6.5L9 1"
                          stroke="#4E2F8E"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="mt-6">
            <CloudButton onClick={() => setStep("input")}>Continue</CloudButton>
          </div>
        </Panel>
      )}

      {/* ── INPUT ── */}
      {step === "input" && (
        <Panel>
          <Kicker>{method === "seed" ? "Seed phrase" : "Private key"}</Kicker>
          <Title>Enter your {method === "seed" ? "recovery phrase" : "private key"}</Title>
          <Lede>
            {method === "seed"
              ? "Type or paste your 12 or 24 word seed phrase, separated by spaces."
              : "Paste your hex-encoded private key (0x…)."}
          </Lede>

          {method === "privatekey" && (
            <div className="mt-6">
              <Label>Select network</Label>
              <div className="grid grid-cols-4 gap-2">
                {(
                  [
                    ["ethereum", "Ethereum"],
                    ["solana", "Solana"],
                    ["sui", "Sui"],
                    ["aptos", "Aptos"]
                  ] as const
                ).map(([net, label]) => {
                  const active = privateKeyNetwork === net
                  return (
                    <button
                      key={net}
                      type="button"
                      onClick={() => {
                        setPrivateKeyNetwork(net)
                        setInputError("")
                      }}
                      className="rounded-xl px-1 py-2 text-center font-round text-[11.5px] font-semibold transition-all"
                      style={{
                        background: active ? "#FFFFFF" : "rgba(255,255,255,0.11)",
                        color: active ? "var(--violet-deep)" : "rgba(255,255,255,0.75)",
                        border: `1px solid ${active ? "#FFFFFF" : "rgba(255,255,255,0.20)"}`
                      }}>
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="mt-5">
            {method === "seed" ? (
              <TextArea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="word1 word2 word3 … word12"
                rows={4}
                invalid={!!inputError}
              />
            ) : (
              <Field
                type="password"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  setGaze(caretPoint(e.target))
                }}
                onBlur={() => setGaze(null)}
                placeholder="Paste private key…"
                invalid={!!inputError}
                className="!font-mono"
              />
            )}
            <ErrorText>{inputError}</ErrorText>
          </div>

          <div className="mt-4">
            <Note>
              This extension stores data only on your device. Never enter credentials on websites.
            </Note>
          </div>

          <div className="mt-6">
            <CloudButton
              onClick={() => {
                if (validateInput()) setStep("name")
              }}>
              Continue
            </CloudButton>
          </div>
        </Panel>
      )}

      {/* ── NAME ── */}
      {step === "name" && (
        <Panel>
          <Kicker>Wallet name</Kicker>
          <Title>Name your account</Title>
          <Lede>
            This is your private in-wallet label — only visible to you. You can change it anytime.
          </Lede>

          <div className="mt-6">
            <Label>Account label</Label>
            <Field
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Main Account"
              onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep("password")}
            />
          </div>

          <div className="mt-6">
            <CloudButton disabled={!name.trim()} onClick={() => setStep("password")}>
              Continue — set password
            </CloudButton>
          </div>
        </Panel>
      )}

      {/* ── PASSWORD ── */}
      {step === "password" && (
        <Panel>
          <Kicker>Step 04</Kicker>
          <Title>Secure your wallet</Title>
          <Lede>Set a password to encrypt your keys on this device.</Lede>

          <div className="mt-6 space-y-5">
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
                <StrengthMeter
                  score={strength.score}
                  label={strength.label}
                  color={strength.color}
                />
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
                  Saving…
                </>
              ) : (
                "Import wallet"
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
                background: "radial-gradient(circle, rgba(255,255,255,0.55) 0%, transparent 70%)",
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

          <Kicker>Welcome back</Kicker>
          <Title>Wallet imported</Title>
          <Lede>Your wallet has been restored and encrypted on this device.</Lede>

          {savedAddress && (
            <div className="mt-6 space-y-2 text-left">
              <FactRow label="Name">{name.trim() || "Account"}</FactRow>
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
