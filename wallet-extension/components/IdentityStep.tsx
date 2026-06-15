/**
 * IdentityStep.tsx
 *
 * Shared step used by Create / Import / Add-Wallet flows.
 *
 * Behaviour:
 *   - On mount: check the backend.
 *       • GET /users/all       → is `realAddress` (open address) already registered?
 *       • GET /noidusers/all   → is the (noidPublicKey, zkPublicKey) already registered?
 *   - For each identity that is NOT registered, prompt the user for a name.
 *     `.meno` is auto-appended if missing.
 *   - On submit: POST /users/create and/or /noidusers/create as needed.
 *   - Calls `onReady({ openName, noidName, openRegistered, noidRegistered })`
 *     with the final values so the caller can persist them next to the wallet.
 *
 * If BOTH identities are already registered, we still surface that to the
 * user (so they know nothing was sent) and auto-advance via the parent.
 */

import React, { useEffect, useMemo, useState } from "react"
import {
  createNoidUserApi as createNoidUser,
  createOpenUser,
  listNoidUsers as fetchAllNoidUsers,
  listOpenUsers as fetchAllOpenUsers
} from "../services/users"
import type {
  OpenUser as OpenUserDTO,
  NoidUser as NoidUserDTO
} from "../services/users"
import { ensureMenoSuffix as normalizeMenoName } from "../lib/wallets"

interface DerivedWalletShape {
  normalAccount: { address: string; publicKey: string; privateKey: string }
  noidAccount: {
    address: string
    privateKey: string
    publicKey: string
    zkSecretKey: string
    zkPublicKey: string
  }
}

export interface IdentityResult {
  openName: string
  noidName: string
  openRegistered: boolean
  noidRegistered: boolean
}

interface Props {
  wallet: DerivedWalletShape
  /** Called when the user confirms identities (post-registration). */
  onReady: (r: IdentityResult) => void
  /** Caption / step indicator like "Step 02" */
  stepLabel?: string
  /** Override the headline */
  title?: React.ReactNode
}

type Phase = "checking" | "ready" | "submitting" | "error"

function eqAddr(a?: string, b?: string) {
  if (!a || !b) return false
  return a.toLowerCase() === b.toLowerCase()
}

export default function IdentityStep({
  wallet,
  onReady,
  stepLabel = "Step 02",
  title
}: Props) {
  const [phase, setPhase] = useState<Phase>("checking")
  const [err, setErr] = useState("")

  const [openExisting, setOpenExisting] = useState<OpenUserDTO | null>(null)
  const [noidExisting, setNoidExisting] = useState<NoidUserDTO | null>(null)

  const [openRaw, setOpenRaw] = useState("")
  const [noidRaw, setNoidRaw] = useState("")

  // Derived: normalized names with .meno suffix for preview
  const openPreview = useMemo(() => normalizeMenoName(openRaw), [openRaw])
  const noidPreview = useMemo(() => normalizeMenoName(noidRaw), [noidRaw])

  useEffect(() => {
    let cancelled = false
    setPhase("checking")
    setErr("")
    ;(async () => {
      try {
        const [users, noids] = await Promise.all([
          fetchAllOpenUsers().catch(() => [] as OpenUserDTO[]),
          fetchAllNoidUsers().catch(() => [] as NoidUserDTO[])
        ])
        if (cancelled) return

        const openHit =
          users.find((u) => eqAddr(u.realAddress, wallet.normalAccount.address)) ||
          null
        const noidHit =
          noids.find(
            (u) =>
              u.noidModePublicKey?.toLowerCase() ===
                wallet.noidAccount.publicKey.toLowerCase() ||
              u.zkPublicKey?.toLowerCase() ===
                wallet.noidAccount.zkPublicKey.toLowerCase()
          ) || null

        setOpenExisting(openHit)
        setNoidExisting(noidHit)
        setPhase("ready")
      } catch (e: any) {
        if (cancelled) return
        setErr(
          "Couldn't reach the Menoid registry. You can retry, or skip and register later."
        )
        setPhase("error")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [wallet.normalAccount.address, wallet.noidAccount.publicKey, wallet.noidAccount.zkPublicKey])

  const needOpen = !openExisting
  const needNoid = !noidExisting

  const isInvalidOpen = needOpen && openPreview.length <= ".meno".length
  const isInvalidNoid = needNoid && noidPreview.length <= ".meno".length
  const canSubmit = phase === "ready" && !isInvalidOpen && !isInvalidNoid

  async function handleSubmit() {
    setPhase("submitting")
    setErr("")
    try {
      let finalOpenName = openExisting?.name ?? ""
      let finalNoidName = noidExisting?.name ?? ""

      if (needOpen) {
        const name = openPreview
        try {
          const created = await createOpenUser({
            name,
            realAddress: wallet.normalAccount.address
          })
          finalOpenName = created.name
        } catch (e: any) {
          // Treat "already exists" gracefully — re-fetch and use whatever's there
          if (/already exists/i.test(e?.message ?? "")) {
            finalOpenName = name
          } else {
            throw e
          }
        }
      }

      if (needNoid) {
        const name = noidPreview
        try {
          const created = await createNoidUser({
            name,
            noidModePublicKey: wallet.noidAccount.publicKey,
            zkPublicKey: wallet.noidAccount.zkPublicKey
          })
          finalNoidName = created.name
        } catch (e: any) {
          if (/already exists/i.test(e?.message ?? "")) {
            finalNoidName = name
          } else {
            throw e
          }
        }
      }

      onReady({
        openName: finalOpenName,
        noidName: finalNoidName,
        openRegistered: true,
        noidRegistered: true
      })
    } catch (e: any) {
      setErr(e?.message ?? "Registration failed.")
      setPhase("ready")
    }
  }

  function handleSkip() {
    // Skip without registering — store whatever metadata we already have.
    onReady({
      openName: openExisting?.name ?? "",
      noidName: noidExisting?.name ?? "",
      openRegistered: !!openExisting,
      noidRegistered: !!noidExisting
    })
  }

  // ── If both already registered, surface and let parent advance ──
  if (phase === "ready" && !needOpen && !needNoid) {
    return (
      <div className="animate-revealUp">
        <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">
          {stepLabel}
        </p>
        <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-2">
          Identities{" "}
          <span className="font-serif italic font-medium text-goldDeep">
            already linked
          </span>
        </h2>
        <p className="text-[13px] text-ink/55 leading-relaxed mb-6">
          This wallet&apos;s open and noid identities are already registered on
          the Menoid registry. Nothing else to do.
        </p>

        <div className="space-y-3 mb-8">
          <ExistingCard
            label="Open identity"
            name={openExisting?.name ?? ""}
            detail={`${wallet.normalAccount.address.slice(
              0,
              6
            )}…${wallet.normalAccount.address.slice(-4)}`}
          />
          <ExistingCard
            label="Noid identity"
            name={noidExisting?.name ?? ""}
            detail={`${wallet.noidAccount.publicKey.slice(
              0,
              6
            )}…${wallet.noidAccount.publicKey.slice(-4)}`}
          />
        </div>

        <button
          onClick={handleSubmit}
          className="w-full rounded-2xl bg-ink text-bone py-4 font-display text-[13px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[2px]">
          Continue
        </button>
      </div>
    )
  }

  return (
    <div className="animate-revealUp">
      <p className="text-[10px] tracking-[0.45em] uppercase text-goldDeep mb-3">
        {stepLabel}
      </p>
      <h2 className="font-display text-[32px] font-bold tracking-[-0.03em] leading-tight mb-2">
        {title ?? (
          <>
            Claim your{" "}
            <span className="font-serif italic font-medium text-goldDeep">
              .meno identities
            </span>
          </>
        )}
      </h2>
      <p className="text-[13px] text-ink/55 leading-relaxed mb-7">
        Pick names that other Menoid users can send to. Your handles end in{" "}
        <span className="font-mono text-goldDeep">.meno</span> — we&apos;ll add
        the suffix for you.
      </p>

      {phase === "checking" ? (
        <div className="space-y-3">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Open identity */}
          {needOpen ? (
            <IdentityField
              label="Open identity name"
              hint="Used when you send / receive public MON."
              value={openRaw}
              onChange={setOpenRaw}
              preview={openPreview}
              placeholder="alice"
            />
          ) : (
            <ExistingCard
              label="Open identity"
              name={openExisting!.name}
              detail={`${wallet.normalAccount.address.slice(
                0,
                6
              )}…${wallet.normalAccount.address.slice(-4)}`}
            />
          )}

          {/* Noid identity */}
          {needNoid ? (
            <IdentityField
              label="Noid identity name"
              hint="Used inside the private (zk) pool."
              value={noidRaw}
              onChange={setNoidRaw}
              preview={noidPreview}
              placeholder="alice"
            />
          ) : (
            <ExistingCard
              label="Noid identity"
              name={noidExisting!.name}
              detail={`${wallet.noidAccount.publicKey.slice(
                0,
                6
              )}…${wallet.noidAccount.publicKey.slice(-4)}`}
            />
          )}
        </div>
      )}

      {err && (
        <p className="mt-4 text-[12px] text-red-500 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          {err}
        </p>
      )}

      <div className="mt-6 flex gap-2">
        {phase === "error" && (
          <button
            onClick={handleSkip}
            className="rounded-2xl bg-ink/[0.05] border border-ink/10 px-4 py-3 text-[11px] tracking-[0.3em] uppercase text-ink/55 hover:bg-ink/[0.1] transition-colors">
            Skip for now
          </button>
        )}
        <button
          disabled={phase !== "ready" || isInvalidOpen || isInvalidNoid}
          onClick={handleSubmit}
          className="flex-1 rounded-2xl bg-ink text-bone py-3 font-display text-[13px] font-semibold tracking-[0.1em] uppercase transition-all hover:-translate-y-[2px] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3">
          {phase === "submitting" ? (
            <>
              <span className="h-4 w-4 rounded-full border-2 border-bone/30 border-t-bone animate-spin" />
              Registering…
            </>
          ) : (
            "Register & continue"
          )}
        </button>
      </div>
    </div>
  )
}

// ── Small helpers ────────────────────────────────────────────────────────

function IdentityField({
  label,
  hint,
  value,
  onChange,
  preview,
  placeholder
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  preview: string
  placeholder: string
}) {
  // Strip `.meno` (case-insensitive) for the input value so the preview is
  // always tidy.
  const inputValue = value.replace(/\.meno$/i, "")
  return (
    <div>
      <label className="block text-[10px] tracking-[0.3em] uppercase text-ink/50 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          value={inputValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl bg-ink/[0.05] border border-ink/12 px-4 py-3 pr-20 text-[14px] placeholder-ink/30 focus:outline-none focus:border-goldDeep/60 transition-colors font-mono"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-goldDeep font-mono">
          .meno
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <p className="text-[11px] text-ink/45 leading-snug">{hint}</p>
        {preview.length > ".meno".length && (
          <p className="text-[11px] text-goldDeep font-mono truncate ml-2">
            {preview}
          </p>
        )}
      </div>
    </div>
  )
}

function ExistingCard({
  label,
  name,
  detail
}: {
  label: string
  name: string
  detail: string
}) {
  return (
    <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-500/8 border border-emerald-500/25">
      <div className="min-w-0">
        <p className="text-[9px] tracking-[0.3em] uppercase text-emerald-700/80 mb-0.5">
          {label} · linked
        </p>
        <p className="font-mono text-[13px] font-semibold text-ink truncate">
          {name}
        </p>
      </div>
      <span className="font-mono text-[10px] text-ink/40 ml-2 shrink-0">
        {detail}
      </span>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="h-[68px] rounded-xl bg-ink/[0.05] animate-pulse border border-ink/10" />
  )
}