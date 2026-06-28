/**
 * FeedbackModal.tsx
 *
 * In-wallet feedback survey, opened from the feedback circle in the header.
 * Themed for both modes (cream glass in Open, ink glass in Noid) and slides
 * up as a LiquidSheet. On submit we POST to the backend AND remember it in
 * local storage, so re-opening shows the "already submitted" thank-you state.
 */

import React, { useEffect, useState } from "react"
import { useWallet } from "../context/WalletContext"
import LiquidSheet from "./shared/LiquidSheet"
import {
  getFeedbackRecord,
  markFeedbackSubmitted
} from "../lib/feedback"
import { submitFeedback, type FeedbackPayload } from "../services/feedback"

interface Props {
  open: boolean
  onClose: () => void
}

/* ─── Option sets (value mirrors the backend enums) ─── */
const PIRATE_OPTS = [
  { value: "loved", label: "Loved it", emoji: "😍" },
  { value: "liked", label: "Liked it", emoji: "🙂" },
  { value: "neutral", label: "Neutral", emoji: "😐" },
  { value: "disliked", label: "Didn't like it", emoji: "🙁" }
]
const IMPRESSIVE_OPTS = [
  { value: "noid", label: "Noid Mode" },
  { value: "multichain", label: "Multi-chain Wallet" },
  { value: "ui", label: "UI / Design" }
]
const BUILD_NEXT_OPTS = [
  { value: "private_swaps", label: "Private Swaps" },
  { value: "private_prediction_markets", label: "Private Prediction Markets" },
  { value: "private_memecoin_launchpad", label: "Private Memecoin Launchpad" },
  { value: "private_dapps", label: "Private dApps" },
  { value: "more_chains", label: "More Chains" },
  { value: "ai_assistant", label: "AI Assistant" }
]
const RECOMMEND_OPTS = [
  { value: "definitely", label: "Definitely" },
  { value: "probably", label: "Probably" },
  { value: "maybe", label: "Maybe" },
  { value: "probably_not", label: "Probably Not" },
  { value: "no", label: "No" }
]

export default function FeedbackModal({ open, onClose }: Props) {
  const { wallet, mode } = useWallet()
  const isNoid = mode === "noid"
  const t = makeTheme(isNoid)

  const [view, setView] = useState<"form" | "done">("form")
  const [doneEmail, setDoneEmail] = useState("")

  // answers
  const [setupEase, setSetupEase] = useState(0)
  const [uiUxRating, setUiUxRating] = useState(0)
  const [pirateTheme, setPirateTheme] = useState("")
  const [mostImpressive, setMostImpressive] = useState("")
  const [confusing, setConfusing] = useState("")
  const [buildNext, setBuildNext] = useState<string[]>([])
  const [primaryWalletNps, setPrimaryWalletNps] = useState(0)
  const [improve, setImprove] = useState("")
  const [recommend, setRecommend] = useState("")
  const [additional, setAdditional] = useState("")
  const [email, setEmail] = useState("")
  const [discord, setDiscord] = useState("")
  const [twitter, setTwitter] = useState("")

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // On open, surface the already-submitted state if one exists.
  useEffect(() => {
    if (!open) return
    let alive = true
    getFeedbackRecord().then((rec) => {
      if (alive && rec) {
        setDoneEmail(rec.email)
        setView("done")
      }
    })
    return () => {
      alive = false
    }
  }, [open])

  function toggleBuildNext(value: string) {
    setBuildNext((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    )
  }

  async function handleSubmit() {
    if (!email.trim()) {
      setError("Please enter your email so we can reach you for the airdrop.")
      return
    }
    setSubmitting(true)
    setError(null)

    const payload: FeedbackPayload = {
      email: email.trim(),
      mode,
      walletAddress: wallet?.normalAccount?.address ?? ""
    }
    if (setupEase) payload.setupEase = setupEase
    if (uiUxRating) payload.uiUxRating = uiUxRating
    if (primaryWalletNps) payload.primaryWalletNps = primaryWalletNps
    if (pirateTheme) payload.pirateTheme = pirateTheme as FeedbackPayload["pirateTheme"]
    if (mostImpressive) payload.mostImpressive = mostImpressive as FeedbackPayload["mostImpressive"]
    if (recommend) payload.recommend = recommend as FeedbackPayload["recommend"]
    if (buildNext.length) payload.buildNext = buildNext as FeedbackPayload["buildNext"]
    if (confusing.trim()) payload.confusing = confusing.trim()
    if (improve.trim()) payload.improve = improve.trim()
    if (additional.trim()) payload.additional = additional.trim()
    if (discord.trim()) payload.discord = discord.trim()
    if (twitter.trim()) payload.twitter = twitter.trim()

    try {
      await submitFeedback(payload)
      await markFeedbackSubmitted(email.trim())
      setDoneEmail(email.trim())
      setView("done")
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <LiquidSheet
      open={open}
      onClose={onClose}
      tone={isNoid ? "ink" : "cream"}
      defaultFullscreen={view === "form"}>
      {view === "done" ? (
        <DoneView t={t} email={doneEmail} onClose={onClose} />
      ) : (
        <div className="px-5 pt-1 pb-8">
          {/* Header */}
          <div className="text-center mb-6">
            <p
              className="text-[9px] tracking-[0.45em] uppercase mb-1"
              style={{ color: t.gold }}>
              {isNoid ? "Noid Mode" : "Open Mode"}
            </p>
            <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]" style={{ color: t.text }}>
              Help shape Menoid
            </h3>
            <p className="mt-1.5 text-[11px] leading-snug" style={{ color: t.subtle }}>
              A minute of feedback from the crew steers the whole voyage.
            </p>
          </div>

          {/* Q1 */}
          <Question n={1} title="How easy was it to set up Menoid?" t={t}>
            <Stars count={5} value={setupEase} onChange={setSetupEase} t={t} />
          </Question>

          {/* Q2 */}
          <Question n={2} title="How would you rate the overall UI / UX?" t={t}>
            <Stars count={5} value={uiUxRating} onChange={setUiUxRating} t={t} />
          </Question>

          {/* Q3 */}
          <Question n={3} title="Did the pirate theme make the wallet more enjoyable?" t={t}>
            <ChoiceGroup
              options={PIRATE_OPTS}
              selected={[pirateTheme]}
              onSelect={(v) => setPirateTheme(v)}
              t={t}
            />
          </Question>

          {/* Q4 */}
          <Question n={4} title="Which feature impressed you the most?" t={t}>
            <ChoiceGroup
              options={IMPRESSIVE_OPTS}
              selected={[mostImpressive]}
              onSelect={(v) => setMostImpressive(v)}
              t={t}
            />
          </Question>

          {/* Q5 */}
          <Question n={5} title="Was anything confusing while using Menoid?" t={t}>
            <TextArea value={confusing} onChange={setConfusing} placeholder="Tell us what tripped you up…" t={t} />
          </Question>

          {/* Q6 */}
          <Question n={6} title="Which feature would you like us to build next?" hint="Select all that apply" t={t}>
            <ChoiceGroup
              options={BUILD_NEXT_OPTS}
              selected={buildNext}
              onSelect={toggleBuildNext}
              multi
              t={t}
            />
          </Question>

          {/* Q7 */}
          <Question n={7} title="How likely are you to use Menoid as your primary wallet once it's live?" hint="1 = unlikely · 10 = absolutely" t={t}>
            <Scale10 value={primaryWalletNps} onChange={setPrimaryWalletNps} t={t} />
          </Question>

          {/* Q8 */}
          <Question n={8} title="What is one thing you would improve?" t={t}>
            <TextArea value={improve} onChange={setImprove} placeholder="One improvement that would matter most…" t={t} />
          </Question>

          {/* Q9 */}
          <Question n={9} title="Would you recommend Menoid to a friend?" t={t}>
            <ChoiceGroup
              options={RECOMMEND_OPTS}
              selected={[recommend]}
              onSelect={(v) => setRecommend(v)}
              t={t}
            />
          </Question>

          {/* Q10 */}
          <Question n={10} title="Any additional feedback?" t={t}>
            <TextArea value={additional} onChange={setAdditional} placeholder="Anything else on your mind…" t={t} />
          </Question>

          {/* Contact */}
          <div
            className="mt-6 mb-4 rounded-2xl p-4"
            style={{ background: t.cardBg, border: `1px solid ${t.border}` }}>
            <p className="text-[12px] font-semibold mb-3" style={{ color: t.text }}>
              Stay in touch
            </p>

            <Field label="Email" required t={t}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={inputStyle(t)}
              />
            </Field>
            <div
              className="mt-2 flex items-start gap-2 rounded-xl px-3 py-2.5"
              style={{ background: "rgba(232,174,58,0.12)", border: "1px solid rgba(232,174,58,0.3)" }}>
              <span className="text-[13px] leading-none mt-0.5">🪙</span>
              <p className="text-[10.5px] leading-snug" style={{ color: t.subtle }}>
                After v3, this email will receive an airdrop email to claim rewards
                like <span style={{ color: t.text, fontWeight: 600 }}>USDC</span> and{" "}
                <span style={{ color: t.text, fontWeight: 600 }}>Foundation Crew badges</span>.
              </p>
            </div>

            <div className="mt-3">
              <Field label="Discord Username" t={t}>
                <input
                  type="text"
                  value={discord}
                  onChange={(e) => setDiscord(e.target.value)}
                  placeholder="optional"
                  style={inputStyle(t)}
                />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="X (Twitter) Username" t={t}>
                <input
                  type="text"
                  value={twitter}
                  onChange={(e) => setTwitter(e.target.value)}
                  placeholder="optional"
                  style={inputStyle(t)}
                />
              </Field>
            </div>
          </div>

          {error && (
            <p className="text-[11px] mb-3 text-center" style={{ color: "#e5604d" }}>
              {error}
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-[12px] font-semibold tracking-[0.15em] uppercase transition-transform active:scale-[0.98]"
            style={{
              background: t.selectedBg,
              color: t.selectedText,
              opacity: submitting ? 0.7 : 1,
              boxShadow: isNoid
                ? "0 6px 18px rgba(250,245,233,0.18)"
                : "0 6px 18px rgba(23,19,17,0.25)"
            }}>
            {submitting ? "Sending…" : "Submit feedback"}
          </button>
        </div>
      )}
    </LiquidSheet>
  )
}

/* ───────────────────────── Theme ───────────────────────── */
interface Theme {
  isNoid: boolean
  text: string
  subtle: string
  faint: string
  gold: string
  border: string
  cardBg: string
  idleBg: string
  selectedBg: string
  selectedText: string
}

function makeTheme(isNoid: boolean): Theme {
  return {
    isNoid,
    text: isNoid ? "#FAF5E9" : "#171311",
    subtle: isNoid ? "rgba(250,245,233,0.6)" : "rgba(23,19,17,0.55)",
    faint: isNoid ? "rgba(250,245,233,0.35)" : "rgba(23,19,17,0.38)",
    gold: "#A36E14",
    border: isNoid ? "rgba(250,245,233,0.14)" : "rgba(23,19,17,0.12)",
    cardBg: isNoid ? "rgba(250,245,233,0.04)" : "rgba(23,19,17,0.04)",
    idleBg: isNoid ? "rgba(250,245,233,0.05)" : "rgba(23,19,17,0.04)",
    selectedBg: isNoid
      ? "linear-gradient(135deg, #FBF1D9 0%, #EAD5A7 100%)"
      : "linear-gradient(135deg, #3A2C1C 0%, #241A10 100%)",
    selectedText: isNoid ? "#171311" : "#FAF5E9"
  }
}

function inputStyle(t: Theme): React.CSSProperties {
  return {
    width: "100%",
    background: t.idleBg,
    border: `1px solid ${t.border}`,
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 12.5,
    color: t.text,
    outline: "none"
  }
}

/* ───────────────────────── Question wrapper ───────────────────────── */
function Question({
  n,
  title,
  hint,
  children,
  t
}: {
  n: number
  title: string
  hint?: string
  children: React.ReactNode
  t: Theme
}) {
  return (
    <div className="mb-5">
      <div className="flex items-start gap-2 mb-2.5">
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
          style={{ background: t.selectedBg, color: t.selectedText }}>
          {n}
        </span>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold leading-snug" style={{ color: t.text }}>
            {title}
          </p>
          {hint && (
            <p className="text-[10px] mt-0.5" style={{ color: t.faint }}>
              {hint}
            </p>
          )}
        </div>
      </div>
      <div className="pl-7">{children}</div>
    </div>
  )
}

/* ───────────────────────── Stars (1..count) ───────────────────────── */
function Stars({
  count,
  value,
  onChange,
  t
}: {
  count: number
  value: number
  onChange: (v: number) => void
  t: Theme
}) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: count }, (_, i) => {
        const filled = i < value
        return (
          <button
            key={i}
            onClick={() => onChange(i + 1)}
            className="transition-transform active:scale-90"
            aria-label={`${i + 1} star${i ? "s" : ""}`}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2.5l2.95 5.98 6.6.96-4.77 4.65 1.13 6.57L12 17.52l-5.91 3.11 1.13-6.57L2.45 9.44l6.6-.96z"
                fill={filled ? "#E8AE3A" : "transparent"}
                stroke={filled ? "#E8AE3A" : t.faint}
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )
      })}
      {value > 0 && (
        <span className="ml-1 text-[11px] font-semibold" style={{ color: t.subtle }}>
          {value}/{count}
        </span>
      )}
    </div>
  )
}

/* ───────────────────────── NPS scale 1..10 ───────────────────────── */
function Scale10({
  value,
  onChange,
  t
}: {
  value: number
  onChange: (v: number) => void
  t: Theme
}) {
  return (
    <div className="grid grid-cols-10 gap-1">
      {Array.from({ length: 10 }, (_, i) => {
        const n = i + 1
        const active = n <= value
        return (
          <button
            key={n}
            onClick={() => onChange(n)}
            className="flex items-center justify-center rounded-lg text-[11px] font-semibold transition-transform active:scale-90"
            style={{
              height: 30,
              background: active ? t.selectedBg : t.idleBg,
              color: active ? t.selectedText : t.subtle,
              border: `1px solid ${active ? "transparent" : t.border}`
            }}>
            {n}
          </button>
        )
      })}
    </div>
  )
}

/* ───────────────────────── Choice group (single / multi) ───────────────────────── */
function ChoiceGroup({
  options,
  selected,
  onSelect,
  multi = false,
  t
}: {
  options: { value: string; label: string; emoji?: string }[]
  selected: string[]
  onSelect: (v: string) => void
  multi?: boolean
  t: Theme
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt.value)
        return (
          <button
            key={opt.value}
            onClick={() => onSelect(opt.value)}
            className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[11.5px] font-medium transition-transform active:scale-[0.97]"
            style={{
              background: active ? t.selectedBg : t.idleBg,
              color: active ? t.selectedText : t.subtle,
              border: `1px solid ${active ? "transparent" : t.border}`
            }}>
            {opt.emoji && <span className="text-[13px] leading-none">{opt.emoji}</span>}
            {opt.label}
            {multi && active && (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="ml-0.5">
                <path d="M2.5 6.2L5 8.5L9.5 3.5" stroke={t.selectedText} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ───────────────────────── Text area ───────────────────────── */
function TextArea({
  value,
  onChange,
  placeholder,
  t
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  t: Theme
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      style={{
        width: "100%",
        background: t.idleBg,
        border: `1px solid ${t.border}`,
        borderRadius: 12,
        padding: "10px 12px",
        fontSize: 12.5,
        lineHeight: 1.5,
        color: t.text,
        outline: "none",
        resize: "none"
      }}
    />
  )
}

/* ───────────────────────── Field (label + control) ───────────────────────── */
function Field({
  label,
  required = false,
  children,
  t
}: {
  label: string
  required?: boolean
  children: React.ReactNode
  t: Theme
}) {
  return (
    <label className="block">
      <span className="block text-[10px] tracking-[0.15em] uppercase mb-1.5" style={{ color: t.faint }}>
        {label}
        {required && <span style={{ color: "#E8AE3A" }}> *</span>}
      </span>
      {children}
    </label>
  )
}

/* ───────────────────────── Already-submitted / thank-you ───────────────────────── */
function DoneView({
  t,
  email,
  onClose
}: {
  t: Theme
  email: string
  onClose: () => void
}) {
  return (
    <div className="px-6 pt-4 pb-9 text-center">
      <div
        className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full"
        style={{ background: t.selectedBg, color: t.selectedText }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
          <path d="M5 12.5L10 17.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h3 className="font-display text-[19px] font-bold tracking-[-0.02em]" style={{ color: t.text }}>
        Feedback already submitted
      </h3>
      <p className="mt-2 text-[12px] leading-relaxed" style={{ color: t.subtle }}>
        Thank you, crew — your feedback is logged. After v3 we'll email airdrop
        rewards (USDC + Foundation Crew badges).
      </p>
      {email && (
        <p className="mt-3 text-[11px]" style={{ color: t.faint }}>
          On the list:{" "}
          <span style={{ color: t.text, fontWeight: 600 }}>{email}</span>
        </p>
      )}
      <button
        onClick={onClose}
        className="mt-6 w-full py-3.5 rounded-2xl text-[12px] font-semibold tracking-[0.15em] uppercase transition-transform active:scale-[0.98]"
        style={{ background: t.selectedBg, color: t.selectedText }}>
        Close
      </button>
    </div>
  )
}
