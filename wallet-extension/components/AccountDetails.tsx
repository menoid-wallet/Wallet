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

export default function AccountDetails({ onBack }: Props) {
  const { wallet } = useWallet()
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
        className="flex items-center gap-2 text-[10px] tracking-[0.3em] uppercase text-ink/50 hover:text-ink transition-colors mb-5">
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
        />
      ) : (
        <RevealPanel />
      )}
    </div>
  )
}

function AuthPanel({
  password,
  setPassword,
  err,
  busy,
  onSubmit
}: {
  password: string
  setPassword: (v: string) => void
  err: string
  busy: boolean
  onSubmit: () => void
}) {
  return (
    <>
      <p className="text-[10px] tracking-[0.4em] uppercase text-goldDeep mb-2">
        Captain&apos;s Vault
      </p>
      <h2 className="font-display text-[22px] font-bold tracking-[-0.025em] leading-tight mb-1">
        Account Details
      </h2>
      <p className="text-[12px] text-ink/55 leading-snug mb-5">
        Enter your password to reveal your wallet keys.
      </p>

      <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 p-3 mb-5 flex items-start gap-2.5">
        <span className="text-amber-600 text-sm mt-0.5">⚠</span>
        <p className="text-[11px] text-ink/65 leading-relaxed">
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
        className="w-full rounded-xl bg-ink/[0.05] border border-ink/12 px-4 py-3 text-[13px] placeholder-ink/30 focus:outline-none focus:border-goldDeep/60 transition-colors"
      />
      {err && (
        <p className="mt-2 text-[11px] text-red-600 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
          {err}
        </p>
      )}

      <button
        onClick={onSubmit}
        disabled={busy || !password}
        className="mt-5 w-full rounded-2xl bg-ink text-bone py-3.5 font-display text-[12px] font-semibold tracking-[0.12em] uppercase hover:-translate-y-[1px] transition disabled:opacity-50 flex items-center justify-center gap-2">
        {busy ? (
          <>
            <span className="h-3.5 w-3.5 rounded-full border-2 border-bone/30 border-t-bone animate-spin" />
            Verifying…
          </>
        ) : (
          "Unlock the Vault"
        )}
      </button>
    </>
  )
}

function RevealPanel() {
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
      <Section title="Open Account">
        <KeyRow label="Address" value={open.address} />
        <KeyRow label="Public Key" value={open.publicKey} />
        <KeyRow label="Private Key" value={open.privateKey} secret />
      </Section>

      {/* Noid account block */}
      <Section title="Noid Account">
        <KeyRow label="Address" value={noid.address} />
        <KeyRow label="Public Key" value={noid.publicKey} />
        <KeyRow label="Private Key" value={noid.privateKey} secret />
        {noid.zkSecretKey && (
          <KeyRow label="ZK Secret Key" value={noid.zkSecretKey} secret />
        )}
        {noid.zkPublicKey && (
          <KeyRow label="ZK Public Key" value={noid.zkPublicKey} />
        )}
      </Section>

      {/* Seed phrase */}
      {wallet.seedPhrase && (
        <Section title="Recovery Phrase">
          <SeedRow phrase={wallet.seedPhrase} />
        </Section>
      )}
    </>
  )
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-4">
      <p className="text-[9px] tracking-[0.4em] uppercase text-ink/40 mb-2">
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function KeyRow({
  label,
  value,
  secret = false
}: {
  label: string
  value: string
  secret?: boolean
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
    <div className="flex items-center justify-between p-3 rounded-xl bg-ink/[0.04] border border-ink/10 gap-3">
      <div className="min-w-0">
        <p className="text-[9px] tracking-[0.3em] uppercase text-ink/40 mb-0.5">
          {label}
        </p>
        <p className="font-mono text-[10px] text-ink/75 truncate">{display}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {secret && (
          <button
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? "Hide" : "Reveal"}
            className="text-ink/40 hover:text-ink/70 transition-colors">
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
          className="text-ink/40 hover:text-goldDeep transition-colors">
          {copied ? (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M2 6.5L5 9.5L11 3.5"
                stroke="#A36E14"
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

function SeedRow({ phrase }: { phrase: string }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const words = phrase.split(/\s+/)
  function copy() {
    navigator.clipboard.writeText(phrase)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="p-3 rounded-xl bg-ink/[0.04] border border-ink/10">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] tracking-[0.3em] uppercase text-ink/40">
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
            className="text-[9px] tracking-[0.3em] uppercase text-ink/50 hover:text-ink transition-colors">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      {revealed ? (
        <div className="grid grid-cols-3 gap-1.5">
          {words.map((w, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 rounded-lg bg-ink/[0.05] border border-ink/8 px-2 py-1.5">
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
              className="h-7 rounded-lg bg-ink/[0.06] border border-ink/8 flex items-center justify-center">
              <span className="font-mono text-[9px] text-ink/30">••••</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}