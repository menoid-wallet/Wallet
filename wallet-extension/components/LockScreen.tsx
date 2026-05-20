/**
 * LockScreen.tsx
 * Shows Meno + password field.
 * On correct password: decrypts stored wallet and calls onUnlock.
 */

import React, { useState } from "react";
import menoImg from "data-base64:~assets/meno/meno_hi_text.png";
import { decryptWallet } from "../crypto/walletCrypto";
import type { EncryptedWallet, WalletKeys } from "../crypto/walletCrypto";

interface Props {
  onUnlock: (keys: WalletKeys) => void;
}

export default function LockScreen({ onUnlock }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  async function handleUnlock() {
    if (!password) { setError("Enter your password."); return; }
    setLoading(true);
    setError("");
    try {
      const result = await chrome.storage.local.get("menoid_wallet");
      if (!result.menoid_wallet) throw new Error("Wallet not found.");
      const encrypted: EncryptedWallet = JSON.parse(result.menoid_wallet);
      const keys = await decryptWallet(encrypted, password);
      onUnlock(keys);
    } catch (e: any) {
      setError(e.message === "Wrong password" ? "Wrong password. Try again." : "Decryption failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative w-[360px] h-[600px] bg-cream font-body text-ink overflow-hidden">
      <Backdrop />

      {/* Top label */}
      <div className="relative z-20 flex items-center justify-center pt-8 pb-0">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-goldDeep" />
          <span className="font-display text-[11px] font-semibold tracking-[0.35em] text-ink">MENOID</span>
        </div>
      </div>

      {/* Meno stage */}
      <div className="relative z-10 flex items-center justify-center mt-2">
        <div className="relative flex items-center justify-center" style={{ width: 180, height: 180 }}>
          {/* halo */}
          <div className="absolute inset-0 rounded-full bg-gold/30 blur-2xl animate-shimmer" />

          {/* compass ring */}
          <svg
            width="180" height="180"
            viewBox="0 0 180 180"
            className="absolute animate-spinSlow opacity-60">
            <circle cx="90" cy="90" r="86" fill="none" stroke="#171311" strokeOpacity="0.12" strokeWidth="1" />
            {Array.from({ length: 60 }).map((_, i) => {
              const angle = (i / 60) * 360;
              const isMajor = i % 5 === 0;
              return (
                <line
                  key={i}
                  x1="90" y1="4" x2="90" y2={4 + (isMajor ? 8 : 3)}
                  stroke="#171311"
                  strokeOpacity={isMajor ? 0.45 : 0.18}
                  strokeWidth={isMajor ? 1.1 : 0.6}
                  transform={`rotate(${angle} 90 90)`}
                />
              );
            })}
          </svg>

          {/* inner ring */}
          <svg
            width="146" height="146"
            viewBox="0 0 146 146"
            className="absolute animate-spinReverse opacity-50">
            <circle cx="73" cy="73" r="69" fill="none" stroke="#171311" strokeOpacity="0.08" strokeWidth="1" />
          </svg>

          {/* Meno */}
          <div className="relative animate-float will-change-transform z-10">
            <img
              src={menoImg}
              alt="Meno"
              style={{ mixBlendMode: "multiply", width: 130 }}
              className="drop-shadow-[0_16px_12px_rgba(28,20,12,0.25)]"
            />
          </div>

          {/* Ground shadow */}
          <div className="absolute bottom-[10%] h-2 w-[30%] rounded-full bg-ink/20 blur-md animate-shimmer" />
        </div>
      </div>

      {/* Content */}
      <div className="relative z-20 px-6 mt-3">
        <p className="text-center font-serif italic text-[13px] text-goldDeep mb-1">Welcome back</p>
        <h2 className="text-center font-display text-[22px] font-bold tracking-[-0.025em] mb-1">
          Unlock your wallet
        </h2>
        <p className="text-center text-[11px] text-ink/45 mb-6">Enter your password to continue</p>

        {/* Password input */}
        <div className="relative">
          <input
            type={showPw ? "text" : "password"}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
            placeholder="Password"
            className="w-full rounded-xl bg-ink/[0.06] border border-ink/12 px-4 py-3 pr-10 text-[14px] placeholder-ink/30 focus:outline-none focus:border-goldDeep/60 transition-colors"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/35 hover:text-ink/60 transition-colors">
            {showPw ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M1 8S3.5 3 8 3s7 5 7 5-2.5 5-7 5S1 8 1 8Z" stroke="currentColor" strokeWidth="1.2"/>
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/>
                <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M1 8S3.5 3 8 3s7 5 7 5-2.5 5-7 5S1 8 1 8Z" stroke="currentColor" strokeWidth="1.2"/>
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
            )}
          </button>
        </div>

        {error && (
          <p className="mt-2 text-[11px] text-red-500 text-center">{error}</p>
        )}

        <button
          onClick={handleUnlock}
          disabled={loading || !password}
          className="mt-4 w-full rounded-2xl bg-ink text-bone py-3.5 font-display text-[12px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[2px] hover:shadow-[0_12px_24px_-12px_rgba(23,19,17,0.6)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          {loading ? (
            <>
              <span className="h-3.5 w-3.5 rounded-full border-2 border-bone/30 border-t-bone animate-spin" />
              Unlocking…
            </>
          ) : "Unlock"}
        </button>

        {/* Tagline */}
        <div className="mt-6 flex items-center justify-center gap-3">
          <span className="h-px w-6 bg-goldDeep/50" />
          <p className="font-serif italic text-[11px] text-ink/40">Yer keys, yer kingdom.</p>
          <span className="h-px w-6 bg-goldDeep/50" />
        </div>
      </div>
    </div>
  );
}

function Backdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-gradient-to-b from-[#FBF1D9] via-cream to-parchment" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,_rgba(232,174,58,0.28)_0%,_rgba(246,233,208,0)_60%)]" />
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-30" />
    </>
  );
}