/**
 * monadRpc.ts
 *
 * RPC layer for Open Mode. Focused on the only thing we actually need
 * right now: the native MON balance and sending native MON. Transaction
 * history is intentionally NOT here — the previous explorer-API approach
 * was unreliable, so it's been stripped.
 *
 * Why the multi-endpoint dance:
 *   ethers' default JsonRpcProvider constructor performs an eth_chainId
 *   probe on first use. On some public endpoints that probe hangs or
 *   times out, which is what made the balance silently never appear.
 *   We fix that by:
 *     - constructing with `staticNetwork: Network.from(...)` so ethers
 *       skips the probe entirely;
 *     - keeping a list of candidate endpoints and using whichever one
 *       responded last; if a call fails we fall through to the next.
 *
 * Swap MONAD_RPC_URLS / CHAIN_ID for your live infra. The first entry
 * is tried first, so put your most reliable one at the top.
 */

import {
  ethers,
  Network,
  JsonRpcProvider,
  Wallet,
  formatEther,
} from "ethers"

export const MONAD_CHAIN_ID = 10143
export const MONAD_NETWORK_NAME = "monad-testnet"

export const MONAD_RPC_URLS = [
  "https://testnet-rpc.monad.xyz",
  "https://rpc.testnet.monad.xyz"
]

export const MONAD_EXPLORER_URL = "https://testnet.monadexplorer.com"

const MONAD_NETWORK = Network.from({
  name: MONAD_NETWORK_NAME,
  chainId: MONAD_CHAIN_ID
})

function makeProvider(url: string): ethers.JsonRpcProvider {
  // staticNetwork = MONAD_NETWORK tells ethers "I promise this URL serves
  // this network — do not probe". That's what unblocks calls that were
  // previously hanging on eth_chainId.
  return new JsonRpcProvider(url, MONAD_NETWORK, {
    staticNetwork: MONAD_NETWORK
  })
}

let activeIndex = 0
let cachedProviders: (JsonRpcProvider | null)[] = MONAD_RPC_URLS.map(
  () => null
)

function providerAt(i: number): JsonRpcProvider {
  if (!cachedProviders[i]) {
    cachedProviders[i] = makeProvider(MONAD_RPC_URLS[i])
  }
  return cachedProviders[i]!
}

/** Returns whichever provider last worked. */
export function getProvider(): JsonRpcProvider {
  return providerAt(activeIndex)
}

/**
 * Run `fn` against the current provider, falling through to the next
 * endpoint on failure. Updates `activeIndex` so subsequent calls start
 * from whichever one just succeeded.
 */
async function withFallback<T>(
  fn: (p: JsonRpcProvider) => Promise<T>
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < MONAD_RPC_URLS.length; attempt++) {
    const i = (activeIndex + attempt) % MONAD_RPC_URLS.length
    try {
      const result = await fn(providerAt(i))
      activeIndex = i
      return result
    } catch (e) {
      lastErr = e
      // try the next endpoint
    }
  }
  throw lastErr ?? new Error("All Monad RPC endpoints failed")
}

/** Native MON balance, formatted as a decimal string. */
export async function getBalance(address: string): Promise<string> {
    console.log("get balance called:",address);
  return withFallback(async (p) => {
    const wei = await p.getBalance(address)
    console.log("balance: ",ethers.formatEther(wei));
    return formatEther(wei)
  })
}

export interface SendResult {
  hash: string
  wait: () => Promise<ethers.TransactionReceipt | null>
}

export async function sendNative(
  privateKey: string,
  to: string,
  amountMon: string
): Promise<SendResult> {
  return withFallback(async (p) => {
    const signer = new Wallet(privateKey, p)
    const tx = await signer.sendTransaction({
      to,
      value: ethers.parseEther(amountMon)
    })
    return { hash: tx.hash, wait: () => tx.wait() }
  })
}

export function explorerTxUrl(hash: string): string {
  return `${MONAD_EXPLORER_URL}/tx/${hash}`
}

export function explorerAddrUrl(address: string): string {
  return `${MONAD_EXPLORER_URL}/address/${address}`
}