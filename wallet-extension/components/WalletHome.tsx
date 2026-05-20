/**
 * WalletHome.tsx
 * Main wallet view shown after unlock.
 * NoidMode toggle switches between standard wallet view and ZK/Menoid-derived keys.
 */

import React, { useState } from "react";
import { useWallet } from "../context/WalletContext";

export default function WalletHome() {
  const { keys, noidMode, toggleNoidMode, lock } = useWallet();
  const [copied, setCopied] = useState<string | null>(null);

  if (!keys) return null;

  function copy(val: string, label: string) {
    navigator.clipboard.writeText(val);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  function truncate(str: string, start = 6, end = 4) {
    return str.length > start + end + 3
      ? `${str.slice(0, start)}…${str.slice(-end)}`
      : str;
  }

  const displayAddress = noidMode ? keys.address : keys.address;
  const displayPublicKey = noidMode ? keys.zkPublicKey : keys.publicKey;
  const displayPrivateKey = noidMode ? keys.zkSecretKey : keys.privateKey;
  const keyLabel = noidMode ? "ZK Secret Key" : "Private Key";
  const pubKeyLabel = noidMode ? "ZK Public Key" : "Public Key";

  return (
    <div className="relative w-[360px] h-[600px] bg-cream font-body text-ink overflow-hidden flex flex-col">
      <Backdrop />

      {/* ─── Header ─── */}
      <header className="relative z-20 flex items-center justify-between px-5 pt-5 pb-4 border-b border-ink/10">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-goldDeep" />
          <span className="font-display text-[11px] font-semibold tracking-[0.3em] text-ink">MENOID</span>
        </div>

        {/* NoidMode toggle */}
        <button
          onClick={toggleNoidMode}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-semibold tracking-[0.25em] uppercase transition-all duration-300 ${
            noidMode
              ? "bg-ink text-bone border-ink shadow-[0_4px_12px_-4px_rgba(23,19,17,0.5)]"
              : "bg-transparent text-ink/60 border-ink/20 hover:border-goldDeep/50 hover:text-goldDeep"
          }`}>
          <span className={`h-1.5 w-1.5 rounded-full transition-colors ${noidMode ? "bg-goldDeep" : "bg-ink/30"}`} />
          {noidMode ? "Noid Mode" : "Normal"}
        </button>

        <button
          onClick={lock}
          title="Lock wallet"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/[0.06] hover:bg-ink/12 transition-colors">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="2" y="6" width="10" height="7" rx="1.5" stroke="#171311" strokeOpacity="0.6" strokeWidth="1.2"/>
            <path d="M4 6V4.5a3 3 0 116 0V6" stroke="#171311" strokeOpacity="0.6" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </button>
      </header>

      {/* ─── Scroll body ─── */}
      <div className="relative z-10 flex-1 overflow-y-auto">

        {/* Network badge + balance card */}
        <div className="px-5 pt-5">
          <div className="relative rounded-3xl bg-ink text-bone overflow-hidden p-5">
            {/* card glow */}
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_15%,_rgba(232,174,58,0.35),transparent_55%)]" />
            <div className="pointer-events-none absolute inset-0 opacity-[0.03] [background-image:linear-gradient(to_right,#FBF1D9_1px,transparent_1px),linear-gradient(to_bottom,#FBF1D9_1px,transparent_1px)] [background-size:32px_32px]" />

            <div className="relative">
              {/* Top row */}
              <div className="flex items-start justify-between mb-5">
                <div>
                  <p className="text-[9px] tracking-[0.4em] uppercase text-bone/45 mb-1">
                    {noidMode ? "Noid Address" : "Wallet Address"}
                  </p>
                  <button
                    onClick={() => copy(keys.address, "address")}
                    className="flex items-center gap-1.5 font-mono text-[12px] text-bone/80 hover:text-bone transition-colors">
                    {truncate(keys.address)}
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                      <rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1"/>
                      <path d="M1 7.5V1.5a1 1 0 011-1h6" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bone/10 border border-bone/15">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[9px] tracking-[0.3em] uppercase text-bone/60">Monad</span>
                </div>
              </div>

              {/* Balance */}
              <div className="mb-1">
                <p className="text-[9px] tracking-[0.35em] uppercase text-bone/40 mb-1">Balance</p>
                <p className="font-display text-[36px] font-bold tracking-[-0.025em] leading-none">
                  0.00
                  <span className="text-[18px] text-bone/50 ml-1.5">MON</span>
                </p>
              </div>
              <p className="text-[11px] text-bone/35">≈ $0.00 USD</p>
            </div>

            {/* Copied toast */}
            {copied === "address" && (
              <div className="absolute bottom-3 right-3 text-[10px] text-goldDeep bg-ink/80 px-2.5 py-1 rounded-full">
                Copied!
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="px-5 mt-4 grid grid-cols-3 gap-2">
          {["Send", "Receive", "Swap"].map((label) => (
            <button
              key={label}
              className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-ink/[0.05] border border-ink/10 hover:border-goldDeep/40 hover:bg-goldDeep/5 transition-all">
              <span className="text-base">
                {label === "Send" ? "↑" : label === "Receive" ? "↓" : "⇄"}
              </span>
              <span className="text-[10px] tracking-[0.25em] uppercase text-ink/60">{label}</span>
            </button>
          ))}
        </div>

        {/* Key info cards */}
        <div className="px-5 mt-5 space-y-2">
          <p className="text-[9px] tracking-[0.4em] uppercase text-ink/40 mb-3">
            {noidMode ? "ZK Keys" : "Wallet Keys"}
          </p>

          <KeyRow
            label={pubKeyLabel}
            value={displayPublicKey}
            onCopy={() => copy(displayPublicKey, "pubkey")}
            copied={copied === "pubkey"}
            truncate={truncate}
          />

          <KeyRow
            label={keyLabel}
            value={displayPrivateKey}
            secret
            onCopy={() => copy(displayPrivateKey, "privkey")}
            copied={copied === "privkey"}
            truncate={truncate}
          />

          {noidMode && (
            <div className="mt-3 p-3 rounded-xl bg-ink/[0.04] border border-ink/10">
              <p className="text-[9px] tracking-[0.3em] uppercase text-goldDeep mb-1">Noid Mode Active</p>
              <p className="text-[11px] text-ink/55 leading-relaxed">
                Showing Poseidon-derived ZK keys. Used for zero-knowledge proofs on Menoid.
              </p>
            </div>
          )}
        </div>

        {/* Recent activity stub */}
        <div className="px-5 mt-5 mb-6">
          <p className="text-[9px] tracking-[0.4em] uppercase text-ink/40 mb-3">Activity</p>
          <div className="flex flex-col items-center justify-center py-8 rounded-2xl border border-dashed border-ink/15">
            <span className="text-2xl mb-2">🏴‍☠️</span>
            <p className="text-[12px] text-ink/45 font-serif italic">No transactions yet</p>
            <p className="text-[10px] text-ink/30 mt-1">Your voyage awaits</p>
          </div>
        </div>
      </div>

      {/* ─── Bottom nav ─── */}
      <div className="relative z-20 border-t border-ink/10 bg-cream/90 backdrop-blur-sm">
        <div className="flex items-center justify-around px-4 py-3">
          {[
            { icon: "◈", label: "Wallet", active: true },
            { icon: "◉", label: "Activity", active: false },
            { icon: "◎", label: "Settings", active: false },
          ].map((item) => (
            <button
              key={item.label}
              className={`flex flex-col items-center gap-1 transition-colors ${
                item.active ? "text-goldDeep" : "text-ink/35 hover:text-ink/60"
              }`}>
              <span className="text-base leading-none">{item.icon}</span>
              <span className="text-[9px] tracking-[0.3em] uppercase">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function KeyRow({
  label,
  value,
  secret = false,
  onCopy,
  copied,
  truncate,
}: {
  label: string;
  value: string;
  secret?: boolean;
  onCopy: () => void;
  copied: boolean;
  truncate: (s: string, a?: number, b?: number) => string;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-ink/[0.04] border border-ink/10 gap-3">
      <div className="min-w-0">
        <p className="text-[9px] tracking-[0.3em] uppercase text-ink/40 mb-0.5">{label}</p>
        <p className="font-mono text-[10px] text-ink/70 truncate">
          {secret && !revealed ? "••••••••••••••••" : truncate(value, 8, 6)}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {secret && (
          <button
            onClick={() => setRevealed((v) => !v)}
            className="text-ink/35 hover:text-ink/60 transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              {revealed ? (
                <>
                  <path d="M1 7S3 3 7 3s6 4 6 4-2 4-6 4S1 7 1 7Z" stroke="currentColor" strokeWidth="1.1"/>
                  <circle cx="7" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.1"/>
                  <line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                </>
              ) : (
                <>
                  <path d="M1 7S3 3 7 3s6 4 6 4-2 4-6 4S1 7 1 7Z" stroke="currentColor" strokeWidth="1.1"/>
                  <circle cx="7" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.1"/>
                </>
              )}
            </svg>
          </button>
        )}
        <button onClick={onCopy} className="text-ink/35 hover:text-goldDeep transition-colors">
          {copied ? (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 6.5L5 9.5L11 3.5" stroke="#A36E14" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <rect x="3.5" y="3.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.1"/>
              <path d="M1 9V1.5A.5.5 0 011.5 1H9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

function Backdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-gradient-to-b from-[#FBF1D9] via-cream to-parchment" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,_rgba(232,174,58,0.2)_0%,_rgba(246,233,208,0)_55%)]" />
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-25" />
    </>
  );
}