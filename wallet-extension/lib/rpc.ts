/**
 * rpc.ts  (replaces monadRpc.ts)
 *
 * Multi-network RPC provider layer. Supports Monad Testnet, Sepolia, and
 * Base Sepolia. Every function accepts an optional `network` parameter;
 * it defaults to the currently-active network stored in WalletContext
 * (passed in by callers), falling back to "monad" when unspecified.
 *
 * The staticNetwork trick is preserved: we tell ethers the chainId upfront
 * so it skips the eth_chainId probe that used to cause silent hangs.
 */

import {
  ethers,
  Network,
  JsonRpcProvider,
  Wallet,
  formatEther,
} from "ethers"
import { NETWORKS, type NetworkId, type NetworkConfig } from "./networks"

// ─── Per-network provider cache ───────────────────────────────────────────────

type ProviderCache = { providers: (JsonRpcProvider | null)[]; activeIdx: number }
const _cache: Record<string, ProviderCache> = {}

function cacheFor(net: NetworkConfig): ProviderCache {
  if (!_cache[net.id]) {
    _cache[net.id] = {
      providers: net.rpcUrls.map(() => null),
      activeIdx: 0,
    }
  }
  return _cache[net.id]
}

function makeProvider(url: string, net: NetworkConfig): JsonRpcProvider {
  // Use the numeric chainId as the network name to avoid ethers v6 matching
  // its built-in named networks (e.g. "sepolia" is a known name in ethers and
  // causes it to override our provider config). A plain numeric string is
  // treated as a fully-custom network with no internal registry lookup.
  const ethNetwork = Network.from({ name: String(net.chainId), chainId: net.chainId })
  return new JsonRpcProvider(url, ethNetwork, { staticNetwork: ethNetwork })
}

function providerAt(net: NetworkConfig, i: number): JsonRpcProvider {
  const cache = cacheFor(net)
  if (!cache.providers[i]) {
    cache.providers[i] = makeProvider(net.rpcUrls[i], net)
  }
  return cache.providers[i]!
}

/** Returns whichever provider last worked for the given network. */
export function getProvider(networkId: NetworkId = "monad"): JsonRpcProvider {
  const net = NETWORKS[networkId]
  const cache = cacheFor(net)
  return providerAt(net, cache.activeIdx)
}

async function withFallback<T>(
  networkId: NetworkId,
  fn: (p: JsonRpcProvider) => Promise<T>
): Promise<T> {
  const net = NETWORKS[networkId]
  const cache = cacheFor(net)
  let lastErr: unknown
  for (let attempt = 0; attempt < net.rpcUrls.length; attempt++) {
    const i = (cache.activeIdx + attempt) % net.rpcUrls.length
    try {
      const result = await fn(providerAt(net, i))
      cache.activeIdx = i
      return result
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr ?? new Error(`All RPC endpoints failed for ${networkId}`)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Native balance, formatted as a decimal string. */
export async function getBalance(
  address: string,
  networkId: NetworkId = "monad"
): Promise<string> {
  console.log(`[rpc] getBalance(${address}) on ${networkId}`)
  return withFallback(networkId, async (p) => {
    const wei = await p.getBalance(address)
    return formatEther(wei)
  })
}

export interface SendResult {
  hash: string
  wait: () => Promise<ethers.TransactionReceipt | null>
}

/** Send native currency on the specified network. */
export async function sendNative(
  privateKey: string,
  to: string,
  amount: string,
  networkId: NetworkId = "monad"
): Promise<SendResult> {
  return withFallback(networkId, async (p) => {
    const signer = new Wallet(privateKey, p)
    const tx = await signer.sendTransaction({
      to,
      value: ethers.parseEther(amount),
    })
    return { hash: tx.hash, wait: () => tx.wait() }
  })
}

export function explorerTxUrl(hash: string, networkId: NetworkId = "monad"): string {
  return `${NETWORKS[networkId].explorerUrl}/tx/${hash}`
}

export function explorerAddrUrl(address: string, networkId: NetworkId = "monad"): string {
  return `${NETWORKS[networkId].explorerUrl}/address/${address}`
}

// ─── Backward-compat re-exports (for callers that still import from monadRpc) ─

/** @deprecated Import from rpc.ts and pass a networkId instead. */
export const MONAD_CHAIN_ID = NETWORKS.monad.chainId
/** @deprecated */
export const MONAD_NETWORK_NAME = "monad-testnet"
/** @deprecated */
export const MONAD_RPC_URLS = NETWORKS.monad.rpcUrls
/** @deprecated */
export const MONAD_EXPLORER_URL = NETWORKS.monad.explorerUrl