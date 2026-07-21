/**
 * RegisterView.tsx
 *
 * The privacy-mode registration page.
 *
 * Shown when the user enters noid mode with no locally-registered chains, and
 * reachable from the noid dashboard's per-chain "Register" buttons.
 *
 *   "Register to unlock privacy mode"
 *   → pick the chains to register (a chain's logo is enabled only when its
 *     OPEN-mode balance is non-zero — you need funds to pay the register gas)
 *   → Register: each selected chain signs register(userCommitment) and the
 *     backend relays it; the chain is then cached in local storage.
 *
 * A small "?" helper reveals an "Already registered?" action: it verifies each
 * shown chain on-chain and, if already registered, caches it and drops it from
 * the selector.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useWallet } from "../../context/WalletContext"
import { getBalance } from "../../lib/rpc"
import { CHAINS } from "../../lib/chains"
import { type NetworkId } from "../../lib/networks"
import { registerOnChain, verifyAndRepair } from "../../services/register"
import { setChainRegistered } from "../../lib/registration"
import type { ChainMeta } from "../../lib/chains"

type ChainState = "idle" | "registering" | "done" | "error"

function realAddressFor(wallet: any, id: NetworkId): string | undefined {
  if (id === "solana") return wallet?.solanaAccount?.address
  if (id === "sui") return wallet?.suiAccount?.address
  if (id === "aptos") return wallet?.aptosAccount?.address
  return wallet?.normalAccount?.address
}

export default function RegisterView({
  onDone,
  chainsToShow
}: {
  /** Called after at least one chain registers, or when the user closes. */
  onDone: () => void
  /** Restrict to a subset (e.g. only the still-unregistered chains). */
  chainsToShow?: NetworkId[]
}) {
  const { wallet } = useWallet()

  const chains = useMemo<ChainMeta[]>(
    () => (chainsToShow ? CHAINS.filter((c) => chainsToShow.includes(c.id)) : CHAINS),
    [chainsToShow]
  )

  const [openBalances, setOpenBalances] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<Set<NetworkId>>(new Set())
  const [states, setStates] = useState<Record<string, ChainState>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [showAlready, setShowAlready] = useState(false)
  const [verifying, setVerifying] = useState<NetworkId | null>(null)
  const [hiddenChains, setHiddenChains] = useState<Set<NetworkId>>(new Set())

  // ── fetch open-mode balances per chain (a chain is registrable only if funded)
  useEffect(() => {
    if (!wallet) return
    let cancelled = false
    ;(async () => {
      const out: Record<string, number> = {}
      await Promise.all(
        chains.map(async (c) => {
          const addr = realAddressFor(wallet, c.id)
          if (!addr) { out[c.id] = 0; return }
          try {
            const b = await getBalance(addr, c.id)
            out[c.id] = Number(b) || 0
          } catch { out[c.id] = 0 }
        })
      )
      if (!cancelled) setOpenBalances(out)
    })()
    return () => { cancelled = true }
  }, [wallet, chains])

  const visibleChains = useMemo(
    () => chains.filter((c) => !hiddenChains.has(c.id)),
    [chains, hiddenChains]
  )

  const toggle = useCallback((id: NetworkId, funded: boolean) => {
    if (!funded) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const register = useCallback(async () => {
    if (!wallet || selected.size === 0 || busy) return
    setBusy(true)
    let anyDone = false
    for (const id of selected) {
      setStates((s) => ({ ...s, [id]: "registering" }))
      setErrors((e) => ({ ...e, [id]: "" }))
      try {
        await registerOnChain(wallet, id)
        setStates((s) => ({ ...s, [id]: "done" }))
        anyDone = true
      } catch (err: any) {
        const msg = err?.message || "Registration failed"
        // Already registered on-chain → cache it and treat as success.
        if (/already registered/i.test(msg)) {
          const addr = realAddressFor(wallet, id)
          if (addr) await setChainRegistered(addr, id, true)
          setStates((s) => ({ ...s, [id]: "done" }))
          anyDone = true
        } else {
          setStates((s) => ({ ...s, [id]: "error" }))
          setErrors((e) => ({ ...e, [id]: msg }))
        }
      }
    }
    setBusy(false)
    if (anyDone) setTimeout(() => onDone(), 900)
  }, [wallet, selected, busy, onDone])

  const checkAlready = useCallback(async (id: NetworkId) => {
    if (!wallet) return
    setVerifying(id)
    try {
      const ok = await verifyAndRepair(wallet, id)
      if (ok) {
        setHiddenChains((h) => new Set(h).add(id))
        setSelected((s) => { const n = new Set(s); n.delete(id); return n })
      } else {
        setErrors((e) => ({ ...e, [id]: "Not registered on-chain yet." }))
      }
    } catch (err: any) {
      setErrors((e) => ({ ...e, [id]: err?.message || "Check failed" }))
    } finally {
      setVerifying(null)
    }
  }, [wallet])

  const anyFunded = visibleChains.some((c) => (openBalances[c.id] ?? 0) > 0)

  return (
    <div className="relative px-5 pt-8 pb-12">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="font-round text-[8px] tracking-[0.5em] uppercase text-[#C9B0FF] font-bold mb-2">Private Mode</p>
          <h2 className="font-round text-[22px] font-bold tracking-[-0.02em] text-white leading-tight">
            Register to unlock<br />privacy mode
          </h2>
          <p className="text-[11px] text-white/62 mt-2 max-w-[240px] leading-relaxed">
            Bind your wallet to a private identity on the chains you choose. Only funded chains can register.
          </p>
        </div>
        {/* "?" helper */}
        <button
          onClick={() => setShowAlready((v) => !v)}
          className="mt-1 flex h-7 w-7 items-center justify-center rounded-full transition-colors"
          style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(244,238,255,0.7)" }}
          title="Already registered?">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6.4 6.2a1.6 1.6 0 1 1 2.2 1.5c-.5.25-.9.5-.9 1.1v.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="8" cy="11.4" r="0.75" fill="currentColor" />
          </svg>
        </button>
      </div>

      {showAlready && (
        <div className="mt-3 rounded-2xl p-3 text-[11px] text-white/78"
          style={{ background: "rgba(255,255,255,0.09)", border: "1px solid rgba(255,255,255,0.16)" }}>
          Already registered on another device? Tap a chain's <span className="font-semibold text-[#C9B0FF]">Verify</span> to confirm on-chain and unlock it here.
        </div>
      )}

      {/* Chain selector — logos */}
      <div className="mt-6 grid grid-cols-3 gap-2.5">
        {visibleChains.map((c) => {
          const funded = (openBalances[c.id] ?? 0) > 0
          const isSelected = selected.has(c.id)
          const st = states[c.id]
          return (
            <div key={c.id} className="flex flex-col items-center gap-1.5">
              <button
                onClick={() => (showAlready ? void checkAlready(c.id) : toggle(c.id, funded))}
                disabled={!showAlready && !funded}
                className="relative flex h-[68px] w-full flex-col items-center justify-center rounded-2xl transition-all duration-300"
                style={{
                  background: isSelected
                    ? "linear-gradient(145deg, rgba(201,176,255,0.3), rgba(123,85,201,0.2))"
                    : "rgba(255,255,255,0.07)",
                  border: isSelected
                    ? "1px solid rgba(201,176,255,0.62)"
                    : "1px solid rgba(255,255,255,0.13)",
                  opacity: !showAlready && !funded ? 0.34 : 1,
                  cursor: !showAlready && !funded ? "not-allowed" : "pointer"
                }}>
                <div className="h-7 w-7 flex items-center justify-center"
                  style={{ color: isSelected ? "#F4EEFF" : "rgba(244,238,255,0.75)" }}>
                  {c.icon}
                </div>
                {st === "done" && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#6EE7A8] text-[#1D1140]">
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.2 2.2L9.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                )}
                {st === "registering" && (
                  <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full border-2 border-[#C9B0FF] border-t-transparent animate-spin" />
                )}
              </button>
              <div className="flex items-center gap-1">
                <p className="font-round text-[9.5px] font-semibold text-white/80">{c.name}</p>
                {showAlready && (
                  <button onClick={() => void checkAlready(c.id)} className="text-[8px] uppercase tracking-wide text-[#C9B0FF] font-bold">
                    {verifying === c.id ? "…" : "Verify"}
                  </button>
                )}
              </div>
              {!funded && !showAlready && (
                <p className="text-[8px] text-white/45">No balance</p>
              )}
              {errors[c.id] && (
                <p className="text-[8px] text-[#FF8E86] text-center leading-tight max-w-[80px]">{errors[c.id]}</p>
              )}
            </div>
          )
        })}
      </div>

      {!anyFunded && (
        <p className="mt-5 text-center text-[11px] text-white/55">
          Fund a chain in open mode first, then come back to register it.
        </p>
      )}

      {/* Register button */}
      <button
        onClick={() => void register()}
        disabled={selected.size === 0 || busy}
        className="mt-7 w-full rounded-2xl py-3.5 font-round text-[12px] font-bold tracking-[0.14em] uppercase transition-all duration-300"
        style={{
          background: selected.size === 0 || busy ? "rgba(255,255,255,0.1)" : "linear-gradient(145deg, #FBF7FF, #C9B0FF)",
          color: selected.size === 0 || busy ? "rgba(244,238,255,0.45)" : "#3B2570",
          boxShadow: selected.size === 0 || busy ? "none" : "0 10px 26px -12px rgba(201,176,255,0.7)",
          cursor: selected.size === 0 || busy ? "not-allowed" : "pointer"
        }}>
        {busy
          ? "Registering…"
          : selected.size === 0
          ? "Select chains to register"
          : `Register ${selected.size} chain${selected.size > 1 ? "s" : ""}`}
      </button>

      <button onClick={onDone} className="mt-3 w-full text-center font-round text-[10px] tracking-[0.15em] uppercase text-white/55 hover:text-white/85 transition-colors">
        Skip for now
      </button>
    </div>
  )
}
