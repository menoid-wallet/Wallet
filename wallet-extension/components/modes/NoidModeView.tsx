/**
 * NoidModeView.tsx — Liquid iOS Edition
 *
 * Shadow waters private wallet view, redesigned with liquid iOS language:
 *   - Spring physics on all interactions
 *   - Glass morphism cards with backdrop blur
 *   - Floating gold orbs in treasury card (dark mode)
 *   - Liquid press feedback on every button
 *   - Staggered entrance animations
 *   - Smooth balance transitions
 *
 * Color palette preserved: dark luxury with gold accents.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { loadNoidTxns, loadMaskTxns, loadUnmaskTxns, loadNoidSendTxns, TX_UPDATE_EVENT } from "../../lib/txStore"
import type { TxEntry } from "../../lib/txStore"
import { NETWORKS, type NetworkId } from "../../lib/networks"

const OPEN_BALANCE_POLL_MS = 6_000
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

/* ───────────────────────── Liquid press ───────────────────────── */
function LiquidPress({
  children,
  onClick,
  disabled,
  className = "",
  style = {},
  title
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  title?: string
}) {
  const [pressed, setPressed] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
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
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0.00" />
          </linearGradient>
        </defs>
        {fillD && <path d={fillD} fill="url(#chartGradient)" />}
        {pathD && <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    </div>
  )
}

export default function NoidModeView() {
  const { wallet, entries, activeIndex, activeNetwork, setActiveNetwork } = useWallet()
  const { allBalances, syncing, lastSyncedAt, error: poolError } = usePool()

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

  const [activeCoin, setActiveCoin] = useState<NetworkId | null>(null)
  const [openBalance, setOpenBalance] = useState<string>("0")
  const [showReceive, setShowReceive] = useState(false)
  const [showMask, setShowMask] = useState(false)
  const [showSend, setShowSend] = useState(false)
  const [showUnmask, setShowUnmask] = useState(false)
  const [toast, setToast] = useState<{ show: boolean; msg?: string }>({ show: false })
  const [mounted, setMounted] = useState(false)
  const [txEntries, setTxEntries] = useState<TxEntry[]>([])
  
  const [showCopyDropdown, setShowCopyDropdown] = useState(false)
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({
    evmAddr: false, solanaAddr: false, suiAddr: false, aptosAddr: false,
    evmNoid: false, solanaNoid: false, suiNoid: false, aptosNoid: false
  })

  const evmAddress = wallet?.normalAccount?.address ?? ""
  const solAddress = wallet?.solanaAccount?.address ?? ""
  const suiAddress = wallet?.suiAccount?.address ?? ""
  const aptAddress = wallet?.aptosAccount?.address ?? ""

  const evmNoidKey = wallet?.noidAccount ? `${wallet.noidAccount.publicKey}|${wallet.noidAccount.zkPublicKey ?? ""}` : ""
  const solNoidKey = wallet?.solanaNoidAccount ? `${wallet.solanaNoidAccount.publicKey}|${wallet.solanaNoidAccount.zkPublicKey ?? ""}` : ""
  const suiNoidKey = wallet?.suiNoidAccount ? `${wallet.suiNoidAccount.publicKey}|${wallet.suiNoidAccount.zkPublicKey ?? ""}` : ""
  const aptNoidKey = wallet?.aptosNoidAccount ? `${wallet.aptosNoidAccount.publicKey}|${wallet.aptosNoidAccount.zkPublicKey ?? ""}` : ""

  const dropdownRef = useRef<HTMLDivElement>(null)
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
      const dapp    = loadNoidTxns(noid.publicKey)
      const masks   = loadMaskTxns(noid.publicKey)
      const unmasks = loadUnmaskTxns(noid.publicKey)
      const sends   = loadNoidSendTxns(noid.publicKey)
      const all: TxEntry[] = [...dapp, ...masks, ...unmasks, ...sends]
        .sort((a, b) => b.timestamp - a.timestamp)
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

  const totalUsdBalance = useMemo(() => {
    let total = 0
    total += Number(allBalances.monad || "0") * 1.50
    total += Number(allBalances.sepolia || "0") * 3500.00
    total += Number(allBalances.base_sepolia || "0") * 3500.00
    total += Number(allBalances.solana || "0") * 150.00
    total += Number(allBalances.sui || "0") * 1.50
    total += Number(allBalances.aptos || "0") * 8.00
    return total
  }, [allBalances])

  const formattedTotalUsd = useMemo(() => {
    return totalUsdBalance.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }, [totalUsdBalance])

  function reloadTxEntries() {
    if (!noid?.publicKey) return
    const dapp    = loadNoidTxns(noid.publicKey)
    const masks   = loadMaskTxns(noid.publicKey)
    const unmasks = loadUnmaskTxns(noid.publicKey)
    const sends   = loadNoidSendTxns(noid.publicKey)
    const all: TxEntry[] = [...dapp, ...masks, ...unmasks, ...sends]
      .sort((a, b) => b.timestamp - a.timestamp)
    setTxEntries(all)
  }

  if (!noid) return null

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

  function syncedLabel(): string {
    if (!lastSyncedAt) return "Awaiting sync"
    const sec = Math.max(1, Math.round((Date.now() - lastSyncedAt) / 1000))
    if (sec < 60) return `${sec}s ago`
    return `${Math.round(sec / 60)}m ago`
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

  const activeChain = CHAINS.find(c => c.id === activeCoin)

  function formatAssetBalance(b: string): string {
    const n = Number(b)
    if (!Number.isFinite(n) || n === 0) return "0.00"
    if (n < 0.01) return n.toFixed(4)
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  }

  // Render detail view if a coin is selected
  if (activeCoin && activeChain) {
    const bal = allBalances[activeCoin] || "0"
    const usdVal = Number(bal) * activeChain.price
    const formattedUsd = usdVal.toLocaleString("en-US", { style: "currency", currency: "USD" })
    const formattedBal = formatAssetBalance(bal)
    const points = MOCK_CHARTS[activeCoin] || [1, 1.1, 1.05, 1.2, 1.15, 1.3, 1.25]
    const percentChange = "+3.45%"

    return (
      <div 
        className="px-5 pt-3 pb-8 flex flex-col min-h-full"
        style={{
          animation: `coinPageEntrance 550ms ${SPRING} both`,
          color: "#FAF5E9"
        }}>
        {/* Navigation header */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setActiveCoin(null)}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:scale-105 transition-transform"
            style={{
              background: "rgba(250,245,233,0.06)",
              border: "1px solid rgba(250,245,233,0.1)",
              color: "#FAF5E9"
            }}>
            <svg width="14" height="14" viewBox="0 0 10 10" fill="none">
              <path d="M6.5 8.5L3 5L6.5 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          
          <div className="flex items-center gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{
                background: "rgba(163,110,20,0.15)",
                border: "1px solid rgba(163,110,20,0.25)",
                color: "#DAA21C",
                animation: `coinLogoTransition 500ms ${SPRING} both`
              }}>
              {activeChain.icon}
            </div>
            <div className="text-right flex flex-col justify-center">
              <p className="text-[12px] font-bold text-bone/90 leading-none">{activeChain.name}</p>
              <p className="text-[8px] text-bone/40 font-mono mt-0.5 tracking-wider uppercase leading-none">{activeChain.subtitle}</p>
            </div>
          </div>
        </div>

        {/* Price & Sparkline */}
        <div style={{ animation: `coinFadeIn 550ms ${SPRING} 80ms both` }} className="mt-2 text-center">
          <p className="text-[9px] tracking-[0.4em] uppercase text-bone/40 font-semibold mb-1">Price</p>
          <div className="flex items-baseline justify-center gap-1.5 leading-none">
            <span className="text-[26px] font-display font-bold text-bone/90">
              {activeChain.price.toLocaleString("en-US", { style: "currency", currency: "USD" })}
            </span>
            <span className="text-[10px] font-mono text-emerald-500 font-semibold">{percentChange}</span>
          </div>
          
          {/* Sparkline chart */}
          <SparklineChart points={points} color={activeChain.color} />
        </div>

        {/* Balance Card */}
        <div 
          className="p-4 rounded-3xl mt-2 mb-4 text-center border"
          style={{
            background: "rgba(250,245,233,0.03)",
            borderColor: "rgba(250,245,233,0.06)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            animation: `coinFadeIn 550ms ${SPRING} 160ms both`
          }}>
          <p className="text-[8px] tracking-[0.4em] uppercase text-bone/40 font-semibold mb-1.5">Your Private Balance</p>
          <p className="text-[22px] font-display font-bold text-bone/90">
            {formattedBal} <span className="text-[12px] text-bone/40 font-normal">{activeChain.nativeCurrency}</span>
          </p>
          <p className="text-[11px] text-bone/40 font-mono mt-1">≈ {formattedUsd}</p>
        </div>

        {/* 4 Action Buttons for Noid Mode */}
        <div 
          className="grid grid-cols-4 gap-2 mb-6"
          style={{ animation: `coinFadeIn 550ms ${SPRING} 240ms both` }}>
          <LiquidNoidActionButton
            icon={<span>🎭</span>}
            label="Mask"
            onClick={() => { void refreshOpenBalance(); setShowMask(true) }}
            delay={0}
          />
          <LiquidNoidActionButton
            icon={<span>✨</span>}
            label="Unmask"
            onClick={() => setShowUnmask(true)}
            delay={40}
          />
          <LiquidNoidActionButton
            icon={<SendIcon />}
            label="Send"
            onClick={() => setShowSend(true)}
            delay={80}
          />
          <LiquidNoidActionButton
            icon={<ReceiveIcon />}
            label="Receive"
            onClick={() => setShowReceive(true)}
            delay={120}
          />
        </div>

        {/* Ship's Log */}
        <div 
          className="mt-2 flex-1"
          style={{ animation: `coinFadeIn 550ms ${SPRING} 320ms both` }}>
          <div className="flex items-center gap-2 mb-3">
            <div style={{ height: "1px", flex: 1, background: "linear-gradient(to right, transparent, rgba(251,241,217,0.1), transparent)" }} />
            <p className="text-[8px] tracking-[0.5em] uppercase text-bone/35 shrink-0">Ship's Log</p>
            <div style={{ height: "1px", flex: 1, background: "linear-gradient(to right, transparent, rgba(251,241,217,0.1), transparent)" }} />
          </div>
          
          <ShipsLogEntries entries={txEntries} isNoid={true} />
        </div>

        {/* Modals */}
        <UnMaskModal open={showUnmask} onClose={() => { setShowUnmask(false); void refreshOpenBalance() }} />
        <NoidSendModal open={showSend} onClose={() => setShowSend(false)} />
        <ReceiveModal open={showReceive} onClose={() => setShowReceive(false)} mode="noid" publicKey={noid.publicKey} zkPublicKey={noid.zkPublicKey} />
        <MaskModal open={showMask} onClose={() => { setShowMask(false); void refreshOpenBalance() }} openBalance={openBalance} />
        <ComingSoonToast show={toast.show} onDone={() => setToast({ show: false })} message={toast.msg} />
      </div>
    )
  }

  // Render Noid main dashboard
  return (
    <div className="relative">
      {/* Background grid layer */}
      <div className="pointer-events-none fixed inset-0 -z-10" style={{
        opacity: 0.03,
        backgroundImage: "linear-gradient(to right,#FBF1D9 1px,transparent 1px),linear-gradient(to bottom,#FBF1D9 1px,transparent 1px)",
        backgroundSize: "28px 28px",
      }} />
      <div className="pointer-events-none fixed inset-0 -z-10" style={{
        top: "-18%", right: "-12%", width: 260, height: 260,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(232,174,58,0.14) 0%, transparent 60%)",
        filter: "blur(48px)",
        animation: "noidBgOrb1 14s ease-in-out infinite",
      }} />
      <div className="pointer-events-none fixed inset-0 -z-10" style={{
        bottom: "-15%", left: "-10%", width: 240, height: 240,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(163,110,20,0.12) 0%, transparent 60%)",
        filter: "blur(52px)",
        animation: "noidBgOrb2 11s ease-in-out infinite 3s",
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
            background: "linear-gradient(145deg, #FBF1D9 0%, #F0E0B6 55%, #EAD5A7 100%)",
            boxShadow:
              "0 30px 60px -20px rgba(163,110,20,0.4), 0 8px 24px -8px rgba(232,174,58,0.25), inset 0 1px 0 rgba(255,255,255,0.7)"
          }}>
          {/* Background orbs clipped to container border-radius */}
          <div className="absolute inset-0 rounded-[32px] overflow-hidden pointer-events-none z-0">
            <div
              className="pointer-events-none absolute"
              style={{
                top: "-25%",
                right: "-15%",
                width: 220,
                height: 220,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(232,174,58,0.55) 0%, transparent 60%)",
                filter: "blur(40px)",
                animation: "noidOrb1 12s ease-in-out infinite"
              }}
            />
            <div
              className="pointer-events-none absolute"
              style={{
                bottom: "-30%",
                left: "-20%",
                width: 240,
                height: 240,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(163,110,20,0.35) 0%, transparent 60%)",
                filter: "blur(50px)",
                animation: "noidOrb2 10s ease-in-out infinite 2s"
              }}
            />
            <div
              className="pointer-events-none absolute inset-0 opacity-40"
              style={{
                background:
                  "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)",
                animation: "noidSheen 6s ease-in-out infinite"
              }}
            />
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage:
                  "linear-gradient(to right,#171311 1px,transparent 1px),linear-gradient(to bottom,#171311 1px,transparent 1px)",
                backgroundSize: "28px 28px"
              }}
            />
            <div className="pointer-events-none absolute inset-0 paper-grain opacity-[0.3]" />
          </div>

          <div className="relative z-10 px-5 py-6">
            <div className="mb-4">
              <p className="text-[8px] tracking-[0.5em] uppercase text-ink/35 mb-2 font-bold">
                Hidden Treasure
              </p>
              <div className="flex items-baseline gap-2">
                <div
                  className="font-display font-bold tracking-[-0.03em] leading-none text-[#171311]"
                  style={{
                    textShadow:
                      "0 0 40px rgba(163,110,20,0.25), 0 2px 8px rgba(163,110,20,0.1)"
                  }}>
                  <AnimatedNumber
                    value={formattedTotalUsd}
                    height={40}
                    className="text-[40px]"
                    duration={800}
                  />
                </div>
              </div>
              <p className="mt-1 text-[9px] text-ink/30">
                {poolError ? "Indexer issues - retrying..." : (
                  <>
                    <span>synced private balances</span>
                    {lastSyncedAt && (
                      <>
                        <span className="mx-1 text-ink/15">·</span>
                        <span>{syncedLabel()}</span>
                      </>
                    )}
                  </>
                )}
              </p>
            </div>

            {/* Copy Key Popover Dropdown */}
            <div className="relative inline-block" ref={dropdownRef}>
              <LiquidPress
                onClick={() => setShowCopyDropdown(prev => !prev)}
                onPointerEnter={() => setShowCopyDropdown(true)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[9px] tracking-[0.2em] uppercase"
                style={{
                  background: showCopyDropdown ? "rgba(163,110,20,0.15)" : "rgba(23,19,17,0.05)",
                  border: "1px solid rgba(23,19,17,0.12)",
                  color: "#171311"
                }}>
                <span>Copy Key</span>
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none" className={`transform transition-transform duration-300 ${showCopyDropdown ? "rotate-180" : ""}`}>
                  <path d="M1.5 3.5L5 7L8.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </LiquidPress>

              {showCopyDropdown && (
                <div 
                  onMouseLeave={() => setShowCopyDropdown(false)}
                  className="absolute left-0 mt-2 w-72 rounded-2xl p-3 z-50 text-left border"
                  style={{
                    background: "linear-gradient(145deg, #1E1810 0%, #0D0A07 100%)",
                    borderColor: "rgba(251,241,217,0.12)",
                    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.7)",
                    animation: "liquidFadeIn 300ms cubic-bezier(0.34, 1.56, 0.64, 1) both"
                  }}>
                  
                  {/* Section 1: Noid Keys */}
                  <p className="text-[8px] tracking-[0.3em] uppercase text-[#DAA21C] mb-2 font-semibold">Noid Keys (Private)</p>
                  <div className="space-y-1.5 mb-4">
                    {/* EVM Noid Key */}
                    <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl hover:bg-bone/5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] text-bone/40 uppercase tracking-[0.1em] font-semibold">EVM Noid Key</p>
                        <p className="font-mono text-[9px] text-[#FAF5E9]/80 truncate mt-0.5">{trunc(evmNoidKey, 10, 8)}</p>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(evmNoidKey, "evmNoid")}
                        className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-[#DAA21C]/10 hover:bg-[#DAA21C]/20 transition-colors text-[#DAA21C]">
                        {copiedStates["evmNoid"] ? "✓" : "Copy"}
                      </button>
                    </div>

                    {/* Solana Noid Key */}
                    <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl hover:bg-bone/5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] text-bone/40 uppercase tracking-[0.1em] font-semibold">Solana Noid Key</p>
                        <p className="font-mono text-[9px] text-[#FAF5E9]/80 truncate mt-0.5">{trunc(solNoidKey, 10, 8)}</p>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(solNoidKey, "solanaNoid")}
                        className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-[#DAA21C]/10 hover:bg-[#DAA21C]/20 transition-colors text-[#DAA21C]">
                        {copiedStates["solanaNoid"] ? "✓" : "Copy"}
                      </button>
                    </div>

                    {/* Sui Noid Key */}
                    <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl hover:bg-bone/5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] text-bone/40 uppercase tracking-[0.1em] font-semibold">Sui Noid Key</p>
                        <p className="font-mono text-[9px] text-[#FAF5E9]/80 truncate mt-0.5">{trunc(suiNoidKey, 10, 8)}</p>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(suiNoidKey, "suiNoid")}
                        className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-[#DAA21C]/10 hover:bg-[#DAA21C]/20 transition-colors text-[#DAA21C]">
                        {copiedStates["suiNoid"] ? "✓" : "Copy"}
                      </button>
                    </div>

                    {/* Aptos Noid Key */}
                    <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl hover:bg-bone/5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] text-bone/40 uppercase tracking-[0.1em] font-semibold">Aptos Noid Key</p>
                        <p className="font-mono text-[9px] text-[#FAF5E9]/80 truncate mt-0.5">{trunc(aptNoidKey, 10, 8)}</p>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(aptNoidKey, "aptosNoid")}
                        className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-[#DAA21C]/10 hover:bg-[#DAA21C]/20 transition-colors text-[#DAA21C]">
                        {copiedStates["aptosNoid"] ? "✓" : "Copy"}
                      </button>
                    </div>
                  </div>

                  {/* Section 2: Open Addresses */}
                  <p className="text-[8px] tracking-[0.3em] uppercase text-bone/45 mb-2 font-semibold">Open Addresses</p>
                  <div className="space-y-1.5">
                    {/* EVM Address */}
                    <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl hover:bg-bone/5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] text-bone/40 uppercase tracking-[0.1em] font-semibold">EVM Address</p>
                        <p className="font-mono text-[9px] text-bone/80 truncate mt-0.5">{trunc(evmAddress, 10, 8)}</p>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(evmAddress, "evmAddr")}
                        className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-bone/5 hover:bg-bone/10 transition-colors text-bone/60 hover:text-[#DAA21C]">
                        {copiedStates["evmAddr"] ? "✓" : "Copy"}
                      </button>
                    </div>

                    {/* Solana Address */}
                    <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl hover:bg-bone/5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] text-bone/40 uppercase tracking-[0.1em] font-semibold">Solana Address</p>
                        <p className="font-mono text-[9px] text-bone/80 truncate mt-0.5">{trunc(solAddress, 10, 8)}</p>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(solAddress, "solanaAddr")}
                        className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-bone/5 hover:bg-bone/10 transition-colors text-bone/60 hover:text-[#DAA21C]">
                        {copiedStates["solanaAddr"] ? "✓" : "Copy"}
                      </button>
                    </div>

                    {/* Sui Address */}
                    <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl hover:bg-bone/5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] text-bone/40 uppercase tracking-[0.1em] font-semibold">Sui Address</p>
                        <p className="font-mono text-[9px] text-bone/80 truncate mt-0.5">{trunc(suiAddress, 10, 8)}</p>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(suiAddress, "suiAddr")}
                        className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-bone/5 hover:bg-bone/10 transition-colors text-bone/60 hover:text-[#DAA21C]">
                        {copiedStates["suiAddr"] ? "✓" : "Copy"}
                      </button>
                    </div>

                    {/* Aptos Address */}
                    <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl hover:bg-bone/5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] text-bone/40 uppercase tracking-[0.1em] font-semibold">Aptos Address</p>
                        <p className="font-mono text-[9px] text-bone/80 truncate mt-0.5">{trunc(aptAddress, 10, 8)}</p>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(aptAddress, "aptosAddr")}
                        className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-bone/5 hover:bg-bone/10 transition-colors text-bone/60 hover:text-[#DAA21C]">
                        {copiedStates["aptosAddr"] ? "✓" : "Copy"}
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
          const bal = allBalances[chain.id] || "0"
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
                background: "rgba(250,245,233,0.03)",
                border: "1px solid rgba(250,245,233,0.06)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                animation: `liquidFadeIn 500ms ${SPRING} ${idx * 40}ms both`
              }}>
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{
                    background: "rgba(163,110,20,0.15)",
                    border: "1px solid rgba(163,110,20,0.25)",
                    color: "#DAA21C"
                  }}>
                  {chain.icon}
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-bone/80">{chain.name}</p>
                  <p className="text-[10px] text-bone/40 font-mono mt-0.5">{chain.subtitle}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[13px] font-bold text-bone/80">
                  {formattedBal} <span className="text-[10px] text-bone/40 font-normal">{chain.nativeCurrency}</span>
                </p>
                <p className="text-[10px] text-bone/40 font-mono mt-0.5">≈ {formattedUsd}</p>
              </div>
            </button>
          )
        })}
      </div>

      <style>{`
        @keyframes noidOrb1 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 1; }
          50% { transform: translate(-25px, 20px) scale(1.15); opacity: 0.75; }
        }
        @keyframes noidOrb2 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 1; }
          50% { transform: translate(35px, -25px) scale(1.18); opacity: 0.65; }
        }
        @keyframes noidSheen {
          0%, 100% { transform: translateX(-30%); }
          50% { transform: translateX(30%); }
        }
        @keyframes noidPulseDot {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.4); opacity: 0.6; }
        }
        @keyframes noidBgOrb1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-30px, 25px) scale(1.12); }
        }
        @keyframes noidBgOrb2 {
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

/* ───────────────────────── Liquid Noid Action Button (Detail Coin Page) ───────────────────────── */
function LiquidNoidActionButton({
  icon,
  label,
  onClick,
  delay = 0
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
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
      className="group relative overflow-hidden rounded-2xl text-center w-full"
      style={{
        padding: "10px 6px 9px",
        background: "linear-gradient(145deg, rgba(250,245,233,0.06) 0%, rgba(232,174,58,0.05) 100%)",
        border: hovering
          ? "1px solid rgba(232,174,58,0.4)"
          : "1px solid rgba(232,174,58,0.18)",
        boxShadow: hovering
          ? "inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 24px -6px rgba(232,174,58,0.25)"
          : "inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 8px rgba(232,174,58,0.05)",
        transform: pressed
          ? "scale(0.93)"
          : mounted
            ? hovering
              ? "scale(1.02) translateY(-2px)"
              : "scale(1) translateY(0)"
            : "scale(0.9) translateY(8px)",
        opacity: mounted ? 1 : 0,
        transition: pressed
          ? `transform 180ms ${SPRING}`
          : `all 500ms ${SPRING}`
      }}>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(232,174,58,0.12) 0%, transparent 70%)",
          opacity: hovering ? 1 : 0,
          transition: `opacity 400ms ${EASE}`
        }}
      />
      
      <div className="flex flex-col items-center justify-center">
        <div
          className="flex items-center justify-center rounded-xl mb-1.5 h-8 w-8"
          style={{
            background: "rgba(232,174,58,0.15)",
            border: "1px solid rgba(232,174,58,0.28)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
            color: "#DAA21C"
          }}>
          {icon}
        </div>
        <p className="font-display font-bold tracking-[-0.01em] text-[10px] text-bone/80">
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