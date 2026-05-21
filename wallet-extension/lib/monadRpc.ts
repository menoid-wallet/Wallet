/**
 * monadRpc.ts
 *
 * Thin RPC layer for Open Mode:
 *   - getBalance(address)            → MON balance string
 *   - getTxHistory(address)          → recent transactions for an address
 *   - sendNative(privateKey, to, amt) → sign + broadcast a native MON transfer
 *
 * Endpoints are constants here — swap them for whatever live infra you use.
 * Tx history uses the Monad block explorer API; if that's unreachable we
 * fall back to an empty list rather than throwing, so the UI degrades gracefully.
 */

import { ethers } from "ethers"

export const MONAD_RPC_URL = "https://testnet-rpc.monad.xyz"
export const MONAD_EXPLORER_URL = "https://testnet.monadexplorer.com"
export const MONAD_EXPLORER_API = "https://testnet.monadexplorer.com/api"
export const MONAD_CHAIN_ID = 10143

let cachedProvider: ethers.JsonRpcProvider | null = null
export function getProvider(): ethers.JsonRpcProvider {
  if (!cachedProvider) {
    cachedProvider = new ethers.JsonRpcProvider(MONAD_RPC_URL, {
      chainId: MONAD_CHAIN_ID,
      name: "monad-testnet"
    })
  }
  return cachedProvider
}

export async function getBalance(address: string): Promise<string> {
  const provider = getProvider()
  const wei = await provider.getBalance(address)
  return ethers.formatEther(wei)
}

export interface TxHistoryItem {
  hash: string
  from: string
  to: string
  /** raw value in wei (string for safety) */
  value: string
  /** formatted MON */
  valueFormatted: string
  blockNumber: number
  timestamp: number
  /** "in" | "out" | "self" relative to the queried address */
  direction: "in" | "out" | "self"
  status: "success" | "failed" | "pending"
  gasUsed?: string
  gasPriceFormatted?: string
}

interface ExplorerTxApiItem {
  hash: string
  from: string
  to: string
  value: string
  blockNumber: string | number
  timeStamp?: string | number
  timestamp?: string | number
  txreceipt_status?: string
  status?: string
  isError?: string
  gasUsed?: string
  gasPrice?: string
}

/**
 * Fetch tx history for an address via the explorer's etherscan-style API.
 * Returns at most `limit` items, newest first.
 */
export async function getTxHistory(
  address: string,
  limit = 20
): Promise<TxHistoryItem[]> {
  const url = `${MONAD_EXPLORER_API}?module=account&action=txlist&address=${address}&page=1&offset=${limit}&sort=desc`
  try {
    const res = await fetch(url, { method: "GET" })
    if (!res.ok) return []
    const data = await res.json()
    const items: ExplorerTxApiItem[] = Array.isArray(data?.result)
      ? data.result
      : []
    const lower = address.toLowerCase()
    return items.map((t) => {
      const from = (t.from ?? "").toLowerCase()
      const to = (t.to ?? "").toLowerCase()
      const direction: TxHistoryItem["direction"] =
        from === lower && to === lower
          ? "self"
          : from === lower
            ? "out"
            : "in"
      const ts = Number(t.timeStamp ?? t.timestamp ?? 0)
      const block = Number(t.blockNumber ?? 0)
      const statusRaw = String(
        t.txreceipt_status ?? t.status ?? (t.isError === "0" ? "1" : "")
      )
      const status: TxHistoryItem["status"] =
        statusRaw === "1" ? "success" : statusRaw === "0" ? "failed" : "success"
      const wei = BigInt(t.value ?? "0")
      return {
        hash: t.hash,
        from: t.from,
        to: t.to,
        value: wei.toString(),
        valueFormatted: ethers.formatEther(wei),
        blockNumber: block,
        timestamp: ts * 1000,
        direction,
        status,
        gasUsed: t.gasUsed,
        gasPriceFormatted: t.gasPrice
          ? ethers.formatUnits(t.gasPrice, "gwei")
          : undefined
      }
    })
  } catch {
    return []
  }
}

export interface SendResult {
  hash: string
  wait: () => Promise<ethers.TransactionReceipt | null>
}

/**
 * Sign + broadcast a native MON transfer.
 * `amountMon` is a decimal string (e.g. "0.05").
 */
export async function sendNative(
  privateKey: string,
  to: string,
  amountMon: string
): Promise<SendResult> {
  const provider = getProvider()
  const signer = new ethers.Wallet(privateKey, provider)
  const tx = await signer.sendTransaction({
    to,
    value: ethers.parseEther(amountMon)
  })
  return { hash: tx.hash, wait: () => tx.wait() }
}

export function explorerTxUrl(hash: string): string {
  return `${MONAD_EXPLORER_URL}/tx/${hash}`
}

export function explorerAddrUrl(address: string): string {
  return `${MONAD_EXPLORER_URL}/address/${address}`
}