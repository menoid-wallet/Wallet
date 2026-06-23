/**
 * TxApprovalModal.tsx
 *
 * Transaction signing modal — shown when a dapp calls eth_sendTransaction.
 *
 * Open mode:  signs normally with the user's private key and broadcasts.
 * Noid mode:  builds ExecuteFunctionCall ZK proofs (one per UTXO batch,
 *             0.5 MON relayer fee PER BATCH) + NoidAccountOwnership proof,
 *             then posts to /noidroutes/executefunction and shows the
 *             voyage animation identical to CreateNoidSmartAccountModal.
 *
 * Layout:
 *   form/error (open)  — existing cream card with ship slider + cancel
 *   form/error (noid)  — same structure, dark ink card (noid theme)
 *   in-flight (noid)   — voyage tracker + phase image animation
 *   success (noid)     — success card + Done button
 *
 * The noid "slide ship to execute" slider commits and immediately transitions
 * to the voyage tracker — the user cannot cancel mid-flight.
 */

import React, { useCallback, useEffect, useRef, useState } from "react"
import { ethers } from "ethers"
import { MONAD_RPC_URLS } from "../lib/monadRpc"
import { useWallet } from "../context/WalletContext"
import { saveOpenTx } from "../lib/txStore"
import shipImg      from "../assets/ship/ship.png"

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)"
const EASE   = "cubic-bezier(0.65, 0, 0.35, 1)"

const GOLD_DEEP = "#A36E14"
const INK       = "#171311"
const BONE      = "#FBF1D9"
const CREAM_LOW = "#EAD5A7"

// ─── Network config ───────────────────────────────────────────────────────────
interface TxNetworkConfig {
  label: string
  nativeCurrency: string
  rpcUrl: string
  explorerUrl: string
}
const TX_NETWORK_CONFIGS: Record<string, TxNetworkConfig> = {
  monad: {
    label: "Monad Testnet",
    nativeCurrency: "MON",
    rpcUrl: "https://testnet-rpc.monad.xyz",
    explorerUrl: "https://testnet.monadexplorer.com",
  },
  sepolia: {
    label: "Sepolia",
    nativeCurrency: "ETH",
    rpcUrl: "https://rpc.sepolia.org",
    explorerUrl: "https://sepolia.etherscan.io",
  },
  base_sepolia: {
    label: "Base Sepolia",
    nativeCurrency: "ETH",
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function trunc(s: string, a = 6, b = 4) {
  if (!s) return "—"
  return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s
}

function hexToDecimal(hex: string): string {
  try { return BigInt(hex).toString() } catch { return hex }
}

function formatValue(val: string | undefined): string {
  if (!val || val === "0x0" || val === "0x") return "0 MON"
  try {
    const wei = BigInt(val)
    if (wei === 0n) return "0 MON"
    const mon = Number(wei) / 1e18
    return `${mon.toFixed(mon < 0.001 ? 8 : 6)} MON`
  } catch { return val }
}

function formatGas(gas: string | undefined, gasPrice: string | undefined): string {
  if (!gas) return "—"
  try {
    const gasN = BigInt(gas)
    if (gasPrice) {
      const gp = BigInt(gasPrice)
      const fee = gasN * gp
      const gwei = Number(gp) / 1e9
      const feeEth = Number(fee) / 1e18
      return `${hexToDecimal(gas)} gas · ${gwei.toFixed(2)} Gwei · ~${feeEth.toFixed(8)} MON`
    }
    return `${hexToDecimal(gas)} gas`
  } catch { return gas }
}

function formatData(data: string | undefined): string {
  if (!data || data === "0x" || data === "0x0") return "None"
  if (data.length > 66) return `${data.slice(0, 34)}…${data.slice(-8)} (${Math.floor((data.length - 2) / 2)} bytes)`
  return data
}

const KNOWN_SELECTORS: Record<string, string> = {
  "0xa9059cbb": "transfer(address, uint256)",
  "0x23b872dd": "transferFrom(address, address, uint256)",
  "0x095ea7b3": "approve(address, uint256)",
  "0x40c10f19": "mint(address, uint256)",
  "0xfb37e883": "mintNFT(string)",
  "0x2db11544": "mint(uint256)",
  "0x6352211e": "ownerOf(uint256)",
  "0x42842e0e": "safeTransferFrom(address, address, uint256)",
  "0xe985e9c5": "isApprovedForAll(address, address)",
  "0xa22cb465": "setApprovalForAll(address, bool)",
  "0x1249c58b": "mint()",
  "0x3ccfd60b": "withdraw()",
  "0xd0e30db0": "deposit()",
  "0x2e1a7d4d": "withdraw(uint256)",
  "0x60806040": "constructor()",
  "0x38ed1739": "swapExactTokensForTokens(...)",
  "0x7ff36ab5": "swapExactETHForTokens(...)",
  "0x18cbafe5": "swapExactTokensForETH(...)",
  "0xe8e33700": "addLiquidity(...)",
  "0xf305d719": "addLiquidityETH(...)",
}

function decodeFunctionName(data: string | undefined): string | null {
  if (!data || data.length < 10) return null
  const selector = data.slice(0, 10).toLowerCase()
  return KNOWN_SELECTORS[selector] ?? null
}

// ── ShipSlider ───────────────────────────────────────────────────────────────
function ShipSlider({
  canSubmit,
  disabled,
  onCommit,
}: {
  canSubmit: boolean
  disabled: boolean
  onCommit: () => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const dragStartX = useRef(0)
  const dragStartProgress = useRef(0)
  const committed = useRef(false)
  const [phase, setPhase] = useState<"idle" | "submitting" | "success">("idle")

  const THUMB_W = 52
  const COMMIT_THRESHOLD = 0.88
  const isDisabled = disabled || !canSubmit || phase !== "idle"

  useEffect(() => {
    if (!disabled) {
      committed.current = false
      setProgress(0)
      setDragging(false)
      setPhase("idle")
    }
  }, [disabled])

  function getTrackWidth() { return trackRef.current?.clientWidth ?? 280 }
  function clampP(raw: number) { return Math.max(0, Math.min(1, raw)) }

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (isDisabled || committed.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    dragStartX.current = e.clientX
    dragStartProgress.current = progress
  }, [isDisabled, progress])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || isDisabled || committed.current) return
    const travelW = getTrackWidth() - THUMB_W
    const delta = e.clientX - dragStartX.current
    const newP = clampP(dragStartProgress.current + delta / travelW)
    setProgress(newP)
    if (newP >= COMMIT_THRESHOLD && !committed.current) {
      committed.current = true
      setProgress(1)
      setDragging(false)
      setPhase("submitting")
      onCommit()
    }
  }, [dragging, isDisabled, onCommit])

  const onPointerUp = useCallback(() => {
    if (!dragging) return
    setDragging(false)
    if (!committed.current) setProgress(0)
  }, [dragging])

  const travelW = Math.max(1, (trackRef.current?.clientWidth ?? 280) - THUMB_W)
  const thumbX  = progress * travelW

  const goldBord  = "rgba(163,110,20,0.4)"
  const goldBg    = "rgba(163,110,20,0.06)"
  const textIdle  = "rgba(23,19,17,0.4)"

  let fillColor = "rgba(23,19,17,0.06)"
  let shipFilter = "none"
  if (phase === "submitting")         { fillColor = "rgba(163,110,20,0.22)"; shipFilter = "drop-shadow(0 0 6px rgba(163,110,20,0.5))" }
  else if (phase === "success")       { fillColor = "rgba(5,150,105,0.18)" }
  else if (canSubmit && progress > 0) { fillColor = `rgba(163,110,20,${0.08 + progress * 0.16})` }

  let fillExtra = 0
  let trackLabel = ""
  if (disabled)                    { trackLabel = "Waiting…" }
  else if (phase === "submitting") { trackLabel = "Signing…"; fillExtra = 9999 }
  else if (phase === "success")    { trackLabel = "Sent! ⚓"; fillExtra = 9999 }
  else if (!canSubmit)             { trackLabel = "Loading…" }
  else if (progress > 0.55)       { trackLabel = "Release to sign!" }
  else                             { trackLabel = "Drag ship to sign →" }

  const labelColor = phase === "success"
    ? "rgba(5,150,105,0.8)"
    : phase === "submitting"
      ? "rgba(163,110,20,0.9)"
      : textIdle

  const trackBorder = phase === "success"
    ? "1.5px solid rgba(5,150,105,0.35)"
    : canSubmit && !disabled ? `1.5px solid ${goldBord}` : "1.5px solid rgba(23,19,17,0.1)"

  const trackBg = phase === "success"
    ? "rgba(5,150,105,0.08)"
    : canSubmit && !disabled ? goldBg : "rgba(23,19,17,0.04)"

  return (
    <div ref={trackRef} style={{
      position: "relative", width: "100%", height: 56, borderRadius: 28,
      border: trackBorder, background: trackBg, overflow: "hidden",
      cursor: isDisabled ? "not-allowed" : "default",
      userSelect: "none",
      transition: `border-color 500ms ${EASE}, background 500ms ${EASE}`,
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        background: fillColor,
        width: `${thumbX + fillExtra + 26 + THUMB_W / 2}px`,
        borderRadius: "inherit",
        transition: dragging ? "none" : "width 0.4s cubic-bezier(0.22,1,0.36,1), background 0.4s",
        pointerEvents: "none",
      }} />

      <svg style={{
        position: "absolute", bottom: 0, left: 0, width: "100%", height: 18,
        opacity: phase === "submitting" ? 0.45 : (canSubmit && !disabled) ? 0.15 : 0.06,
        pointerEvents: "none", transition: "opacity 0.5s",
        overflow: "hidden",
      }} viewBox="0 0 280 18" preserveAspectRatio="none">
        <g>
          <path d="M0 12 Q35 4 70 12 Q105 20 140 12 Q175 4 210 12 Q245 20 280 12 L280 18 L0 18 Z" fill="#A36E14" />
          <path d="M280 12 Q315 4 350 12 Q385 20 420 12 Q455 4 490 12 Q525 20 560 12 L560 18 L280 18 Z" fill="#A36E14" />
          {phase === "submitting" && (
            <animateTransform attributeName="transform" type="translate"
              from="0 0" to="-280 0" dur="2.4s" repeatCount="indefinite" />
          )}
        </g>
      </svg>

      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        pointerEvents: "none",
        paddingLeft: (phase === "success" || phase === "submitting") ? 16 : thumbX + THUMB_W + 4,
        paddingRight: 16, transition: "padding-left 0.1s",
      }}>
        <span style={{
          fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase",
          color: labelColor, fontWeight: 600, whiteSpace: "nowrap", transition: "color 0.3s",
        }}>{trackLabel}</span>
      </div>

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: "absolute", top: "50%",
          left: phase === "submitting" ? "50%" : thumbX,
          transform: phase === "submitting" ? "translate(-50%,-50%)" : "translateY(-50%)",
          width: THUMB_W, height: THUMB_W,
          cursor: isDisabled ? "not-allowed" : dragging ? "grabbing" : "grab",
          transition: phase === "submitting"
            ? "left 0.6s cubic-bezier(0.22,1,0.36,1), transform 0.6s cubic-bezier(0.22,1,0.36,1)"
            : dragging ? "none" : "left 0.4s cubic-bezier(0.22,1,0.36,1)",
          filter: shipFilter,
          display: "flex", alignItems: "center", justifyContent: "center",
          touchAction: "none", zIndex: 2,
        }}>
        <img src={shipImg} alt="Drag to sign" draggable={false} style={{
          width: 46, height: 46, objectFit: "contain", pointerEvents: "none",
          opacity: isDisabled && phase === "idle" ? 0.3 : 1, transition: "opacity 0.3s",
          transform: dragging ? "scale(1.07) translateY(-2px)" : "scale(1)",
          animation: phase === "submitting"
            ? "txaShipSail 1.4s ease-in-out infinite"
            : dragging ? "none" : "txaShipFloat 3s ease-in-out infinite",
        }} />
      </div>
    </div>
  )
}

// ── TxRow ─────────────────────────────────────────────────────────────────────
function TxRow({ label, value, mono = false, accent = false }: {
  label: string; value: string; mono?: boolean; accent?: boolean
}) {
  const textColor = accent ? GOLD_DEEP : INK
  const labelColor = "rgba(23,19,17,0.42)"
  const borderColor = "rgba(23,19,17,0.06)"
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      padding: "7px 0", borderBottom: `1px solid ${borderColor}`,
    }}>
      <span style={{
        fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase",
        color: labelColor, flexShrink: 0, marginRight: 12, paddingTop: 1,
      }}>{label}</span>
      <span style={{
        fontSize: mono ? 11 : 12,
        fontFamily: mono ? "monospace" : "inherit",
        color: textColor, fontWeight: accent ? 600 : 400,
        textAlign: "right", wordBreak: "break-all", maxWidth: "65%",
      }}>{value}</span>
    </div>
  )
}

// ── Backdrop ────────────────────────────────────────────────────────────────--
function Backdrop() {
  return (
    <>
      <div className="absolute inset-0" style={{
        backgroundImage: `linear-gradient(160deg, ${BONE} 0%, #F4E7CC 55%, ${CREAM_LOW} 100%)`,
      }} />
      <div className="pointer-events-none absolute" style={{
        top: "-18%", right: "-12%", width: 240, height: 240, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(232,174,58,0.28) 0%, transparent 60%)",
        filter: "blur(42px)", animation: "txaOrb1 12s ease-in-out infinite",
      }} />
      <div className="pointer-events-none absolute" style={{
        bottom: "-15%", left: "-12%", width: 220, height: 220, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(163,110,20,0.16) 0%, transparent 60%)",
        filter: "blur(50px)", animation: "txaOrb2 10s ease-in-out infinite 2s",
      }} />
      <div className="pointer-events-none absolute inset-0 paper-grain" style={{ opacity: 0.18 }} />
    </>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PendingTx {
  host: string
  origin: string
  favicon: string
  tabId: number
  fromAddress: string
  network: string
  txParams: {
    from?: string
    to?: string
    value?: string
    data?: string
    gas?: string
    gasPrice?: string
    maxFeePerGas?: string
    maxPriorityFeePerGas?: string
    nonce?: string
  }
}

interface Props {
  pendingTx: PendingTx
  onDone: () => void
  compact?: boolean
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function TxApprovalModal({ pendingTx, onDone, compact = true }: Props) {
  const { wallets, entries, activeIndex } = useWallet()
  const txNetwork    = pendingTx.network ?? "monad"
  const networkConfig = TX_NETWORK_CONFIGS[txNetwork] ?? TX_NETWORK_CONFIGS.monad

  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { requestAnimationFrame(() => setMounted(true)) }, [])

  const wallet  = wallets[activeIndex]
  const entry   = entries[activeIndex]
  const { txParams } = pendingTx

  const canSubmit = !!wallet && !loading

  async function handleApprove() {
    if (!wallet || !entry) return
    setLoading(true)
    setError(null)
    try {
      const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl)
      const signer = new ethers.Wallet(wallet.normalAccount.privateKey, provider)

      const txReq: ethers.TransactionRequest = {
        to:    txParams.to,
        value: txParams.value ? BigInt(txParams.value) : undefined,
        data:  txParams.data,
        gasLimit: txParams.gas ? BigInt(txParams.gas) : undefined,
        maxFeePerGas:         txParams.maxFeePerGas ? BigInt(txParams.maxFeePerGas) : undefined,
        maxPriorityFeePerGas: txParams.maxPriorityFeePerGas ? BigInt(txParams.maxPriorityFeePerGas) : undefined,
        gasPrice: (!txParams.maxFeePerGas && txParams.gasPrice) ? BigInt(txParams.gasPrice) : undefined,
        nonce: txParams.nonce ? Number(BigInt(txParams.nonce)) : undefined,
      }

      const tx = await signer.sendTransaction(txReq)

      await chrome.runtime.sendMessage({
        type: "MENOID_TX_RESULT",
        txHash: tx.hash,
        tabId: pendingTx.tabId,
      })

      let gasUsed: string | null = null
      try {
        const receipt = await tx.wait()
        if (receipt) gasUsed = receipt.gasUsed.toString()
      } catch {}

      saveOpenTx(entry.openAddress ?? pendingTx.fromAddress, {
        type: "open",
        txHash: tx.hash,
        gasUsed,
        to: txParams.to ?? null,
        value: txParams.value ?? null,
        functionName: decodeFunctionName(txParams.data),
        timestamp: Date.now(),
      })

      setLoading(false)
      onDone()
    } catch (e: any) {
      console.error("[TxApproval] sign error:", e)
      setError(e?.message ?? "Transaction failed")
      setLoading(false)
    }
  }

  async function handleReject() {
    setLoading(true)
    try {
      await chrome.runtime.sendMessage({
        type: "MENOID_TX_REJECT",
        tabId: pendingTx.tabId,
      })
    } catch {}
    setLoading(false)
    onDone()
  }

  const shellClass = compact
    ? "fixed inset-0 z-[100] flex flex-col overflow-hidden font-body"
    : "relative w-full flex flex-col overflow-hidden font-body rounded-[28px]"

  const shellStyle: React.CSSProperties = compact
    ? {
        color: INK,
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(24px)",
        transition: `opacity 350ms ${EASE}, transform 400ms ${SPRING}`,
      }
    : {
        color: INK,
        background: "linear-gradient(165deg, rgba(255,251,240,0.92) 0%, rgba(244,231,204,0.96) 100%)",
        backdropFilter: "blur(28px) saturate(160%)",
        WebkitBackdropFilter: "blur(28px) saturate(160%)",
        maxHeight: "min(780px, 90vh)",
        border: "1px solid rgba(23,19,17,0.08)",
        boxShadow: "0 40px 90px -28px rgba(92,58,33,0.45), inset 0 1px 0 rgba(255,255,255,0.7)",
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0) scale(1)" : "translateY(24px) scale(0.97)",
        transition: `opacity 450ms ${EASE}, transform 550ms ${SPRING}`,
      }

  return (
    <div className={shellClass} style={shellStyle}>
      {compact && <Backdrop />}
      <div className="relative z-10 shrink-0 flex items-center gap-3 px-5 pt-5 pb-4"
        style={{ borderBottom: "1px solid rgba(23,19,17,0.08)" }}>
        {pendingTx.favicon ? (
          <img src={pendingTx.favicon} alt="" className="h-9 w-9 rounded-xl shrink-0 object-contain"
            style={{ border: "1px solid rgba(23,19,17,0.12)" }} />
        ) : (
          <div className="h-9 w-9 flex items-center justify-center rounded-xl shrink-0 text-lg"
            style={{ background: "rgba(163,110,20,0.08)", border: "1px solid rgba(163,110,20,0.18)" }}>⛓</div>
        )}
        <div>
          <p style={{ fontSize: 9, letterSpacing: "0.45em", textTransform: "uppercase", color: "rgba(163,110,20,0.65)", marginBottom: 2 }}>
            Transaction Request
          </p>
          <p style={{ fontFamily: "var(--font-display, serif)", fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", color: INK }}>
            {pendingTx.host}
          </p>
          <p style={{ fontSize: 11, color: "rgba(23,19,17,0.45)" }}>wants to send a transaction</p>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        <div className="px-5 py-4 space-y-3">
          <div style={{
            padding: "12px 14px", borderRadius: 16,
            background: "linear-gradient(145deg, rgba(163,110,20,0.12) 0%, rgba(232,174,58,0.08) 100%)",
            border: "1px solid rgba(163,110,20,0.28)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5), 0 4px 16px rgba(163,110,20,0.1)",
          }}>
            <p style={{ fontSize: 9, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(163,110,20,0.65)", marginBottom: 6 }}>
              Signing account
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 34, height: 34, borderRadius: "50%",
                background: GOLD_DEEP, fontSize: 13, fontWeight: 700, color: BONE, flexShrink: 0,
              }}>
                {(activeIndex ?? 0) + 1}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: INK, marginBottom: 2 }}>
                  {entry?.name ?? "Account"}
                </p>
                <p style={{ fontFamily: "monospace", fontSize: 11, color: GOLD_DEEP }}>
                  {trunc(pendingTx.fromAddress, 10, 8)}
                </p>
              </div>
            </div>
          </div>

          <div style={{
            padding: "12px 14px", borderRadius: 16,
            background: "rgba(23,19,17,0.03)", border: "1px solid rgba(23,19,17,0.08)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
          }}>
            <p style={{ fontSize: 9, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(23,19,17,0.38)", marginBottom: 8 }}>
              Transaction details
            </p>
            {txParams.to && <TxRow label="To" value={trunc(txParams.to, 10, 8)} mono />}
            {decodeFunctionName(txParams.data) && (
              <TxRow label="Function" value={decodeFunctionName(txParams.data)!} accent />
            )}
            <TxRow label="Value" value={formatValue(txParams.value)} accent={!!(txParams.value && txParams.value !== "0x0" && txParams.value !== "0x")} />
            <TxRow label="Network" value={networkConfig.label} />
            {(txParams.gas || txParams.gasPrice || txParams.maxFeePerGas) && (
              <TxRow label="Gas" value={formatGas(txParams.gas, txParams.maxFeePerGas ?? txParams.gasPrice)} mono />
            )}
            {txParams.nonce && <TxRow label="Nonce" value={hexToDecimal(txParams.nonce)} mono />}
            {txParams.data && txParams.data !== "0x" && (
              <TxRow label="Data" value={formatData(txParams.data)} mono />
            )}
          </div>

          {txParams.value && txParams.value !== "0x0" && txParams.value !== "0x" && (
            <div style={{
              padding: "10px 12px", borderRadius: 12,
              background: "rgba(163,110,20,0.08)", border: "1px solid rgba(163,110,20,0.22)",
              display: "flex", alignItems: "flex-start", gap: 8,
            }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
              <p style={{ fontSize: 11, color: GOLD_DEEP, lineHeight: 1.4 }}>
                This transaction will send {formatValue(txParams.value)} from your wallet. Review carefully before signing.
              </p>
            </div>
          )}

        </div>
      </div>

      {/* ── Footer ── */}
      <div className="relative z-10 shrink-0 px-5 pt-3 pb-6"
        style={{ borderTop: "1px solid rgba(23,19,17,0.08)" }}>
        {error && (
          <div style={{
            padding: "10px 12px", borderRadius: 12,
            background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)",
            marginBottom: 12,
          }}>
            <p style={{ fontSize: 11, color: "rgba(248,113,113,0.85)" }}>{error}</p>
          </div>
        )}
        <ShipSlider canSubmit={canSubmit} disabled={loading} onCommit={handleApprove} />
        <button
          onClick={handleReject}
          className="w-full mt-3 py-2 text-[11px] tracking-[0.25em] uppercase font-semibold"
          style={{ color: "rgba(220,50,50,0.72)", background: "none", border: "none", cursor: "pointer" }}>
          Cancel
        </button>
      </div>

      <style>{`
        @keyframes txaNoidOrb1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-22px,15px) scale(1.1)} }
        @keyframes txaNoidOrb2 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(28px,-20px) scale(1.12)} }
        @keyframes txaShipFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes txaShipSail {
          0%{transform:translateY(0) rotate(-6deg) scale(1.05)}
          25%{transform:translateY(-4px) rotate(0deg) scale(1.08)}
          50%{transform:translateY(0) rotate(6deg) scale(1.05)}
          75%{transform:translateY(-4px) rotate(0deg) scale(1.08)}
          100%{transform:translateY(0) rotate(-6deg) scale(1.05)}
        }
        @keyframes txaNoidShipBob {
          0%,100% { transform: translateY(-2px) rotate(-2deg); }
          50%     { transform: translateY(2px) rotate(2deg); }
        }
        @keyframes txaNoidAnchorDrop {
          0%   { transform: translateX(-50%) translateY(-8px); opacity: 0; }
          65%  { transform: translateX(-50%) translateY(2px);  opacity: 1; }
          100% { transform: translateX(-50%) translateY(0px);  opacity: 1; }
        }
        @keyframes txaNoidNightFloat {
          0%, 100% { transform: translateY(0px) rotate(-1deg); }
          50%       { transform: translateY(-8px) rotate(1deg); }
        }
        @keyframes txaNoidImgOutLeft {
          from { transform: translateX(0%);    opacity: 1; }
          to   { transform: translateX(-110%); opacity: 0; }
        }
        @keyframes txaNoidImgInRight {
          from { transform: translateX(110%);  opacity: 0; }
          to   { transform: translateX(0%);    opacity: 1; }
        }
        @keyframes txaNoidFlavorFade {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}