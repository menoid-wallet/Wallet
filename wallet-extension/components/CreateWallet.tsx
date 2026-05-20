/**
 * CreateWallet.tsx
 *
 * Step 1 — Show seed phrase (generated sync, no WASM)
 * Step 2 — Set password
 * Step 3 — On "Create Wallet" click: derive ZK keys via background, encrypt, store
 * Step 4 — Done / Open Extension
 *
 * Key fix: ZK derivation (sendMessage to background) happens only at save time,
 * NOT eagerly on mount. This ensures the service worker is awake and listening.
 */

import React, { useEffect, useRef, useState } from "react";
import { generateMnemonicOnly, generatePrivateWallet } from "../crypto/keyDerivation";
import { encryptWallet, passwordStrength } from "../crypto/walletCrypto";
import type { WalletKeys } from "../crypto/walletCrypto";

type Step = "seed" | "password" | "done";

interface Props {
  onBack: () => void;
}

export default function CreateWallet({ onBack }: Props) {
  const [step, setStep] = useState<Step>("seed");
  const [mnemonic, setMnemonic] = useState("");
  const [genError, setGenError] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // Store the raw private key so we can derive on save
  const privateKeyRef = useRef("");

  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingLabel, setSavingLabel] = useState("Encrypting…");
  const [savedAddress, setSavedAddress] = useState("");

  const strength = passwordStrength(password);

  // Generate mnemonic synchronously — no WASM, instant
  useEffect(() => {
    try {
      const { mnemonic: m, privateKey } = generateMnemonicOnly();
      setMnemonic(m);
      privateKeyRef.current = privateKey;
    } catch (e: any) {
      setGenError("Failed to generate wallet: " + (e?.message ?? String(e)));
    }
  }, []);

  function copyPhrase() {
    if (!mnemonic) return;
    navigator.clipboard.writeText(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSave() {
    if (password.length < 8) { setPwError("Password must be at least 8 characters."); return; }
    if (password !== confirmPw) { setPwError("Passwords don't match."); return; }
    setPwError("");
    setSaving(true);

    try {
      // Step A: derive ZK keys via background worker (WASM runs there)
      setSavingLabel("Deriving keys…");
      const derived = await generatePrivateWallet(privateKeyRef.current + "Menoid wallet");

      // Step B: encrypt locally with Web Crypto
      setSavingLabel("Encrypting…");
      const keys: WalletKeys = {
        address: derived.privateWallet.address,
        privateKey: derived.privateWallet.privateKey,
        publicKey: derived.privateWallet.publicKey,
        zkSecretKey: derived.zk.secretKey,
        zkPublicKey: derived.zk.publicKey,
        seedPhrase: mnemonic,
      };
      const encrypted = await encryptWallet(keys, password);

      // Step C: persist
      setSavingLabel("Saving…");
      await chrome.storage.local.set({
        menoid_wallet: JSON.stringify(encrypted),
        menoid_onboarding: true,
      });

      setSavedAddress(derived.privateWallet.address);
      setStep("done");
    } catch (e: any) {
      setPwError((e?.message ?? "Unknown error") + " — check console for details.");
      console.error("[CreateWallet] handleSave error:", e);
    } finally {
      setSaving(false);
      setSavingLabel("Encrypting…");
    }
  }

  const words = mnemonic ? mnemonic.split(" ") : [];

  return (
    <div className="relative min-h-screen w-full bg-cream font-body text-ink overflow-hidden">
      <Backdrop />

      {/* Header */}
      <header className="relative z-20 flex items-center justify-between px-8 py-5 border-b border-ink/10">
        <button
          onClick={onBack}
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
          {(["seed", "password", "done"] as Step[]).map((s) => {
            const order = ["seed", "password", "done"];
            const cur = order.indexOf(step);
            const idx = order.indexOf(s);
            return (
              <div key={s} className={`h-1.5 rounded-full transition-all duration-500 ${
                s === step ? "w-6 bg-goldDeep" : idx < cur ? "w-3 bg-goldDeep/50" : "w-3 bg-ink/15"
              }`} />
            );
          })}
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-[540px] px-8 py-12">

        {/* ─── Step 1: Seed Phrase ─── */}
        {step === "seed" && (
          <div className="animate-revealUp">
            <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">Step 01</p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-2">
              Your Secret<br />
              <span className="font-serif italic font-medium text-goldDeep">Recovery Phrase</span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed mb-8">
              Write these 12 words down in order and keep them safe. This is the only way to recover your wallet.
            </p>

            {genError ? (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-[13px]">{genError}</div>
            ) : words.length === 0 ? (
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="h-10 rounded-xl bg-ink/5 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {words.map((word, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-xl bg-ink/[0.05] border border-ink/10 px-3 py-2.5">
                    <span className="font-serif italic text-[10px] text-goldDeep w-4 shrink-0">{i + 1}</span>
                    <span className="font-display text-[13px] font-semibold">{word}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3">
              <button
                onClick={copyPhrase}
                disabled={!mnemonic}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-goldDeep/40 text-goldDeep text-[11px] tracking-[0.3em] uppercase hover:bg-goldDeep/10 transition-colors disabled:opacity-40">
                {copied ? (
                  <><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7L5.5 10.5L12 3" stroke="#A36E14" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>Copied!</>
                ) : (
                  <><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="4" y="4" width="8" height="8" rx="1.5" stroke="#A36E14" strokeWidth="1.2"/><path d="M1 9V2a1 1 0 011-1h7" stroke="#A36E14" strokeWidth="1.2" strokeLinecap="round"/></svg>Copy phrase</>
                )}
              </button>
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <span className="text-amber-500 text-sm mt-0.5">⚠</span>
                <p className="text-[11px] text-ink/60 leading-relaxed">Never share your recovery phrase. Anyone with it has full access to your wallet.</p>
              </div>
            </div>

            <label className="mt-6 flex items-start gap-3 cursor-pointer">
              <div
                onClick={() => setConfirmed((v) => !v)}
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${confirmed ? "bg-goldDeep border-goldDeep" : "border-ink/25 bg-transparent"}`}>
                {confirmed && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="#FBF1D9" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <span className="text-[12px] text-ink/60 leading-relaxed">I've saved my recovery phrase somewhere safe.</span>
            </label>

            <button
              disabled={!confirmed || !mnemonic}
              onClick={() => setStep("password")}
              className="mt-8 w-full rounded-2xl bg-ink text-bone py-4 font-display text-[13px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[2px] hover:shadow-[0_16px_32px_-16px_rgba(23,19,17,0.6)] disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none">
              Continue — Set Password
            </button>
          </div>
        )}

        {/* ─── Step 2: Password ─── */}
        {step === "password" && (
          <div className="animate-revealUp">
            <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">Step 02</p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-2">
              Secure Your<br />
              <span className="font-serif italic font-medium text-goldDeep">Wallet</span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed mb-8">
              This password encrypts your keys locally. It cannot be recovered.
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
                      {[0,1,2,3].map((i) => (
                        <div key={i} className="h-1 flex-1 rounded-full transition-all duration-300"
                          style={{ backgroundColor: i < strength.score ? strength.color : "rgba(23,19,17,0.1)" }} />
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
                {confirmPw.length > 0 && password !== confirmPw && (
                  <p className="mt-1 text-[11px] text-red-500">Passwords don't match</p>
                )}
              </div>
              {pwError && (
                <p className="text-[12px] text-red-500 p-3 rounded-xl bg-red-500/10 border border-red-500/20">{pwError}</p>
              )}
            </div>

            <button
              disabled={saving || strength.score < 2 || password !== confirmPw || !password}
              onClick={handleSave}
              className="mt-8 w-full rounded-2xl bg-ink text-bone py-4 font-display text-[13px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[2px] hover:shadow-[0_16px_32px_-16px_rgba(23,19,17,0.6)] disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-3">
              {saving ? (
                <><span className="h-4 w-4 rounded-full border-2 border-bone/30 border-t-bone animate-spin" />{savingLabel}</>
              ) : "Create Wallet"}
            </button>
          </div>
        )}

        {/* ─── Step 3: Done ─── */}
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
            <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">All Set</p>
            <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-3">
              Wallet Created<br />
              <span className="font-serif italic font-medium text-goldDeep">Successfully</span>
            </h2>
            <p className="text-[13px] text-ink/55 leading-relaxed max-w-[320px] mb-10">
              Your wallet is encrypted and stored locally. Open the extension to start your journey on Monad.
            </p>
            {savedAddress && (
              <div className="w-full space-y-3 mb-8">
                <div className="flex items-center justify-between p-3 rounded-xl bg-ink/[0.04] border border-ink/10">
                  <span className="text-[11px] tracking-[0.25em] uppercase text-ink/50">Address</span>
                  <span className="font-mono text-[11px] text-ink/70">{savedAddress.slice(0,6)}…{savedAddress.slice(-4)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-ink/[0.04] border border-ink/10">
                  <span className="text-[11px] tracking-[0.25em] uppercase text-ink/50">Network</span>
                  <span className="text-[11px] text-ink/70 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Monad
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

function Backdrop() {
  return (
    <>
      <div className="fixed inset-0 bg-gradient-to-br from-[#FBF1D9] via-cream to-parchment" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_80%_20%,_rgba(232,174,58,0.25)_0%,_rgba(246,233,208,0)_55%)]" />
      <div className="pointer-events-none fixed inset-0 paper-grain opacity-35" />
    </>
  );
}