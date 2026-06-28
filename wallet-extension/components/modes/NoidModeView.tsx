/**
 * NoidModeView.tsx — Liquid iOS Edition v3
 *
 * The private "shadow waters" view — the colour inverse of OpenModeView.
 * Dark page, light treasury card, dark glass bars. Live mainnet prices
 * value the synced private balances; tapping a token bar morphs into the
 * shared CoinDetailView (dark page → light graph card).
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useWallet } from "../../context/WalletContext"
import { usePool } from "../../context/PoolContext"
import { getBalance } from "../../lib/rpc"
import AnimatedNumber from "../shared/AnimatedNumber"
import ComingSoonToast from "../shared/ComingSoonToast"
import MaskModal from "../shared/MaskModal"
import UnMaskModal from "../shared/UnMaskModal"
import ReceiveModal from "../shared/ReceiveModal"
import NoidSendModal from "~components/shared/NoidSendModal"
import ShipsLogEntries from "../shared/ShipsLogEntries"
import CoinDetailView, { type CoinAction, type MorphSource } from "../shared/CoinDetailView"
import KeyEntryRow from "../shared/KeyEntryRow"
import InlineCopyButton from "../shared/InlineCopyButton"
import TreasureWatermark from "../shared/TreasureWatermark"
import { useTokenPrices } from "../shared/usePrices"
import { reverseMorphInto } from "../../lib/flip"
import { CHAINS, CHAIN_BY_ID } from "../../lib/chains"
import { loadNoidTxns, loadMaskTxns, loadUnmaskTxns, loadNoidSendTxns, TX_UPDATE_EVENT } from "../../lib/txStore"
import type { TxEntry } from "../../lib/txStore"
import { type NetworkId } from "../../lib/networks"

const OPEN_BALANCE_POLL_MS = 6_000
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

export default function NoidModeView({ activeCoin, setActiveCoin, scrollToTop, reverseMorph, setReverseMorph }: {
  activeCoin: NetworkId | null
  setActiveCoin: (c: NetworkId | null) => void
  scrollToTop: () => void
  reverseMorph: DOMRect | null
  setReverseMorph: (r: DOMRect | null) => void
}) {
  const { wallet, activeNetwork, setActiveNetwork, treasureChain } = useWallet()
  const { allBalances } = usePool()

  const noid = useMemo(() => {
    if (activeNetwork === "solana") return wallet?.solanaNoidAccount
    if (activeNetwork === "sui") return wallet?.suiNoidAccount
    if (activeNetwork === "aptos") return wallet?.aptosNoidAccount
    return wallet?.noidAccount
  }, [wallet, activeNetwork])

  const normal = useMemo(() => {
    if (activeNetwork === "solana") return wallet?.solanaAccount
    if (activeNetwork === "sui") return wallet?.suiAccount
    if (activeNetwork === "aptos") return wallet?.aptosAccount
    return wallet?.normalAccount
  }, [wallet, activeNetwork])

  const { prices, loading: pricesLoading } = useTokenPrices()

  const [morph, setMorph] = useState<MorphSource | null>(null)
  const [openBalance, setOpenBalance] = useState<string>("0")
  const [showReceive, setShowReceive] = useState(false)
  const [showMask, setShowMask] = useState(false)
  const [showSend, setShowSend] = useState(false)
  const [showUnmask, setShowUnmask] = useState(false)
  const [toast, setToast] = useState<{ show: boolean; msg?: string }>({ show: false })
  const [mounted, setMounted] = useState(false)
  const [txEntries, setTxEntries] = useState<TxEntry[]>([])
  const [showCopyDropdown, setShowCopyDropdown] = useState(false)

  const evmNoidKey = wallet?.noidAccount ? `${wallet.noidAccount.publicKey}|${wallet.noidAccount.zkPublicKey ?? ""}` : ""
  const solNoidKey = wallet?.solanaNoidAccount ? `${wallet.solanaNoidAccount.publicKey}|${wallet.solanaNoidAccount.zkPublicKey ?? ""}` : ""
  const suiNoidKey = wallet?.suiNoidAccount ? `${wallet.suiNoidAccount.publicKey}|${wallet.suiNoidAccount.zkPublicKey ?? ""}` : ""
  const aptNoidKey = wallet?.aptosNoidAccount ? `${wallet.aptosNoidAccount.publicKey}|${wallet.aptosNoidAccount.zkPublicKey ?? ""}` : ""

  const dropdownRef = useRef<HTMLDivElement>(null)
  const treasureRef = useRef<HTMLDivElement>(null)
  const treasureShellRef = useRef<HTMLDivElement>(null)
  const treasureContentRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)

  const refreshOpenBalance = useCallback(async () => {
    if (!normal) return
    try {
      const b = await getBalance(normal.address, activeNetwork)
      if (mountedRef.current) setOpenBalance(b)
    } catch {}
  }, [normal, activeNetwork])

  useEffect(() => {
    mountedRef.current = true
    void refreshOpenBalance()
    const id = setInterval(() => {
      if (!document.hidden) void refreshOpenBalance()
    }, OPEN_BALANCE_POLL_MS)
    requestAnimationFrame(() => setMounted(true))
    return () => {
      mountedRef.current = false
      clearInterval(id)
    }
  }, [refreshOpenBalance])

  useEffect(() => {
    if (!noid?.publicKey) { setTxEntries([]); return }
    const load = () => {
      const all: TxEntry[] = [
        ...loadNoidTxns(noid.publicKey),
        ...loadMaskTxns(noid.publicKey),
        ...loadUnmaskTxns(noid.publicKey),
        ...loadNoidSendTxns(noid.publicKey)
      ].sort((a, b) => b.timestamp - a.timestamp)
      setTxEntries(all)
    }
    load()
    window.addEventListener("focus", load)
    window.addEventListener(TX_UPDATE_EVENT, load)
    return () => {
      window.removeEventListener("focus", load)
      window.removeEventListener(TX_UPDATE_EVENT, load)
    }
  }, [noid?.publicKey])

  // Reverse morph (#4): grow the treasure card out of the graph card's last rect.
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
    for (const c of CHAINS) total += (Number(allBalances[c.id]) || 0) * (prices?.[c.id]?.usd ?? 0)
    return total
  }, [allBalances, prices])

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
    if (!noid?.publicKey) return
    const all: TxEntry[] = [
      ...loadNoidTxns(noid.publicKey),
      ...loadMaskTxns(noid.publicKey),
      ...loadUnmaskTxns(noid.publicKey),
      ...loadNoidSendTxns(noid.publicKey)
    ].sort((a, b) => b.timestamp - a.timestamp)
    setTxEntries(all)
  }

  if (!noid) return null

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

  // ── Coin detail page (dark page → light graph card) ───────────────────────
  const activeChain = activeCoin ? CHAIN_BY_ID[activeCoin] : null
  if (activeCoin && activeChain) {
    const bal = allBalances[activeCoin] || "0"
    const actions: CoinAction[] = [
      { key: "mask", icon: <MaskIcon />, label: "Mask", onClick: () => { void refreshOpenBalance(); setShowMask(true) } },
      { key: "unmask", icon: <UnmaskIcon />, label: "Unmask", onClick: () => setShowUnmask(true) },
      { key: "send", icon: <SendIcon />, label: "Send", onClick: () => setShowSend(true) },
      { key: "receive", icon: <ReceiveIcon />, label: "Receive", onClick: () => setShowReceive(true) }
    ]

    return (
      <CoinDetailView
        chain={activeChain}
        pageTheme="dark"
        balance={bal}
        price={prices?.[activeCoin]}
        priceLoading={pricesLoading}
        balanceLabel="Your Private Balance"
        morph={morph}
        onBack={(graphRect) => { setReverseMorph(graphRect ?? null); setActiveCoin(null); setMorph(null); scrollToTop() }}
        actions={actions}
        shipsLog={<ShipsLogEntries entries={txEntries} isNoid={true} />}>
        <UnMaskModal open={showUnmask} onClose={() => { setShowUnmask(false); void refreshOpenBalance() }} />
        <NoidSendModal open={showSend} onClose={() => { setShowSend(false); reloadTxEntries() }} />
        <ReceiveModal open={showReceive} onClose={() => setShowReceive(false)} mode="noid" publicKey={noid.publicKey} zkPublicKey={noid.zkPublicKey} />
        <MaskModal open={showMask} onClose={() => { setShowMask(false); void refreshOpenBalance() }} openBalance={openBalance} />
        <ComingSoonToast show={toast.show} onDone={() => setToast({ show: false })} message={toast.msg} />
      </CoinDetailView>
    )
  }

  // ── Featured (treasure-card) chain ──────────────────────────────────────
  // A specific chain shows its native private balance front-and-centre and
  // drops its own bar; "all" keeps the combined USD total + all bars.
  const featured = treasureChain === "all" ? null : treasureChain
  const featuredChain = featured ? CHAIN_BY_ID[featured] : null
  const featuredBalRaw = featured ? allBalances[featured] || "0" : "0"
  const featuredUsd = featured
    ? (Number(featuredBalRaw) || 0) * (prices?.[featured]?.usd ?? 0)
    : 0
  const featuredUsdFormatted = featuredUsd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: featuredUsd > 0 && featuredUsd < 1 ? 4 : 2
  })
  const tokenList = featured ? CHAINS.filter((c) => c.id !== featured) : CHAINS

  // ── Dashboard ─────────────────────────────────────────────────────────────
  return (
    /* Background orbs + grid live in the shared backdrop — keeping them out of
       this scroll subtree means decorative elements can't inflate the scroll
       height (no empty space below the last bar). */
    <div className="relative">
      {/* HERO TREASURY CARD — light, taller, bigger balance */}
      <div
        className="px-4 pt-5 relative z-20"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "none" : "translateY(18px) scale(0.97)",
          transition: `opacity 600ms ${SPRING}, transform 600ms ${SPRING}`
        }}>
        <div ref={treasureRef} className="relative rounded-[32px]">
          {/* shell (bg + decorations) — the reverse-morph FLIP target */}
          <div
            ref={treasureShellRef}
            className="absolute inset-0 rounded-[32px] overflow-hidden pointer-events-none z-0"
            style={{
              background: "linear-gradient(145deg, #FBF1D9 0%, #F0E0B6 55%, #EAD5A7 100%)",
              boxShadow: "0 34px 64px -20px rgba(163,110,20,0.4), 0 8px 24px -8px rgba(232,174,58,0.25), inset 0 1px 0 rgba(255,255,255,0.7)"
            }}>
            <div className="pointer-events-none absolute" style={{ top: "-25%", right: "-15%", width: 220, height: 220, borderRadius: "50%", background: "radial-gradient(circle, rgba(232,174,58,0.55) 0%, transparent 60%)", filter: "blur(40px)", animation: "noidOrb1 12s ease-in-out infinite" }} />
            <div className="pointer-events-none absolute" style={{ bottom: "-30%", left: "-20%", width: 240, height: 240, borderRadius: "50%", background: "radial-gradient(circle, rgba(163,110,20,0.35) 0%, transparent 60%)", filter: "blur(50px)", animation: "noidOrb2 10s ease-in-out infinite 2s" }} />
            <div className="pointer-events-none absolute inset-0 opacity-40" style={{ background: "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)", animation: "noidSheen 6s ease-in-out infinite" }} />
            <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "linear-gradient(to right,#171311 1px,transparent 1px),linear-gradient(to bottom,#171311 1px,transparent 1px)", backgroundSize: "28px 28px" }} />
            <TreasureWatermark treasureChain={treasureChain} isNoid={true} />
            <div className="pointer-events-none absolute inset-0 paper-grain opacity-[0.3]" />
          </div>

          <div ref={treasureContentRef} className="relative z-10 px-6 py-9">
            <div className="mb-6">
              <p className="text-[8px] tracking-[0.5em] uppercase text-ink/35 mb-3.5 font-bold">Hidden Treasure</p>
              {featuredChain ? (
                <>
                  <div className="flex items-baseline gap-2">
                    <div
                      className="font-display font-bold tracking-[-0.03em] leading-none text-[#171311]"
                      style={{ textShadow: "0 0 44px rgba(163,110,20,0.25), 0 2px 8px rgba(163,110,20,0.1)" }}>
                      <AnimatedNumber value={formatAssetBalance(featuredBalRaw)} height={48} className="text-[48px]" duration={850} />
                    </div>
                    <span className="font-display font-bold text-[18px] text-ink/45">{featuredChain.symbol}</span>
                  </div>
                  <p className="text-[12px] font-mono text-ink/45 mt-2">≈ {featuredUsdFormatted}</p>
                  <p className="text-[10px] text-ink/40 mt-0.5">
                    Total balance: <span className="text-ink/60 font-semibold">{formattedTotalUsd}</span>
                  </p>
                </>
              ) : (
                <div className="flex items-baseline">
                  <div
                    className="font-display font-bold tracking-[-0.03em] leading-none text-[#171311]"
                    style={{ textShadow: "0 0 44px rgba(163,110,20,0.25), 0 2px 8px rgba(163,110,20,0.1)" }}>
                    <AnimatedNumber value={formattedTotalUsd} height={62} className="text-[62px]" duration={850} />
                  </div>
                </div>
              )}
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
                  background: showCopyDropdown ? "rgba(163,110,20,0.15)" : "rgba(23,19,17,0.05)",
                  border: "1px solid rgba(23,19,17,0.12)",
                  color: "#171311"
                }}>
                <KeyGlyph />
                <span>Copy Keys</span>
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none" className={`transition-transform duration-300 ${showCopyDropdown ? "rotate-180" : ""}`}>
                  <path d="M1.5 3.5L5 7L8.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </LiquidPress>

              {showCopyDropdown && (
                <div className="absolute left-0 top-full z-50 pt-1.5">
                  <div
                    className="w-[240px] rounded-2xl rounded-tl-md p-2.5 text-left border"
                    style={{
                      background: "linear-gradient(150deg, #20190F 0%, #0C0906 100%)",
                      borderColor: "rgba(251,241,217,0.12)",
                      boxShadow: "0 18px 44px rgba(0,0,0,0.7)",
                      transformOrigin: "top left",
                      animation: "copyPopIn 300ms cubic-bezier(0.34,1.4,0.5,1) both"
                    }}>
                    <p className="text-[8px] tracking-[0.3em] uppercase text-[#F4D27A] mb-2 font-semibold px-1">Noid Keys · Private</p>
                    <div className="space-y-0.5">
                      <KeyEntryRow icon={CHAIN_BY_ID.sepolia.icon} label="EVM Noid Key" value={evmNoidKey} />
                      <KeyEntryRow icon={CHAIN_BY_ID.solana.icon} label="Solana Noid Key" value={solNoidKey} />
                      <KeyEntryRow icon={CHAIN_BY_ID.sui.icon} label="Sui Noid Key" value={suiNoidKey} />
                      <KeyEntryRow icon={CHAIN_BY_ID.aptos.icon} label="Aptos Noid Key" value={aptNoidKey} />
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
        <p className="text-[9px] tracking-[0.4em] uppercase font-bold text-bone/40">Tokens</p>
        <div className="flex-1" style={{ height: 1, background: "linear-gradient(to right, rgba(250,245,233,0.16), transparent)" }} />
      </div>

      {/* Token bars — shorter, dark glass */}
      <div className="flex flex-col gap-2 px-4 pb-4">
        {tokenList.map((chain) => {
          const bal = allBalances[chain.id] || "0"
          const price = prices?.[chain.id]
          const usdVal = (Number(bal) || 0) * (price?.usd ?? 0)
          const change = price?.change24h ?? 0
          const up = change >= 0
          const noidKey = chain.id === "solana" ? solNoidKey : chain.id === "sui" ? suiNoidKey : chain.id === "aptos" ? aptNoidKey : evmNoidKey

          return (
            <button
              key={chain.id}
              onClick={(e) => openCoin(chain.id, e)}
              className="group w-full flex items-center justify-between py-2.5 px-3.5 rounded-[20px] text-left hover:scale-[1.012] active:scale-[0.99] transition-transform duration-300"
              style={{
                background: "rgba(250,245,233,0.04)",
                border: "1px solid rgba(250,245,233,0.07)"
              }}>
              <div className="flex items-center gap-3">
                {/* light chip + dark glyph — mirrors the noid (light) treasure card */}
                <div
                  data-coin-icon
                  className="flex h-9 w-9 items-center justify-center rounded-xl p-2"
                  style={{
                    background: "linear-gradient(145deg, #FBF1D9 0%, #EAD5A7 100%)",
                    border: "1px solid rgba(23,19,17,0.1)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
                    color: "#171311"
                  }}>
                  {chain.icon}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[12.5px] font-semibold text-bone/80 leading-tight">{chain.name}</p>
                    <InlineCopyButton value={noidKey} fg="250,245,233" />
                  </div>
                  <p className="text-[9px] text-bone/40 font-mono mt-0.5 tracking-wide uppercase">{chain.subtitle}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="text-right">
                  <p className="flex items-baseline justify-end gap-1 leading-tight">
                    <AnimatedNumber value={formatAssetBalance(bal)} height={15} className="text-[12.5px] font-bold text-bone/80" duration={650} />
                    <span className="text-[9px] text-bone/40 font-normal">{chain.symbol}</span>
                  </p>
                  <p className="text-[9px] font-mono mt-0.5" style={{ color: usdVal > 0 ? (up ? "#4cc78e" : "#e5604d") : "rgba(250,245,233,0.4)" }}>
                    {usdVal > 0 ? `≈ ${usdVal.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: usdVal < 1 ? 4 : 2 })}` : "—"}
                  </p>
                </div>
                <svg width="7" height="7" viewBox="0 0 10 10" fill="none" className="text-bone/25 group-hover:text-bone/45 group-hover:translate-x-0.5 transition-all">
                  <path d="M3 1.5L6.5 5L3 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </button>
          )
        })}
      </div>

      <style>{`
        @keyframes noidOrb1 { 0%,100% { transform: translate(0,0) scale(1); opacity:1; } 50% { transform: translate(-25px,20px) scale(1.15); opacity:0.75; } }
        @keyframes noidOrb2 { 0%,100% { transform: translate(0,0) scale(1); opacity:1; } 50% { transform: translate(35px,-25px) scale(1.18); opacity:0.65; } }
        @keyframes noidSheen { 0%,100% { transform: translateX(-30%);} 50% { transform: translateX(30%);} }
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
/* Mask = shield/hide funds into the privacy pool */
function MaskIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
      <path d="M9 2L15 4.2V8.5C15 12 12.4 14.7 9 16C5.6 14.7 3 12 3 8.5V4.2L9 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6.4 9L8.2 10.8L11.8 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
/* Unmask = reveal back to the public balance */
function UnmaskIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
      <path d="M2 9C2 9 4.7 4.5 9 4.5C13.3 4.5 16 9 16 9C16 9 13.3 13.5 9 13.5C4.7 13.5 2 9 2 9Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="2.1" stroke="currentColor" strokeWidth="1.4" />
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
