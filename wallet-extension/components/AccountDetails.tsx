/**
 * AccountDetails.tsx
 *
 * Settings → Account Details. Password-gated key reveal.
 *
 * Flow:
 *   1) Password prompt — user enters their wallet password. We verify
 *      by re-decrypting the stored EncryptedWallet (so we never have to
 *      store a separate verifier).
 *   2) Reveal screen — shows Open-account keys and Noid-account keys
 *      with per-row reveal toggles and copy buttons. Includes the seed
 *      phrase if it was preserved at creation time.
 *
 * Back button bubbles up to the parent Settings view.
 */

import React, { useState } from "react"
import { useWallet } from "../context/WalletContext"
import { verifyPasswordFromStorage } from "../lib/verifyPassword"

interface Props {
  onBack: () => void
}

type Phase = "auth" | "reveal"

// One spot for the dark/light tokens — every sub-component picks fields off
// this so we don't sprinkle `mode === "noid"` checks through the JSX.
interface ThemeTokens {
  isNoid: boolean
  card: string
  cardSoft: string
  text: string
  textSoft: string
  textFaint: string
  border: string
}

function useThemeTokens(): ThemeTokens {
  const { mode } = useWallet()
  const isNoid = mode === "noid"
  return {
    isNoid,
    card: isNoid
      ? "bg-bone/[0.04] border border-bone/15"
      : "bg-ink/[0.04] border border-ink/10",
    cardSoft: isNoid
      ? "bg-bone/[0.06] border border-bone/15"
      : "bg-ink/[0.05] border border-ink/8",
    text: isNoid ? "text-bone" : "text-ink",
    textSoft: isNoid ? "text-bone/70" : "text-ink/70",
    textFaint: isNoid ? "text-bone/40" : "text-ink/40",
    border: isNoid ? "border-bone/15" : "border-ink/12"
  }
}

export default function AccountDetails({ onBack }: Props) {
  const { wallet } = useWallet()
  const t = useThemeTokens()
  const [phase, setPhase] = useState<Phase>("auth")
  const [password, setPassword] = useState("")
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)

  if (!wallet) return null

  async function handleVerify() {
    if (!password) {
      setErr("Enter your password.")
      return
    }
    setBusy(true)
    setErr("")
    try {
      const ok = await verifyPasswordFromStorage(password)
      if (!ok) {
        setErr("Wrong password. Try again.")
      } else {
        setPhase("reveal")
        setPassword("") // drop it from memory
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-5 pt-5 pb-6">
      <button
        onClick={onBack}
        className={`flex items-center gap-2 text-[10px] tracking-[0.3em] uppercase mb-5 transition-colors ${
          t.isNoid
            ? "text-bone/55 hover:text-bone"
            : "text-ink/50 hover:text-ink"
        }`}>
        <svg width="14" height="8" viewBox="0 0 14 8" fill="none">
          <path
            d="M14 4H2M2 4L5 1M2 4L5 7"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        Back
      </button>

      {phase === "auth" ? (
        <AuthPanel
          password={password}
          setPassword={setPassword}
          err={err}
          busy={busy}
          onSubmit={handleVerify}
          t={t}
        />
      ) : (
        <RevealPanel t={t} />
      )}
    </div>
  )
}

function AuthPanel({
  password,
  setPassword,
  err,
  busy,
  onSubmit,
  t
}: {
  password: string
  setPassword: (v: string) => void
  err: string
  busy: boolean
  onSubmit: () => void
  t: ThemeTokens
}) {
  return (
    <>
      <p className="text-[10px] tracking-[0.4em] uppercase text-goldDeep mb-2">
        Captain&apos;s Vault
      </p>
      <h2 className="font-display text-[22px] font-bold tracking-[-0.025em] leading-tight mb-1">
        Account Details
      </h2>
      <p
        className={`text-[12px] leading-snug mb-5 ${
          t.isNoid ? "text-bone/60" : "text-ink/55"
        }`}>
        Enter your password to reveal your wallet keys.
      </p>

      <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 p-3 mb-5 flex items-start gap-2.5">
        <span className="text-amber-600 text-sm mt-0.5">⚠</span>
        <p
          className={`text-[11px] leading-relaxed ${
            t.isNoid ? "text-bone/70" : "text-ink/65"
          }`}>
          Never share your private keys or seed phrase. Anyone who sees them
          can take your funds.
        </p>
      </div>

      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder="Wallet password"
        className={`w-full rounded-xl px-4 py-3 text-[13px] focus:outline-none focus:border-goldDeep/60 transition-colors ${
          t.isNoid
            ? "bg-bone/[0.06] border border-bone/15 placeholder-bone/30 text-bone"
            : "bg-ink/[0.05] border border-ink/12 placeholder-ink/30 text-ink"
        }`}
      />
      {err && (
        <p className="mt-2 text-[11px] text-red-600 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
          {err}
        </p>
      )}

      <button
        onClick={onSubmit}
        disabled={busy || !password}
        className={`mt-5 w-full rounded-2xl py-3.5 font-display text-[12px] font-semibold tracking-[0.12em] uppercase hover:-translate-y-[1px] transition disabled:opacity-50 flex items-center justify-center gap-2 ${
          t.isNoid ? "bg-bone text-ink" : "bg-ink text-bone"
        }`}>
        {busy ? (
          <>
            <span
              className={`h-3.5 w-3.5 rounded-full border-2 animate-spin ${
                t.isNoid
                  ? "border-ink/30 border-t-ink"
                  : "border-bone/30 border-t-bone"
              }`}
            />
            Verifying…
          </>
        ) : (
          "Unlock the Vault"
        )}
      </button>
    </>
  )
}

function RevealPanel({ t }: { t: ThemeTokens }) {
  const { wallet } = useWallet()
  if (!wallet) return null
  const open = wallet.normalAccount
  const noid = wallet.noidAccount as {
    address: string
    privateKey: string
    publicKey: string
    zkSecretKey?: string
    zkPublicKey?: string
  }

  return (
    <>
      <p className="text-[10px] tracking-[0.4em] uppercase text-goldDeep mb-2">
        Captain&apos;s Vault
      </p>
      <h2 className="font-display text-[22px] font-bold tracking-[-0.025em] leading-tight mb-5">
        Your Keys
      </h2>

      {/* Open account block */}
      <Section title="Open Account" t={t}>
        <KeyRow label="Address" value={open.address} t={t} />
        <KeyRow label="Public Key" value={open.publicKey} t={t} />
        <KeyRow label="Private Key" value={open.privateKey} secret t={t} />
      </Section>

      {/* Noid account block */}
      <Section title="Noid Account" t={t}>
        <KeyRow label="Address" value={noid.address} t={t} />
        <KeyRow label="Public Key" value={noid.publicKey} t={t} />
        <KeyRow label="Private Key" value={noid.privateKey} secret t={t} />
        {noid.zkSecretKey && (
          <KeyRow label="ZK Secret Key" value={noid.zkSecretKey} secret t={t} />
        )}
        {noid.zkPublicKey && (
          <KeyRow label="ZK Public Key" value={noid.zkPublicKey} t={t} />
        )}
      </Section>

      {/* Seed phrase */}
      {wallet.seedPhrase && (
        <Section title="Recovery Phrase" t={t}>
          <SeedRow phrase={wallet.seedPhrase} t={t} />
        </Section>
      )}
    </>
  )
}

function Section({
  title,
  children,
  t
}: {
  title: string
  children: React.ReactNode
  t: ThemeTokens
}) {
  return (
    <div className="mb-4">
      <p
        className={`text-[9px] tracking-[0.4em] uppercase mb-2 ${t.textFaint}`}>
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function KeyRow({
  label,
  value,
  secret = false,
  t
}: {
  label: string
  value: string
  secret?: boolean
  t: ThemeTokens
}) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const display =
    secret && !revealed
      ? "••••••••••••••••"
      : value.length > 18
        ? `${value.slice(0, 10)}…${value.slice(-6)}`
        : value

  function copy() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-xl gap-3 ${t.card}`}>
      <div className="min-w-0">
        <p
          className={`text-[9px] tracking-[0.3em] uppercase mb-0.5 ${t.textFaint}`}>
          {label}
        </p>
        <p
          className={`font-mono text-[10px] truncate ${
            t.isNoid ? "text-bone/80" : "text-ink/75"
          }`}>
          {display}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {secret && (
          <button
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? "Hide" : "Reveal"}
            className={`transition-colors ${
              t.isNoid
                ? "text-bone/45 hover:text-bone/75"
                : "text-ink/40 hover:text-ink/70"
            }`}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M1 7S3 3 7 3s6 4 6 4-2 4-6 4S1 7 1 7Z"
                stroke="currentColor"
                strokeWidth="1.1"
              />
              <circle cx="7" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.1" />
              {revealed && (
                <line
                  x1="2"
                  y1="2"
                  x2="12"
                  y2="12"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        )}
        <button
          onClick={copy}
          aria-label="Copy"
          className={`transition-colors hover:text-goldDeep ${
            t.isNoid ? "text-bone/45" : "text-ink/40"
          }`}>
          {copied ? (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M2 6.5L5 9.5L11 3.5"
                className="goldDeep-stroke"
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
        </button>
      </div>
    </div>
  )
}

function SeedRow({ phrase, t }: { phrase: string; t: ThemeTokens }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const words = phrase.split(/\s+/)
  function copy() {
    navigator.clipboard.writeText(phrase)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className={`p-3 rounded-xl ${t.card}`}>
      <div className="flex items-center justify-between mb-2">
        <p
          className={`text-[9px] tracking-[0.3em] uppercase ${t.textFaint}`}>
          12 / 24 words
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRevealed((v) => !v)}
            className="text-[9px] tracking-[0.3em] uppercase text-goldDeep hover:text-goldDeeper transition-colors">
            {revealed ? "Hide" : "Reveal"}
          </button>
          <button
            onClick={copy}
            className={`text-[9px] tracking-[0.3em] uppercase transition-colors ${
              t.isNoid
                ? "text-bone/55 hover:text-bone"
                : "text-ink/50 hover:text-ink"
            }`}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      {revealed ? (
        <div className="grid grid-cols-3 gap-1.5">
          {words.map((w, i) => (
            <div
              key={i}
              className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 ${t.cardSoft}`}>
              <span className="font-serif italic text-[9px] text-goldDeep w-3 shrink-0">
                {i + 1}
              </span>
              <span className="font-display text-[11px] font-semibold truncate">
                {w}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {words.map((_, i) => (
            <div
              key={i}
              className={`h-7 rounded-lg flex items-center justify-center ${t.cardSoft}`}>
              <span
                className={`font-mono text-[9px] ${
                  t.isNoid ? "text-bone/30" : "text-ink/30"
                }`}>
                ••••
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}