/**
 * OpenModeView.tsx — Liquid iOS Edition v3
 *
 * The public treasury view. Light page, dark treasury card. Live mainnet
 * prices value the real (but worthless) testnet balances; tapping a token
 * bar morphs into the shared CoinDetailView.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useWallet } from "../../context/WalletContext"
import { getBalance } from "../../lib/rpc"
import AnimatedNumber from "../shared/AnimatedNumber"
import ComingSoonToast from "../shared/ComingSoonToast"
import ReceiveModal from "../shared/ReceiveModal"
import SendModal from "../shared/SendModal"
import ShipsLogEntries from "../shared/ShipsLogEntries"
import CoinDetailView, { type CoinAction, type MorphSource } from "../shared/CoinDetailView"
import KeyEntryRow from "../shared/KeyEntryRow"
import { useTokenPrices } from "../shared/usePrices"
import { reverseMorphInto } from "../../lib/flip"
import { CHAINS, CHAIN_BY_ID } from "../../lib/chains"
import { loadOpenTxns, TX_UPDATE_EVENT } from "../../lib/txStore"
import type { TxEntry } from "../../lib/txStore"
import { NETWORKS, type NetworkId } from "../../lib/networks"

const POLL_MS = 6_000
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)"

/* ───────────────────────── Liquid press ───────────────────────── */
function LiquidPress({
  children,
  onClick,
  className = "",
  style = {},
  onPointerEnter
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
  style?: React.CSSProperties
  onPointerEnter?: () => void
}) {
  const [pressed, setPressed] = useState(false)
  return (
    <button
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      className={className}
      style={{
        transform: pressed ? "scale(0.94)" : "scale(1)",
        transition: `transform 400ms ${SPRING}`,
        ...style
      }}>
      {children}
    </button>
  )
}

export interface ModeViewProps {
  /** lifted to WalletHome so the selected coin survives an open↔noid switch */
  activeCoin: NetworkId | null
  setActiveCoin: (c: NetworkId | null) => void
  /** resets the wallet body scroll (incl. the liquid-scroll internals) to top */
  scrollToTop: () => void
  /** graph card rect handed back on close, for the reverse morph */
  reverseMorph: DOMRect | null
  setReverseMorph: (r: DOMRect | null) => void
}

export default function OpenModeView({ activeCoin, setActiveCoin, scrollToTop, reverseMorph, setReverseMorph }: ModeViewProps) {
  const { wallet, activeNetwork, setActiveNetwork } = useWallet()

  const account = useMemo(() => {
    if (activeNetwork === "solana") return wallet?.solanaAccount
    if (activeNetwork === "sui") return wallet?.suiAccount
    if (activeNetwork === "aptos") return wallet?.aptosAccount
    return wallet?.normalAccount
  }, [wallet, activeNetwork])

  const { prices, loading: pricesLoading } = useTokenPrices()

  const [morph, setMorph] = useState<MorphSource | null>(null)

  const [balances, setBalances] = useState<Record<NetworkId, string>>({
    monad: "0", sepolia: "0", base_sepolia: "0", solana: "0", sui: "0", aptos: "0"
  })

  const [balanceErr, setBalanceErr] = useState(false)
  const [showReceive, setShowReceive] = useState(false)
  const [showSend, setShowSend] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [txEntries, setTxEntries] = useState<TxEntry[]>([])
  const [showCopyDropdown, setShowCopyDropdown] = useState(false)
  const [toast, setToast] = useState(false)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const treasureRef = useRef<HTMLDivElement>(null)
  const treasureShellRef = useRef<HTMLDivElement>(null)
  const treasureContentRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)

  const fetchAllBalances = useCallback(async () => {
    if (!wallet) return
    const promises = (Object.keys(NETWORKS) as NetworkId[]).map(async (netId) => {
      let addr = wallet.normalAccount?.address
      if (netId === "solana") addr = wallet.solanaAccount?.address
      else if (netId === "sui") addr = wallet.suiAccount?.address
      else if (netId === "aptos") addr = wallet.aptosAccount?.address

      if (!addr) return { netId, balance: "0" }
      try {
        const bal = await getBalance(addr, netId)
        return { netId, balance: bal }
      } catch (e) {
        console.error(`Error fetching balance for ${netId}:`, e)
        return { netId, balance: "0" }
      }
    })

    const results = await Promise.all(promises)
    if (!mountedRef.current) return
    setBalances((prev) => {
      const next = { ...prev }
      for (const r of results) next[r.netId] = r.balance
      return next
    })
    setBalanceErr(false)
  }, [wallet])

  useEffect(() => {
    mountedRef.current = true
    void fetchAllBalances()
    const id = setInterval(() => {
      if (!document.hidden) void fetchAllBalances()
    }, POLL_MS)
    requestAnimationFrame(() => setMounted(true))
    return () => {
      mountedRef.current = false
      clearInterval(id)
    }
  }, [fetchAllBalances])

  useEffect(() => {
    if (!account) return
    const load = () => setTxEntries(loadOpenTxns(account.address))
    load()
    window.addEventListener("focus", load)
    window.addEventListener(TX_UPDATE_EVENT, load)
    return () => {
      window.removeEventListener("focus", load)
      window.removeEventListener(TX_UPDATE_EVENT, load)
    }
  }, [account])

  // Reverse morph (#4): on returning to the list, grow the treasure card out of
  // the graph card's last position. A ref guards against re-processing the same
  // rect; we clear the shared state only after the animation settles.
  const reverseRef = useRef<DOMRect | null>(null)
  useLayoutEffect(() => {
    if (activeCoin || !reverseMorph || reverseRef.current === reverseMorph) return
    reverseRef.current = reverseMorph
    const cancel = reverseMorphInto(treasureShellRef.current, treasureContentRef.current, reverseMorph, 580)
    const clr = setTimeout(() => setReverseMorph(null), 740)
    return () => { cancel(); clearTimeout(clr) }
  }, [activeCoin, reverseMorph, setReverseMorph])

  const totalUsdBalance = useMemo(() => {
    let total = 0
    for (const c of CHAINS) total += (Number(balances[c.id]) || 0) * (prices?.[c.id]?.usd ?? 0)
    return total
  }, [balances, prices])

  const formattedTotalUsd = useMemo(
    () =>
      totalUsdBalance.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
    [totalUsdBalance]
  )

  function reloadTxEntries() {
    if (!account) return
    setTxEntries(loadOpenTxns(account.address))
  }

  if (!account) return null

  const evmAddress = wallet?.normalAccount?.address ?? ""
  const solAddress = wallet?.solanaAccount?.address ?? ""
  const suiAddress = wallet?.suiAccount?.address ?? ""
  const aptAddress = wallet?.aptosAccount?.address ?? ""

  function formatAssetBalance(b: string): string {
    const n = Number(b)
    if (!Number.isFinite(n) || n === 0) return "0.00"
    if (n < 0.01) return n.toFixed(4)
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  }

  function openCoin(id: NetworkId, e: React.MouseEvent<HTMLButtonElement>) {
    // Capture the morph sources while the bar is still on screen, THEN reset the
    // scroll so the coin page opens from the top — never mid-scroll (#13).
    const cardRect = treasureRef.current?.getBoundingClientRect() ?? null
    const iconEl = (e.currentTarget as HTMLElement).querySelector("[data-coin-icon]") as HTMLElement | null
    const iconRect = iconEl?.getBoundingClientRect() ?? null
    scrollToTop()
    setMorph({ card: cardRect, icon: iconRect })
    setActiveCoin(id)
    setActiveNetwork(id)
  }

  // ── Coin detail page ──────────────────────────────────────────────────────
  const activeChain = activeCoin ? CHAIN_BY_ID[activeCoin] : null
  if (activeCoin && activeChain) {
    const bal = balances[activeCoin] || "0"
    const actions: CoinAction[] = [
      { key: "send", icon: <SendIcon />, label: "Send", onClick: () => setShowSend(true) },
      { key: "receive", icon: <ReceiveIcon />, label: "Receive", onClick: () => setShowReceive(true) },
      { key: "buy", icon: <BuyIcon />, label: "Buy", onClick: () => setToast(true) }
    ]

    return (
      <CoinDetailView
        chain={activeChain}
        pageTheme="light"
        balance={bal}
        price={prices?.[activeCoin]}
        priceLoading={pricesLoading}
        balanceLabel="Your Balance"
        morph={morph}
        onBack={(graphRect) => { setReverseMorph(graphRect ?? null); setActiveCoin(null); setMorph(null); scrollToTop() }}
        actions={actions}
        shipsLog={<ShipsLogEntries entries={txEntries} isNoid={false} />}>
        <ReceiveModal open={showReceive} onClose={() => setShowReceive(false)} mode="open" address={account.address} />
        <SendModal
          open={showSend}
          onClose={() => setShowSend(false)}
          fromAddress={account.address}
          privateKey={account.privateKey}
          balance={bal}
          onSent={() => { void fetchAllBalances(); reloadTxEntries() }}
        />
        <ComingSoonToast show={toast} onDone={() => setToast(false)} message="Buying is on the horizon. Coming soon." />
      </CoinDetailView>
    )
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  return (
    /* Background orbs + grid live in the shared backdrop — keeping them out of
       this scroll subtree means decorative elements can't inflate the scroll
       height (no empty space below the last bar). */
    <div className="relative">
      {/* HERO TREASURY CARD — taller, bigger balance */}
      <div
        className="px-4 pt-5 relative z-20"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "none" : "translateY(20px) scale(0.96)",
          filter: mounted ? "none" : "blur(8px)",
          transition: `all 700ms ${SPRING}`
        }}>
        <div ref={treasureRef} className="relative rounded-[32px]">
          {/* shell (bg + decorations) — the reverse-morph FLIP target */}
          <div
            ref={treasureShellRef}
            className="absolute inset-0 rounded-[32px] overflow-hidden pointer-events-none z-0"
            style={{
              background: "linear-gradient(145deg, #1A1410 0%, #0D0A07 60%, #171311 100%)",
              boxShadow: "0 34px 64px -20px rgba(0,0,0,0.8), 0 8px 24px -8px rgba(232,174,58,0.15), inset 0 1px 0 rgba(251,241,217,0.08)"
            }}>
            <div className="pointer-events-none absolute" style={{ top: "-30%", right: "-10%", width: 240, height: 240, borderRadius: "50%", background: "radial-gradient(circle, rgba(232,174,58,0.4) 0%, transparent 60%)", filter: "blur(40px)", animation: "treasureOrb1 12s ease-in-out infinite" }} />
            <div className="pointer-events-none absolute" style={{ bottom: "-20%", left: "-15%", width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(163,110,20,0.3) 0%, transparent 60%)", filter: "blur(50px)", animation: "treasureOrb2 10s ease-in-out infinite 2s" }} />
            <div className="pointer-events-none absolute inset-0 opacity-30" style={{ background: "linear-gradient(115deg, transparent 30%, rgba(251,241,217,0.06) 50%, transparent 70%)", animation: "treasureSheen 6s ease-in-out infinite" }} />
            <div className="pointer-events-none absolute inset-0 opacity-[0.025]" style={{ backgroundImage: "linear-gradient(to right,#FBF1D9 1px,transparent 1px),linear-gradient(to bottom,#FBF1D9 1px,transparent 1px)", backgroundSize: "28px 28px" }} />
            <div className="pointer-events-none absolute inset-0 paper-grain opacity-[0.12]" />
          </div>

          <div ref={treasureContentRef} className="relative z-10 px-6 py-8">
            <div className="mb-5">
              <p className="text-[8px] tracking-[0.5em] uppercase text-bone/30 mb-3 font-bold">Treasure</p>
              <div className="flex items-baseline">
                <div
                  className="font-display font-bold tracking-[-0.03em] leading-none text-[#FBF1D9]"
                  style={{ textShadow: "0 0 44px rgba(232,174,58,0.28), 0 2px 8px rgba(0,0,0,0.5)" }}>
                  <AnimatedNumber value={formattedTotalUsd} height={52} className="text-[52px]" duration={850} />
                </div>
              </div>
              <p className="mt-2 text-[9px] text-bone/25">
                {balanceErr ? "RPC issues — retrying…" : "estimated aggregate valuation · live prices"}
              </p>
            </div>

            {/* Copy Key popover — one hover region; leaving it closes the box */}
            <div
              className="relative inline-block"
              ref={dropdownRef}
              onMouseEnter={() => setShowCopyDropdown(true)}
              onMouseLeave={() => setShowCopyDropdown(false)}>
              <LiquidPress
                onClick={() => setShowCopyDropdown((p) => !p)}
                className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[9px] tracking-[0.2em] uppercase font-semibold"
                style={{
                  background: showCopyDropdown ? "rgba(232,174,58,0.18)" : "rgba(251,241,217,0.05)",
                  border: "1px solid rgba(251,241,217,0.14)",
                  color: "#FAF5E9"
                }}>
                <KeyGlyph />
                <span>Copy Keys</span>
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none" className={`transition-transform duration-300 ${showCopyDropdown ? "rotate-180" : ""}`}>
                  <path d="M1.5 3.5L5 7L8.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </LiquidPress>

              {showCopyDropdown && (
                /* absolute wrapper sits flush under the button (pt-1.5 = invisible
                   bridge so there's no dead zone between button and box) */
                <div className="absolute left-0 top-full z-50 pt-1.5">
                  <div
                    className="w-[272px] rounded-2xl rounded-tl-md p-3 text-left border"
                    style={{
                      background: "linear-gradient(150deg, #20190F 0%, #0C0906 100%)",
                      borderColor: "rgba(251,241,217,0.12)",
                      boxShadow: "0 18px 44px rgba(0,0,0,0.62)",
                      transformOrigin: "top left",
                      animation: "copyPopIn 300ms cubic-bezier(0.34,1.4,0.5,1) both"
                    }}>
                    <p className="text-[8px] tracking-[0.3em] uppercase text-bone/45 mb-2 font-semibold px-1">Receiving Addresses</p>
                    <div className="space-y-0.5">
                      <KeyEntryRow icon={CHAIN_BY_ID.sepolia.icon} label="EVM · Monad / Eth / Base" value={evmAddress} />
                      <KeyEntryRow icon={CHAIN_BY_ID.solana.icon} label="Solana" value={solAddress} />
                      <KeyEntryRow icon={CHAIN_BY_ID.sui.icon} label="Sui" value={suiAddress} />
                      <KeyEntryRow icon={CHAIN_BY_ID.aptos.icon} label="Aptos" value={aptAddress} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tokens header */}
      <div className="px-5 mt-6 mb-2.5 flex items-center gap-2.5">
        <p className="text-[9px] tracking-[0.4em] uppercase font-bold text-ink/40">Tokens</p>
        <div className="flex-1" style={{ height: 1, background: "linear-gradient(to right, rgba(23,19,17,0.14), transparent)" }} />
      </div>

      {/* Token bars — shorter */}
      <div className="flex flex-col gap-2 px-4 pb-4">
        {CHAINS.map((chain, idx) => {
          const bal = balances[chain.id] || "0"
          const price = prices?.[chain.id]
          const usdVal = (Number(bal) || 0) * (price?.usd ?? 0)
          const change = price?.change24h ?? 0
          const up = change >= 0

          return (
            <button
              key={chain.id}
              onClick={(e) => openCoin(chain.id, e)}
              className="group w-full flex items-center justify-between py-2.5 px-3.5 rounded-[20px] text-left hover:scale-[1.012] active:scale-[0.99] transition-transform duration-300"
              style={{
                background: "rgba(23,19,17,0.04)",
                border: "1px solid rgba(23,19,17,0.07)",
                animation: `liquidFadeIn 500ms ${SPRING} ${idx * 40}ms both`
              }}>
              <div className="flex items-center gap-3">
                {/* dark coffee-brown chip + warm cream glyph */}
                <div
                  data-coin-icon
                  className="flex h-9 w-9 items-center justify-center rounded-xl p-2"
                  style={{
                    background: "linear-gradient(145deg, #3A2C1C 0%, #241A10 100%)",
                    border: "1px solid rgba(251,241,217,0.1)",
                    boxShadow: "inset 0 1px 0 rgba(251,241,217,0.08)",
                    color: "#F4E7CC"
                  }}>
                  {chain.icon}
                </div>
                <div>
                  <p className="text-[12.5px] font-semibold text-ink/80 leading-tight">{chain.name}</p>
                  <p className="text-[9px] text-ink/40 font-mono mt-0.5 tracking-wide uppercase">{chain.subtitle}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="text-right">
                  <p className="text-[12.5px] font-bold text-ink/80 leading-tight">
                    {formatAssetBalance(bal)} <span className="text-[9px] text-ink/40 font-normal">{chain.symbol}</span>
                  </p>
                  <p className="text-[9px] font-mono mt-0.5" style={{ color: usdVal > 0 ? (up ? "#2f9e6b" : "#cf5642") : "rgba(23,19,17,0.4)" }}>
                    {usdVal > 0 ? `≈ ${usdVal.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: usdVal < 1 ? 4 : 2 })}` : "—"}
                  </p>
                </div>
                <svg width="7" height="7" viewBox="0 0 10 10" fill="none" className="text-ink/25 group-hover:text-ink/45 group-hover:translate-x-0.5 transition-all">
                  <path d="M3 1.5L6.5 5L3 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </button>
          )
        })}
      </div>

      <style>{`
        @keyframes treasureOrb1 { 0%,100% { transform: translate(0,0) scale(1); opacity:1; } 50% { transform: translate(-30px,20px) scale(1.15); opacity:0.7; } }
        @keyframes treasureOrb2 { 0%,100% { transform: translate(0,0) scale(1); opacity:1; } 50% { transform: translate(40px,-30px) scale(1.2); opacity:0.6; } }
        @keyframes treasureSheen { 0%,100% { transform: translateX(-30%);} 50% { transform: translateX(30%);} }
        @keyframes copyPopIn { 0% { opacity:0; transform: scale(0.9) translateY(-6px);} 100% { opacity:1; transform: scale(1) translateY(0);} }
      `}</style>
    </div>
  )
}

/* ─── icons ─── */
function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
      <path d="M4 14L14 4M14 4H7M14 4V11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function ReceiveIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
      <path d="M14 4L4 14M4 14H11M4 14V7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function BuyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
      <rect x="2.5" y="4.5" width="13" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 7.5H15.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 11H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
function KeyGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
      <circle cx="5" cy="5" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7 7L12 12M10.5 12.5L12 11M9 11L10.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
