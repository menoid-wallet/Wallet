/**
 * ImportWallet.tsx
 * Step 1 — Choose import method (seed phrase | private key)
 * Step 2 — Enter phrase/key + validate
 * Step 3 — Set password
 * Step 4 — Done
 */

import React, { useState } from "react";
import { importFromMnemonic, importFromPrivateKey } from "../crypto/keyDerivation";
import { encryptWallet, passwordStrength } from "../crypto/walletCrypto";
import type { WalletKeys } from "../crypto/walletCrypto";
import type { DerivedWallet } from "../crypto/keyDerivation";
import { ethers } from "ethers";

type Method = "seed" | "privatekey";
type Step = "method" | "input" | "password" | "done";

interface Props {
  onBack: () => void;
}

export default function ImportWallet({ onBack }: Props) {
  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<Method>("seed");
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState("");
  const [derived, setDerived] = useState<DerivedWallet | null>(null);

  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);

  const strength = passwordStrength(password);

  function validateAndNext() {
    setInputError("");
    const val = input.trim();
    if (!val) { setInputError("Please enter your " + (method === "seed" ? "seed phrase" : "private key")); return; }
    if (method === "seed") {
      const words = val.split(/\s+/);
      if (words.length !== 12 && words.length !== 24) {
        setInputError("Seed phrase must be 12 or 24 words."); return;
      }
    } else {
      if (!/^0x[0-9a-fA-F]{64}$/.test(val)) {
        setInputError("Invalid private key format. Must be 0x followed by 64 hex characters."); return;
      }
    }
    setStep("password");
  }

  async function handleSave() {
    if (!derived) {
      // derive on save (not before, for security)
    }
    if (password.length < 8) { setPwError("Password must be at least 8 characters."); return; }
    if (password !== confirmPw) { setPwError("Passwords don't match."); return; }
    setPwError("");
    setSaving(true);
    try {
      setImporting(true);
      let d: DerivedWallet;
      if (method === "seed") {
        // Get the raw private key from mnemonic first for address
        const baseWallet = ethers.Wallet.fromPhrase(input.trim());
        d = await importFromMnemonic(input.trim());
      } else {
        d = await importFromPrivateKey(input.trim());
      }
      setDerived(d);

      const keys: WalletKeys = {
        address: d.privateWallet.address,
        privateKey: d.privateWallet.privateKey,
        publicKey: d.privateWallet.publicKey,
        zkSecretKey: d.zk.secretKey,
        zkPublicKey: d.zk.publicKey,
        seedPhrase: method === "seed" ? input.trim() : undefined,
      };
      const encrypted = await encryptWallet(keys, password);
      await chrome.storage.local.set({
        menoid_wallet: JSON.stringify(encrypted),
        menoid_onboarding: true,
      });
      setStep("done");
    } catch (e: any) {
      setPwError(e.message || "Import failed. Please check your credentials.");
    } finally {
      setSaving(false);
      setImporting(false);
    }
  }

  return (
    <div className="relative min-h-screen w-full bg-cream font-body text-ink overflow-hidden">
      <Backdrop />

      {/* Header */}
      <header className="relative z-20 flex items-center justify-between px-8 py-5 border-b border-ink/10">
        <button
          onClick={step === "method" ? onBack : () => {
            if (step === "input") setStep("method");
            else if (step === "password") setStep("input");
          }}
          className="flex items-center gap-2 text-[11px] tracking-[0.3em] uppercase text-ink/50 hover:text-ink transition-colors">
          <svg width="18" height="9" viewBox="0 0 18 9" fill="none">
            <path d="M18 4.5H2M2 4.5L5.5 1M2 4.5L5.5 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          Back
        </button>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-goldDeep" />
          <span className="font-display text-[11px] font-semibold tracking-[0.3em] text-ink">MENOID</span>
        </div>
        <div className="flex items-center gap-2">
          {(["method", "input", "password", "done"] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                step === s ? "w-6 bg-goldDeep" : i < ["method","input","password","done"].indexOf(step) ? "w-3 bg-goldDeep/50" : "w-3 bg-ink/15"
              }`}
            />
          ))}
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-[540px] px-8 py-12">

        {/* ─── Step 1: Choose Method ─── */}
        {step === "method" && (
          <div className="animate-revealUp">
            <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">Import Wallet</p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-2">
              How would you<br />
              <span className="font-serif italic font-medium text-goldDeep">like to import?</span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed mb-10">
              Choose your preferred method to restore your existing wallet.
            </p>

            <div className="grid grid-cols-1 gap-4">
              <MethodCard
                active={method === "seed"}
                icon="📜"
                title="Seed Phrase"
                desc="Restore using your 12 or 24 word recovery phrase."
                onClick={() => setMethod("seed")}
              />
              <MethodCard
                active={method === "privatekey"}
                icon="🔑"
                title="Private Key"
                desc="Import directly with your wallet's private key."
                onClick={() => setMethod("privatekey")}
              />
            </div>

            <button
              onClick={() => setStep("input")}
              className="mt-8 w-full rounded-2xl bg-ink text-bone py-4 font-display text-[13px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[2px] hover:shadow-[0_16px_32px_-16px_rgba(23,19,17,0.6)] flex items-center justify-center gap-3">
              Continue
              <svg width="20" height="8" viewBox="0 0 20 8" fill="none">
                <path d="M0 4H18M18 4L14.5 1M18 4L14.5 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        {/* ─── Step 2: Enter seed/key ─── */}
        {step === "input" && (
          <div className="animate-revealUp">
            <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">
              {method === "seed" ? "Seed Phrase" : "Private Key"}
            </p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-2">
              {method === "seed" ? (
                <>Enter your<br /><span className="font-serif italic font-medium text-goldDeep">Recovery Phrase</span></>
              ) : (
                <>Enter your<br /><span className="font-serif italic font-medium text-goldDeep">Private Key</span></>
              )}
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed mb-8">
              {method === "seed"
                ? "Type or paste your 12 or 24 word seed phrase, separated by spaces."
                : "Paste your hex-encoded private key (0x...)."}
            </p>

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
                placeholder="0x..."
                className="w-full rounded-xl bg-ink/[0.05] border border-ink/12 px-4 py-3 text-[14px] placeholder-ink/30 focus:outline-none focus:border-goldDeep/60 transition-colors font-mono"
              />
            )}

            {inputError && (
              <p className="mt-2 text-[12px] text-red-500 p-3 rounded-xl bg-red-500/10 border border-red-500/20">{inputError}</p>
            )}

            <div className="mt-4 flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <span className="text-amber-500 text-sm mt-0.5">⚠</span>
              <p className="text-[11px] text-ink/60 leading-relaxed">
                Never enter your seed phrase or private key on any website. This extension stores data only on your device.
              </p>
            </div>

            <button
              onClick={validateAndNext}
              className="mt-8 w-full rounded-2xl bg-ink text-bone py-4 font-display text-[13px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[2px] hover:shadow-[0_16px_32px_-16px_rgba(23,19,17,0.6)]">
              Continue
            </button>
          </div>
        )}

        {/* ─── Step 3: Password ─── */}
        {step === "password" && (
          <div className="animate-revealUp">
            <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">Step 03</p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-2">
              Secure Your<br />
              <span className="font-serif italic font-medium text-goldDeep">Wallet</span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed mb-8">
              Set a password to encrypt your keys locally. This cannot be recovered.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] tracking-[0.3em] uppercase text-ink/50 mb-2">Password</label>
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
                          style={{ backgroundColor: i < strength.score ? strength.color : "rgba(23,19,17,0.1)" }}
                        />
                      ))}
                    </div>
                    <p className="text-[11px]" style={{ color: strength.color }}>{strength.label}</p>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.3em] uppercase text-ink/50 mb-2">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full rounded-xl bg-ink/[0.05] border border-ink/12 px-4 py-3 text-[14px] placeholder-ink/30 focus:outline-none focus:border-goldDeep/60 transition-colors"
                />
              </div>
              {pwError && (
                <p className="text-[12px] text-red-500 p-3 rounded-xl bg-red-500/10 border border-red-500/20">{pwError}</p>
              )}
            </div>

            <button
              disabled={saving || strength.score < 2 || password !== confirmPw}
              onClick={handleSave}
              className="mt-8 w-full rounded-2xl bg-ink text-bone py-4 font-display text-[13px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[2px] hover:shadow-[0_16px_32px_-16px_rgba(23,19,17,0.6)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3">
              {saving ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-bone/30 border-t-bone animate-spin" />
                  {importing ? "Deriving keys…" : "Encrypting…"}
                </>
              ) : "Import Wallet"}
            </button>
          </div>
        )}

        {/* ─── Step 4: Done ─── */}
        {step === "done" && (
          <div className="animate-revealUp flex flex-col items-center text-center py-8">
            <div className="relative mb-8">
              <div className="h-24 w-24 rounded-full bg-goldDeep/20 flex items-center justify-center">
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                  <path d="M7 19L13.5 25.5L29 10" stroke="#A36E14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="absolute inset-0 rounded-full bg-gold/30 blur-xl animate-shimmer" />
            </div>
            <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">Welcome Back</p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-3">
              Wallet Imported<br />
              <span className="font-serif italic font-medium text-goldDeep">Successfully</span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed max-w-[320px] mb-10">
              Your wallet has been restored and encrypted locally. Open the Menoid extension to continue.
            </p>
            {derived && (
              <div className="w-full space-y-3 mb-8">
                <div className="flex items-center justify-between p-3 rounded-xl bg-ink/[0.04] border border-ink/10">
                  <span className="text-[11px] tracking-[0.25em] uppercase text-ink/50">Address</span>
                  <span className="font-mono text-[11px] text-ink/70">
                    {derived.privateWallet.address.slice(0, 6)}…{derived.privateWallet.address.slice(-4)}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-ink/[0.04] border border-ink/10">
                  <span className="text-[11px] tracking-[0.25em] uppercase text-ink/50">Network</span>
                  <span className="text-[11px] text-ink/70 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Monad
                  </span>
                </div>
              </div>
            )}
            <button
              onClick={() => window.close()}
              className="w-full rounded-2xl bg-ink text-bone py-4 font-display text-[13px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[2px] hover:shadow-[0_16px_32px_-16px_rgba(23,19,17,0.6)] flex items-center justify-center gap-3">
              Open Extension Now
              <svg width="20" height="8" viewBox="0 0 20 8" fill="none">
                <path d="M0 4H18M18 4L14.5 1M18 4L14.5 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MethodCard({
  active,
  icon,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  icon: string;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative text-left p-5 rounded-2xl border transition-all duration-300 hover:-translate-y-[2px] ${
        active
          ? "bg-ink text-bone border-ink shadow-[0_18px_36px_-18px_rgba(23,19,17,0.5)]"
          : "bg-bone text-ink border-ink/10 hover:border-goldDeep/40"
      }`}>
      <div className="flex items-start gap-4">
        <span className="text-2xl">{icon}</span>
        <div>
          <h3 className="font-display text-[16px] font-semibold">{title}</h3>
          <p className={`text-[12px] mt-1 leading-relaxed ${active ? "text-bone/65" : "text-ink/55"}`}>{desc}</p>
        </div>
      </div>
      {active && (
        <div className="absolute top-4 right-4 h-5 w-5 rounded-full bg-goldDeep flex items-center justify-center">
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="#FBF1D9" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </button>
  );
}

function Backdrop() {
  return (
    <>
      <div className="fixed inset-0 bg-gradient-to-br from-[#FBF1D9] via-cream to-parchment" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_80%_20%,_rgba(232,174,58,0.25)_0%,_rgba(246,233,208,0)_55%)]" />
      <div className="pointer-events-none fixed inset-0 paper-grain opacity-35" />
    </>
  );
}