/**
 * OpenModeView.tsx — Liquid iOS Edition v2
 *
 * Same liquid design, refined transitions to feel more responsive.
 * The scroll feel is controlled by WalletHome's useLiquidScroll hook.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useWallet } from "../../context/WalletContext"
import { getBalance } from "../../lib/rpc"
import AnimatedNumber from "../shared/AnimatedNumber"
import ComingSoonToast from "../shared/ComingSoonToast"
import ReceiveModal from "../shared/ReceiveModal"
import SendModal from "../shared/SendModal"
import ShipsLogEntries from "../shared/ShipsLogEntries"
import { loadOpenTxns, TX_UPDATE_EVENT } from "../../lib/txStore"
import type { TxEntry } from "../../lib/txStore"
import { NETWORKS, type NetworkId } from "../../lib/networks"

const POLL_MS = 6_000
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)"
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)"

const MOCK_CHARTS: Record<NetworkId, number[]> = {
  monad: [1.45, 1.48, 1.42, 1.51, 1.49, 1.55, 1.50],
  sepolia: [3420, 3480, 3450, 3510, 3490, 3530, 3500],
  base_sepolia: [3480, 3460, 3490, 3470, 3520, 3495, 3500],
  solana: [142, 148, 145, 152, 149, 155, 150],
  sui: [1.42, 1.46, 1.43, 1.49, 1.47, 1.52, 1.50],
  aptos: [7.6, 7.9, 7.7, 8.2, 8.0, 8.4, 8.0],
}

/* ───────────────────────── Liquid press (spring physics) ───────────────────────── */
function LiquidPress({
  children,
  onClick,
  disabled,
  className = "",
  style = {}
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const [pressed, setPressed] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onPointerDown={() => !disabled && setPressed(true)}
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

function SparklineChart({ points, color }: { points: number[]; color: string }) {
  const minVal = Math.min(...points)
  const maxVal = Math.max(...points)
  const range = maxVal - minVal || 1
  
  const width = 320
  const height = 110
  const padX = 10
  const padY = 10
  
  const coords = points.map((val, idx) => {
    const x = padX + (idx / (points.length - 1)) * (width - 2 * padX)
    const y = height - padY - ((val - minVal) / range) * (height - 2 * padY)
    return { x, y }
  })
  
  let pathD = ""
  if (coords.length > 0) {
    pathD = `M ${coords[0].x} ${coords[0].y}`
    for (let i = 1; i < coords.length; i++) {
      pathD += ` L ${coords[i].x} ${coords[i].y}`
    }
  }
  
  const fillD = pathD ? `${pathD} L ${coords[coords.length - 1].x} ${height} L ${coords[0].x} ${height} Z` : ""
  
  return (
    <div className="relative w-full h-[110px] my-3 overflow-hidden rounded-2xl">
      <svg className="w-full h-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.00" />
          </linearGradient>
        </defs>
        {fillD && <path d={fillD} fill="url(#chartGradient)" />}
        {pathD && <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    </div>
  )
}

export default function OpenModeView() {
  const { wallet, entries, activeIndex, activeNetwork, setActiveNetwork } = useWallet()
  
  const account = useMemo(() => {
    if (activeNetwork === "solana") return wallet?.solanaAccount
    if (activeNetwork === "sui") return wallet?.suiAccount
    if (activeNetwork === "aptos") return wallet?.aptosAccount
    return wallet?.normalAccount
  }, [wallet, activeNetwork])

  const [activeCoin, setActiveCoin] = useState<NetworkId | null>(null)
  
  const [balances, setBalances] = useState<Record<NetworkId, string>>({
    monad: "0",
    sepolia: "0",
    base_sepolia: "0",
    solana: "0",
    sui: "0",
    aptos: "0",
  })
  
  const [balanceErr, setBalanceErr] = useState(false)
  const [showReceive, setShowReceive] = useState(false)
  const [showSend, setShowSend] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [txEntries, setTxEntries] = useState<TxEntry[]>([])
  const [showCopyDropdown, setShowCopyDropdown] = useState(false)
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({
    evm: false, solana: false, sui: false, aptos: false
  })

  const dropdownRef = useRef<HTMLDivElement>(null)
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
    const newBalances = { ...balances }
    for (const r of results) {
      newBalances[r.netId] = r.balance
    }
    setBalances(newBalances)
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

  const totalUsdBalance = useMemo(() => {
    let total = 0
    total += Number(balances.monad || "0") * 1.50
    total += Number(balances.sepolia || "0") * 3500.00
    total += Number(balances.base_sepolia || "0") * 3500.00
    total += Number(balances.solana || "0") * 150.00
    total += Number(balances.sui || "0") * 1.50
    total += Number(balances.aptos || "0") * 8.00
    return total
  }, [balances])

  const formattedTotalUsd = useMemo(() => {
    return totalUsdBalance.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }, [totalUsdBalance])

  function reloadTxEntries() {
    if (!account) return
    setTxEntries(loadOpenTxns(account.address))
  }

  if (!account) return null

  function trunc(s: string, a = 7, b = 4) {
    if (!s) return "—"
    return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
  }

  const copyToClipboard = (text: string, label: string) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedStates(prev => ({ ...prev, [label]: true }))
    setTimeout(() => {
      setCopiedStates(prev => ({ ...prev, [label]: false }))
    }, 1500)
  }

  const CHAINS = [
    {
      id: "monad" as NetworkId,
      name: "Monad",
      subtitle: "testnet",
      price: 1.50,
      nativeCurrency: "MON",
      color: "rgb(99, 102, 241)",
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
          <path d="M12 3c-2.599 0-9 6.4-9 9s6.401 9 9 9 9-6.401 9-9-6.401-9-9-9m-1.402 14.146c-1.097-.298-4.043-5.453-3.744-6.549s5.453-4.042 6.549-3.743c1.095.298 4.042 5.453 3.743 6.549-.298 1.095-5.453 4.042-6.549 3.743" />
        </svg>
      ),
    },
    {
      id: "sepolia" as NetworkId,
      name: "Ethereum",
      subtitle: "testnet",
      price: 3500.00,
      nativeCurrency: "ETH",
      color: "rgb(232, 174, 58)",
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
          <path d="M12 3v6.652l5.625 2.516zm0 0-5.625 9.166L12 9.652zm0 13.478V21l5.625-7.785zM12 21v-4.522l-5.625-3.263z" />
          <path d="m12 15.43 5.625-3.263L12 9.652zm-5.625-3.263L12 15.43V9.652z" />
          <path fillRule="evenodd" d="m12 15.43-5.625-3.262L12 3l5.625 9.166zm-5.25-3.528 5.162-8.41v6.115zm-.077.229 5.239-2.327v5.364zm5.418-2.327v5.364l5.233-3.037zm0-.197 5.162 2.295-5.162-8.41z" clipRule="evenodd" />
          <path fillRule="evenodd" d="m12 16.407-5.625-3.195L12 21l5.625-7.789zm-4.995-2.633 4.906 2.79v4.005zm5.085 2.79v4.005l4.904-6.795z" clipRule="evenodd" />
        </svg>
      ),
    },
    {
      id: "base_sepolia" as NetworkId,
      name: "Base",
      subtitle: "testnet",
      price: 3500.00,
      nativeCurrency: "ETH",
      color: "rgb(0, 82, 255)",
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
          <path d="M3 4.706c0-.585 0-.877.11-1.101.106-.215.28-.39.496-.495C3.83 3 4.122 3 4.706 3h14.588c.585 0 .876 0 1.101.11.215.105.389.28.494.495.111.225.111.517.111 1.101v14.588c0 .585 0 .876-.11 1.101-.106.215-.28.389-.495.494-.225.111-.517.111-1.101.111H4.706c-.585 0-.876 0-1.101-.11a1.08 1.08 0 0 1-.494-.495C3 20.17 3 19.878 3 19.294z" />
        </svg>
      ),
    },
    {
      id: "solana" as NetworkId,
      name: "Solana",
      subtitle: "devnet",
      price: 150.00,
      nativeCurrency: "SOL",
      color: "rgb(153, 50, 204)",
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
          <path d="M18.413 7.903a.62.62 0 0 1-.411.162H3.58c-.512 0-.77-.585-.416-.928l2.369-2.283a.6.6 0 0 1 .41-.17H20.42c.517 0 .77.591.41.935zm0 11.255a.62.62 0 0 1-.411.157H3.58c-.512 0-.77-.58-.416-.922l2.369-2.29a.6.6 0 0 1 .41-.163H20.42c.517 0 .77.585.41.928zm0-8.686a.62.62 0 0 0-.411-.157H3.58c-.512 0-.77.58-.416.922l2.369 2.29a.6.6 0 0 0 .41.163H20.42c.517 0 .77-.585.41-.928z" />
        </svg>
      ),
    },
    {
      id: "sui" as NetworkId,
      name: "Sui",
      subtitle: "testnet",
      price: 1.50,
      nativeCurrency: "SUI",
      color: "rgb(10, 186, 250)",
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
          <path d="M16.129 10.508a5.44 5.44 0 0 1 1.148 3.356 5.47 5.47 0 0 1-1.18 3.4l-.064.079-.016-.107a5 5 0 0 0-.053-.26c-.37-1.656-1.566-3.08-3.546-4.233-1.334-.774-2.102-1.705-2.304-2.765a4.1 4.1 0 0 1 .16-1.969c.15-.494.385-.961.693-1.376l.773-.963a.334.334 0 0 1 .519 0zm1.217-.964L12.19 3.092a.243.243 0 0 0-.38 0L6.653 9.549l-.016.016a7.1 7.1 0 0 0-1.52 4.405C5.118 17.85 8.199 21 12 21s6.883-3.15 6.883-7.03a7.1 7.1 0 0 0-1.52-4.405zm-9.46.943.46-.577.017.105.037.255c.301 1.604 1.366 2.938 3.15 3.97 1.551.905 2.45 1.943 2.71 3.081.1.443.128.898.079 1.35v.027l-.021.01a5.2 5.2 0 0 1-2.319.544c-2.911 0-5.278-2.412-5.278-5.388a5.44 5.44 0 0 1 1.165-3.377" />
        </svg>
      ),
    },
    {
      id: "aptos" as NetworkId,
      name: "Aptos",
      subtitle: "testnet",
      price: 8.00,
      nativeCurrency: "APT",
      color: "rgb(241, 102, 53)",
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
          <path d="M15.336 9.02a.65.65 0 0 1-.483-.217l-.643-.726a.507.507 0 0 0-.757 0l-.552.623a.95.95 0 0 1-.713.322h-8.68a9 9 0 0 0-.473 2.221h8.196a.53.53 0 0 0 .38-.163l.764-.796a.5.5 0 0 1 .365-.155h.031c.145 0 .283.061.379.17l.643.726a.65.65 0 0 0 .483.218h6.69a9 9 0 0 0-.473-2.221zm-7.341 6.894a.53.53 0 0 0 .38-.163l.764-.796a.5.5 0 0 1 .365-.156h.031c.145 0 .283.062.379.17l.643.727a.65.65 0 0 0 .483.218h9.066c.34-.702.588-1.456.736-2.244h-8.701a.65.65 0 0 1-.483-.217l-.643-.727a.507.507 0 0 0-.757 0l-.552.624a.95.95 0 0 1-.713.321H3.158c.148.789.397 1.542.737 2.243zm6.431-9.32a.53.53 0 0 0 .382-.163l.763-.796a.5.5 0 0 1 .364-.155h.032c.144 0 .283.061.378.17l.643.727a.65.65 0 0 0 .484.217h1.723A8.99 8.99 0 0 0 12.001 3a8.99 8.99 0 0 0-7.195 3.594zm-5.82 11.544a.65.65 0 0 1-.484-.218l-.643-.726a.507.507 0 0 0-.756 0l-.552.623a.95.95 0 0 1-.713.321h-.037A8.97 8.97 0 0 0 12.001 21a8.97 8.97 0 0 0 6.578-2.862z" />
        </svg>
      ),
    },
  ]

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

  // Render detail view if a coin is selected
  const activeChain = CHAINS.find(c => c.id === activeCoin)

  if (activeCoin && activeChain) {
    const bal = balances[activeCoin] || "0"
    const usdVal = Number(bal) * activeChain.price
    const formattedUsd = usdVal.toLocaleString("en-US", { style: "currency", currency: "USD" })
    const formattedBal = formatAssetBalance(bal)
    const points = MOCK_CHARTS[activeCoin] || [1, 1.1, 1.05, 1.2, 1.15, 1.3, 1.25]
    const percentChange = "+3.45%"

    return (
      <div 
        className="px-5 pt-3 pb-8 flex flex-col min-h-full"
        style={{
          animation: `coinPageEntrance 550ms ${SPRING} both`
        }}>
        {/* Navigation header */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setActiveCoin(null)}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:scale-105 transition-transform"
            style={{
              background: "rgba(23,19,17,0.06)",
              border: "1px solid rgba(23,19,17,0.1)",
              color: "#171311"
            }}>
            <svg width="14" height="14" viewBox="0 0 10 10" fill="none">
              <path d="M6.5 8.5L3 5L6.5 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          
          <div className="flex items-center gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{
                background: "rgba(163,110,20,0.1)",
                border: "1px solid rgba(163,110,20,0.2)",
                color: "#A36E14",
                animation: `coinLogoTransition 500ms ${SPRING} both`
              }}>
              {activeChain.icon}
            </div>
            <div className="text-right flex flex-col justify-center">
              <p className="text-[12px] font-bold text-ink/80 leading-none">{activeChain.name}</p>
              <p className="text-[8px] text-ink/40 font-mono mt-0.5 tracking-wider uppercase leading-none">{activeChain.subtitle}</p>
            </div>
          </div>
        </div>

        {/* Price & Sparkline */}
        <div style={{ animation: `coinFadeIn 550ms ${SPRING} 80ms both` }} className="mt-2 text-center">
          <p className="text-[9px] tracking-[0.4em] uppercase text-ink/40 font-semibold mb-1">Price</p>
          <div className="flex items-baseline justify-center gap-1.5 leading-none">
            <span className="text-[26px] font-display font-bold text-ink/90">
              {activeChain.price.toLocaleString("en-US", { style: "currency", currency: "USD" })}
            </span>
            <span className="text-[10px] font-mono text-emerald-600 font-semibold">{percentChange}</span>
          </div>
          
          {/* Sparkline chart */}
          <SparklineChart points={points} color={activeChain.color} />
        </div>

        {/* Balance Card */}
        <div 
          className="p-4 rounded-3xl mt-2 mb-4 text-center border"
          style={{
            background: "rgba(23,19,17,0.03)",
            borderColor: "rgba(23,19,17,0.06)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            animation: `coinFadeIn 550ms ${SPRING} 160ms both`
          }}>
          <p className="text-[8px] tracking-[0.4em] uppercase text-ink/40 font-semibold mb-1.5">Your Balance</p>
          <p className="text-[22px] font-display font-bold text-ink/90">
            {formattedBal} <span className="text-[12px] text-ink/40 font-normal">{activeChain.nativeCurrency}</span>
          </p>
          <p className="text-[11px] text-ink/40 font-mono mt-1">≈ {formattedUsd}</p>
        </div>

        {/* Action Buttons */}
        <div 
          className="grid grid-cols-2 gap-3 mb-6"
          style={{ animation: `coinFadeIn 550ms ${SPRING} 240ms both` }}>
          <LiquidActionButton
            icon={<SendIcon />}
            label="Send"
            onClick={() => setShowSend(true)}
            delay={0}
          />
          <LiquidActionButton
            icon={<ReceiveIcon />}
            label="Receive"
            onClick={() => setShowReceive(true)}
            delay={50}
          />
        </div>

        {/* Ship's Log */}
        <div 
          className="mt-2 flex-1"
          style={{ animation: `coinFadeIn 550ms ${SPRING} 320ms both` }}>
          <div className="flex items-center gap-2 mb-3">
            <div style={{ height: "1px", flex: 1, background: "linear-gradient(to right, transparent, rgba(23,19,17,0.12), transparent)" }} />
            <p className="text-[8px] tracking-[0.5em] uppercase text-ink/40 shrink-0">Ship's Log</p>
            <div style={{ height: "1px", flex: 1, background: "linear-gradient(to right, transparent, rgba(23,19,17,0.12), transparent)" }} />
          </div>
          
          <ShipsLogEntries entries={txEntries} isNoid={false} />
        </div>

        {/* Modal mounts */}
        <ReceiveModal
          open={showReceive}
          onClose={() => setShowReceive(false)}
          mode="open"
          address={account.address}
        />
        <SendModal
          open={showSend}
          onClose={() => setShowSend(false)}
          fromAddress={account.address}
          privateKey={account.privateKey}
          balance={bal}
          onSent={() => { void fetchAllBalances(); reloadTxEntries() }}
        />
      </div>
    )
  }

  // Render main dashboard view
  return (
    <div className="relative">
      {/* Background grid layer */}
      <div className="pointer-events-none fixed inset-0 -z-10" style={{
        opacity: 0.035,
        backgroundImage: "linear-gradient(to right,#171311 1px,transparent 1px),linear-gradient(to bottom,#171311 1px,transparent 1px)",
        backgroundSize: "28px 28px",
      }} />
      <div className="pointer-events-none fixed inset-0 -z-10" style={{
        top: "-18%", right: "-12%", width: 260, height: 260,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(232,174,58,0.18) 0%, transparent 60%)",
        filter: "blur(48px)",
        animation: "openBgOrb1 14s ease-in-out infinite",
      }} />
      <div className="pointer-events-none fixed inset-0 -z-10" style={{
        bottom: "-15%", left: "-10%", width: 240, height: 240,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(163,110,20,0.14) 0%, transparent 60%)",
        filter: "blur(52px)",
        animation: "openBgOrb2 11s ease-in-out infinite 3s",
      }} />

      {/* HERO TREASURY CARD */}
      <div
        className="px-4 pt-5 relative z-20"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0) scale(1)" : "translateY(20px) scale(0.96)",
          filter: mounted ? "blur(0)" : "blur(8px)",
          transition: `all 700ms ${SPRING}`
        }}>
        <div
          className="relative rounded-[32px]"
          style={{
            background: "linear-gradient(145deg, #1A1410 0%, #0D0A07 60%, #171311 100%)",
            boxShadow:
              "0 30px 60px -20px rgba(0,0,0,0.8), 0 8px 24px -8px rgba(232,174,58,0.15), inset 0 1px 0 rgba(251,241,217,0.08)"
          }}>
          {/* Background orbs clipped to container border-radius */}
          <div className="absolute inset-0 rounded-[32px] overflow-hidden pointer-events-none z-0">
            <div
              className="pointer-events-none absolute"
              style={{
                top: "-30%",
                right: "-10%",
                width: 240,
                height: 240,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(232,174,58,0.4) 0%, transparent 60%)",
                filter: "blur(40px)",
                animation: "treasureOrb1 12s ease-in-out infinite"
              }}
            />
            <div
              className="pointer-events-none absolute"
              style={{
                bottom: "-20%",
                left: "-15%",
                width: 200,
                height: 200,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(163,110,20,0.3) 0%, transparent 60%)",
                filter: "blur(50px)",
                animation: "treasureOrb2 10s ease-in-out infinite 2s"
              }}
            />
            <div
              className="pointer-events-none absolute inset-0 opacity-30"
              style={{
                background:
                  "linear-gradient(115deg, transparent 30%, rgba(251,241,217,0.06) 50%, transparent 70%)",
                animation: "treasureSheen 6s ease-in-out infinite"
              }}
            />
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.025]"
              style={{
                backgroundImage:
                  "linear-gradient(to right,#FBF1D9 1px,transparent 1px),linear-gradient(to bottom,#FBF1D9 1px,transparent 1px)",
                backgroundSize: "28px 28px"
              }}
            />
            <div className="pointer-events-none absolute inset-0 paper-grain opacity-[0.12]" />
          </div>

          <div className="relative z-10 px-5 py-6">
            <div className="mb-4">
              <p className="text-[8px] tracking-[0.5em] uppercase text-bone/30 mb-2 font-bold">
                Treasure
              </p>
              <div className="flex items-baseline gap-2">
                <div
                  className="font-display font-bold tracking-[-0.03em] leading-none text-[#FBF1D9]"
                  style={{
                    textShadow:
                      "0 0 40px rgba(232,174,58,0.25), 0 2px 8px rgba(0,0,0,0.5)"
                  }}>
                  <AnimatedNumber
                    value={formattedTotalUsd}
                    height={40}
                    className="text-[40px]"
                    duration={800}
                  />
                </div>
              </div>
              <p className="mt-1 text-[9px] text-bone/25">
                {balanceErr ? "RPC issues - retrying..." : "estimated aggregate valuation"}
              </p>
            </div>

            {/* Copy Key Popover Dropdown */}
            <div className="relative inline-block" ref={dropdownRef}>
              <LiquidPress
                onClick={() => setShowCopyDropdown(prev => !prev)}
                onPointerEnter={() => setShowCopyDropdown(true)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[9px] tracking-[0.2em] uppercase"
                style={{
                  background: showCopyDropdown ? "rgba(232,174,58,0.18)" : "rgba(251,241,217,0.04)",
                  border: "1px solid rgba(251,241,217,0.12)",
                  color: "#FAF5E9"
                }}>
                <span>Copy Key</span>
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none" className={`transform transition-transform duration-300 ${showCopyDropdown ? "rotate-180" : ""}`}>
                  <path d="M1.5 3.5L5 7L8.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </LiquidPress>

              {showCopyDropdown && (
                <div 
                  onMouseLeave={() => setShowCopyDropdown(false)}
                  className="absolute left-0 mt-2 w-64 rounded-2xl p-3 z-50 text-left border"
                  style={{
                    background: "linear-gradient(145deg, #1E1810 0%, #0D0A07 100%)",
                    borderColor: "rgba(251,241,217,0.12)",
                    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.6)",
                    animation: "liquidFadeIn 300ms cubic-bezier(0.34, 1.56, 0.64, 1) both"
                  }}>
                  <p className="text-[8px] tracking-[0.3em] uppercase text-bone/45 mb-2 font-semibold">Addresses</p>
                  <div className="space-y-2">
                    {/* EVM Addresses */}
                    <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl hover:bg-bone/5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] text-bone/40 uppercase tracking-[0.1em] font-semibold">EVM (Monad/Eth/Base)</p>
                        <p className="font-mono text-[10px] text-bone/80 truncate mt-0.5">{trunc(evmAddress, 10, 8)}</p>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(evmAddress, "evm")}
                        className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-bone/5 hover:bg-bone/10 transition-colors text-bone/60 hover:text-[#E8AE3A]">
                        {copiedStates["evm"] ? "✓" : "Copy"}
                      </button>
                    </div>
                    
                    {/* Solana Address */}
                    <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl hover:bg-bone/5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] text-bone/40 uppercase tracking-[0.1em] font-semibold">Solana</p>
                        <p className="font-mono text-[10px] text-bone/80 truncate mt-0.5">{trunc(solAddress, 10, 8)}</p>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(solAddress, "solana")}
                        className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-bone/5 hover:bg-bone/10 transition-colors text-bone/60 hover:text-[#E8AE3A]">
                        {copiedStates["solana"] ? "✓" : "Copy"}
                      </button>
                    </div>

                    {/* Sui Address */}
                    <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl hover:bg-bone/5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] text-bone/40 uppercase tracking-[0.1em] font-semibold">Sui</p>
                        <p className="font-mono text-[10px] text-bone/80 truncate mt-0.5">{trunc(suiAddress, 10, 8)}</p>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(suiAddress, "sui")}
                        className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-bone/5 hover:bg-bone/10 transition-colors text-bone/60 hover:text-[#E8AE3A]">
                        {copiedStates["sui"] ? "✓" : "Copy"}
                      </button>
                    </div>

                    {/* Aptos Address */}
                    <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl hover:bg-bone/5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] text-bone/40 uppercase tracking-[0.1em] font-semibold">Aptos</p>
                        <p className="font-mono text-[10px] text-bone/80 truncate mt-0.5">{trunc(aptAddress, 10, 8)}</p>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(aptAddress, "aptos")}
                        className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-bone/5 hover:bg-bone/10 transition-colors text-bone/60 hover:text-[#E8AE3A]">
                        {copiedStates["aptos"] ? "✓" : "Copy"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 6 Network Bars */}
      <div className="flex flex-col gap-2.5 mt-5 px-4 pb-8">
        {CHAINS.map((chain, idx) => {
          const bal = balances[chain.id] || "0"
          const usdVal = Number(bal) * chain.price
          const formattedUsd = usdVal.toLocaleString("en-US", { style: "currency", currency: "USD" })
          const formattedBal = formatAssetBalance(bal)
          
          return (
            <button
              key={chain.id}
              onClick={() => {
                setActiveCoin(chain.id)
                setActiveNetwork(chain.id)
              }}
              className="w-full flex items-center justify-between p-4 rounded-[24px] text-left hover:scale-[1.01] transition-transform duration-300"
              style={{
                background: "rgba(23,19,17,0.03)",
                border: "1px solid rgba(23,19,17,0.06)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                animation: `liquidFadeIn 500ms ${SPRING} ${idx * 40}ms both`
              }}>
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{
                    background: "rgba(163,110,20,0.1)",
                    border: "1px solid rgba(163,110,20,0.2)",
                    color: "#A36E14"
                  }}>
                  {chain.icon}
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-ink/80">{chain.name}</p>
                  <p className="text-[10px] text-ink/40 font-mono mt-0.5">{chain.subtitle}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[13px] font-bold text-ink/80">
                  {formattedBal} <span className="text-[10px] text-ink/40 font-normal">{chain.nativeCurrency}</span>
                </p>
                <p className="text-[10px] text-ink/40 font-mono mt-0.5">≈ {formattedUsd}</p>
              </div>
            </button>
          )
        })}
      </div>

      <style>{`
        @keyframes treasureOrb1 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 1; }
          50% { transform: translate(-30px, 20px) scale(1.15); opacity: 0.7; }
        }
        @keyframes treasureOrb2 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 1; }
          50% { transform: translate(40px, -30px) scale(1.2); opacity: 0.6; }
        }
        @keyframes treasureSheen {
          0%, 100% { transform: translateX(-30%); }
          50% { transform: translateX(30%); }
        }
        @keyframes openBgOrb1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-30px, 25px) scale(1.12); }
        }
        @keyframes openBgOrb2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(40px, -30px) scale(1.15); }
        }
        @keyframes coinPageEntrance {
          0% { opacity: 0; transform: translateY(40px) scale(0.95); filter: blur(6px); }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes coinLogoTransition {
          0% { transform: scale(1.4) translate(10px, 20px); }
          100% { transform: scale(1) translate(0, 0); }
        }
        @keyframes coinFadeIn {
          0% { opacity: 0; transform: translateY(12px); filter: blur(4px); }
          100% { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
      `}</style>
    </div>
  )
}

/* ───────────────────────── Liquid Action Button ───────────────────────── */
function LiquidActionButton({
  icon,
  label,
  onClick,
  muted,
  delay = 0
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  muted?: boolean
  delay?: number
}) {
  const [pressed, setPressed] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay)
    return () => clearTimeout(t)
  }, [delay])

  return (
    <button
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => { setPressed(false); setHovering(false) }}
      onPointerEnter={() => setHovering(true)}
      className="group relative overflow-hidden rounded-2xl text-left w-full"
      style={{
        padding: "12px 12px 11px",
        background: muted
          ? "rgba(23,19,17,0.03)"
          : "linear-gradient(145deg, rgba(23,19,17,0.06) 0%, rgba(163,110,20,0.06) 100%)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: muted
          ? "1px solid rgba(23,19,17,0.06)"
          : hovering
            ? "1px solid rgba(163,110,20,0.4)"
            : "1px solid rgba(163,110,20,0.18)",
        boxShadow: muted
          ? "inset 0 1px 0 rgba(255,255,255,0.4)"
          : hovering
            ? "inset 0 1px 0 rgba(255,255,255,0.6), 0 8px 24px -6px rgba(163,110,20,0.25)"
            : "inset 0 1px 0 rgba(255,255,255,0.4), 0 2px 8px rgba(163,110,20,0.06)",
        transform: pressed
          ? "scale(0.93) translateY(0)"
          : mounted
            ? hovering
              ? "scale(1) translateY(-3px)"
              : "scale(1) translateY(0)"
            : "scale(0.9) translateY(10px)",
        opacity: mounted ? 1 : 0,
        transition: pressed
          ? `transform 200ms ${SPRING}`
          : `all 600ms ${SPRING}`
      }}>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(163,110,20,0.12) 0%, transparent 70%)",
          opacity: hovering && !muted ? 1 : 0,
          transition: `opacity 500ms ${EASE}`
        }}
      />

      <div className="relative">
        <div
          className="flex items-center justify-center rounded-xl mb-2 h-8 w-8"
          style={{
            background: muted ? "rgba(23,19,17,0.04)" : "rgba(163,110,20,0.14)",
            border: muted
              ? "1px solid rgba(23,19,17,0.07)"
              : "1px solid rgba(163,110,20,0.24)",
            boxShadow: muted
              ? "none"
              : "inset 0 1px 0 rgba(255,255,255,0.4)",
            transform: hovering && !muted ? "scale(1.08)" : "scale(1)",
            transition: `transform 500ms ${SPRING}, background 400ms ${EASE}`
          }}>
          <span style={{ color: muted ? "rgba(23,19,17,0.3)" : "#A36E14" }}>
            {icon}
          </span>
        </div>
        <p
          className="font-display font-bold tracking-[-0.01em] leading-none text-[11px]"
          style={{ color: muted ? "rgba(23,19,17,0.35)" : "rgba(23,19,17,0.8)" }}>
          {label}
        </p>
      </div>
    </button>
  )
}

/* ─── SVG icons ─── */
function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
      <path d="M4 14L14 4M14 4H7M14 4V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ReceiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
      <path d="M14 4L4 14M4 14H11M4 14V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}