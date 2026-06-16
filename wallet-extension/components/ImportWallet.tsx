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

import React, { useEffect, useState } from "react"
import {
  importFromMnemonic,
  importFromPrivateKey,
  type FullWallet
} from "../crypto/keyDerivation"
import { passwordStrength } from "../crypto/walletCrypto"
import { createInitialState } from "../lib/wallets"
import OpenWalletButton from "./OpenWalletButton"
import bs58 from "bs58"
import { fromBase64 } from "@mysten/bcs";

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
  const [privateKeyNetwork, setPrivateKeyNetwork] = useState<"ethereum" | "solana" | "sui" | "aptos">("ethereum")

  const [name, setName] = useState("")

  const [password, setPassword] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [pwError, setPwError] = useState("")
  const [saving, setSaving] = useState(false)

  const [derivedWallet, setDerivedWallet] = useState<FullWallet | null>(null)
  const [savedAddress, setSavedAddress] = useState("")

  const strength = passwordStrength(password)

  function validateInput() {
    setInputError("")
    const val = input.trim()
    if (!val) {
      setInputError(
        "Please enter your " + (method === "seed" ? "seed phrase" : "private key")
      )
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
          setInputError(`Invalid ${privateKeyNetwork === "ethereum" ? "Ethereum" : "Aptos"} private key. Must be 64 hex characters.`)
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
              setInputError("Invalid Sui private key (must start with suiprivkey..., be Base64, or 64 hex characters).")
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
          ? importFromMnemonic(input.trim())
          : importFromPrivateKey(input.trim(), privateKeyNetwork)
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

  const stepOrder: Step[] = [
    "method",
    "input",
    "name",
    "password",
    "done"
  ]

  return (
    <div className="relative min-h-screen w-full bg-cream font-body text-ink overflow-hidden">
      <Backdrop />

      <header className="relative z-20 flex items-center justify-between px-8 py-5 border-b border-ink/10">
        <button
          onClick={() => {
            const idx = stepOrder.indexOf(step)
            if (idx === 0) onBack()
            else setStep(stepOrder[idx - 1])
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
        {step === "method" && (
          <div className="animate-revealUp">
            <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">
              Import Wallet
            </p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-2">
              How would you
              <br />
              <span className="font-serif italic font-medium text-goldDeep">
                like to import?
              </span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed mb-10">
              Choose your preferred method to restore your wallet.
            </p>
            <div className="grid grid-cols-1 gap-4">
              {(
                [
                  [
                    "seed",
                    "📜",
                    "Seed Phrase",
                    "Restore using your 12 or 24 word recovery phrase."
                  ],
                  [
                    "privatekey",
                    "🔑",
                    "Private Key",
                    "Import directly with your wallet's private key."
                  ]
                ] as const
              ).map(([m, icon, title, desc]) => (
                <button
                  key={m}
                  onClick={() => setMethod(m as Method)}
                  className={`relative text-left p-5 rounded-2xl border transition-all duration-300 hover:-translate-y-[2px] ${
                    method === m
                      ? "bg-ink text-bone border-ink shadow-[0_18px_36px_-18px_rgba(23,19,17,0.5)]"
                      : "bg-bone text-ink border-ink/10 hover:border-goldDeep/40"
                  }`}>
                  <div className="flex items-start gap-4">
                    <span className="text-2xl">{icon}</span>
                    <div>
                      <h3 className="font-display text-[16px] font-semibold">
                        {title}
                      </h3>
                      <p
                        className={`text-[12px] mt-1 leading-relaxed ${
                          method === m ? "text-bone/65" : "text-ink/55"
                        }`}>
                        {desc}
                      </p>
                    </div>
                  </div>
                  {method === m && (
                    <div className="absolute top-4 right-4 h-5 w-5 rounded-full bg-goldDeep flex items-center justify-center">
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path
                          d="M1 4L3.5 6.5L9 1"
                          stroke="#FBF1D9"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep("input")}
              className="mt-8 w-full rounded-2xl bg-ink text-bone py-4 font-display text-[13px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[2px]">
              Continue
            </button>
          </div>
        )}

        {step === "input" && (
          <div className="animate-revealUp">
            <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">
              {method === "seed" ? "Seed Phrase" : "Private Key"}
            </p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-2">
              Enter your
              <br />
              <span className="font-serif italic font-medium text-goldDeep">
                {method === "seed" ? "Recovery Phrase" : "Private Key"}
              </span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed mb-8">
              {method === "seed"
                ? "Type or paste your 12 or 24 word seed phrase, separated by spaces."
                : "Paste your hex-encoded private key (0x...)."}
            </p>

            {method === "privatekey" && (
              <div className="mb-6">
                <label className="block text-[10px] tracking-[0.3em] uppercase text-ink/50 mb-2.5">
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
                        setInputError("")
                      }}
                      className={`py-2 px-1 text-center rounded-xl border text-[11px] font-semibold tracking-wider transition-all uppercase ${
                        privateKeyNetwork === net
                          ? "bg-ink text-bone border-ink"
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
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="word1 word2 word3 … word12"
                rows={4}
                className="w-full rounded-xl bg-ink/[0.05] border border-ink/12 px-4 py-3 text-[14px] placeholder-ink/30 focus:outline-none focus:border-goldDeep/60 transition-colors resize-none font-mono leading-relaxed"
              />
            ) : (
              <input
                type="password"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Paste private key..."
                className="w-full rounded-xl bg-ink/[0.05] border border-ink/12 px-4 py-3 text-[14px] placeholder-ink/30 focus:outline-none focus:border-goldDeep/60 transition-colors font-mono"
              />
            )}

            {inputError && (
              <p className="mt-2 text-[12px] text-red-500 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                {inputError}
              </p>
            )}
            <div className="mt-4 flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <span className="text-amber-500 text-sm mt-0.5">⚠</span>
              <p className="text-[11px] text-ink/60 leading-relaxed">
                This extension stores data only on your device. Never enter
                credentials on websites.
              </p>
            </div>
            <button
              onClick={() => {
                if (validateInput()) setStep("name")
              }}
              className="mt-8 w-full rounded-2xl bg-ink text-bone py-4 font-display text-[13px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[2px]">
              Continue
            </button>
          </div>
        )}

        {step === "name" && (
          <div className="animate-revealUp">
            <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">
              Wallet Name
            </p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-2">
              Name Your
              <br />
              <span className="font-serif italic font-medium text-goldDeep">
                Account
              </span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed mb-8">
              This is your private in-wallet label — only visible to you. You can change it anytime.
            </p>

            <label className="block text-[10px] tracking-[0.3em] uppercase text-ink/50 mb-2">
              Account label
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Main Account"
              className="w-full rounded-xl bg-ink/[0.05] border border-ink/12 px-4 py-3 text-[14px] placeholder-ink/30 focus:outline-none focus:border-goldDeep/60 transition-colors"
            />

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
              Step 04
            </p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-2">
              Secure Your
              <br />
              <span className="font-serif italic font-medium text-goldDeep">
                Wallet
              </span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed mb-8">
              Set a password to encrypt your keys locally.
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
                    <p
                      className="text-[11px]"
                      style={{ color: strength.color }}>
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
                  Saving…
                </>
              ) : (
                "Import Wallet"
              )}
            </button>
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
              Welcome Back
            </p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-3">
              Wallet Imported
              <br />
              <span className="font-serif italic font-medium text-goldDeep">
                Successfully
              </span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed max-w-[320px] mb-8">
              Your wallet has been restored and encrypted locally.
            </p>
            {savedAddress && (
              <div className="w-full space-y-2 mb-8">
                <div className="flex items-center justify-between p-3 rounded-xl bg-ink/[0.04] border border-ink/10">
                  <span className="text-[11px] tracking-[0.25em] uppercase text-ink/50">
                    Name
                  </span>
                  <span className="font-mono text-[11px] text-ink/70">
                    {name.trim() || "Account"}
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

function Backdrop() {
  return (
    <>
      <div className="fixed inset-0 bg-gradient-to-br from-[#FBF1D9] via-cream to-parchment" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_80%_20%,_rgba(232,174,58,0.25)_0%,_rgba(246,233,208,0)_55%)]" />
      <div className="pointer-events-none fixed inset-0 paper-grain opacity-35" />
    </>
  )
}
