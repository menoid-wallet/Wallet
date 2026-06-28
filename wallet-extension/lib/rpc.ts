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
  if (networkId === "solana") {
    const { Connection, PublicKey: SolPublicKey } = await import("@solana/web3.js")
    const connection = new Connection(NETWORKS.solana.rpcUrls[0], "confirmed")
    const pubkey = new SolPublicKey(address)
    const lamports = await connection.getBalance(pubkey)
    return (lamports / 1e9).toString()
  }
  if (networkId === "sui") {
    const res = await fetch(NETWORKS.sui.rpcUrls[0], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "suix_getBalance",
        params: [address],
      }),
    })
    const json = await res.json()
    if (json.error) throw new Error(json.error.message)
    const totalBalance = BigInt(json.result?.totalBalance ?? "0")
    return (Number(totalBalance) / 1e9).toString()
  }
  if (networkId === "aptos") {
    try {
      // Use the `coin::balance` view function instead of reading the
      // 0x1::coin::CoinStore resource directly. APT migrated to the Fungible
      // Asset standard, so newer accounts hold no CoinStore resource (the old
      // URL also 400'd because of the unescaped `<`/`>`). The view function is
      // FA-aware and returns the balance for both legacy and FA accounts.
      const res = await fetch(`${NETWORKS.aptos.rpcUrls[0]}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          function: "0x1::coin::balance",
          type_arguments: ["0x1::aptos_coin::AptosCoin"],
          arguments: [address],
        }),
      })
      if (!res.ok) {
        console.error("Aptos balance fetch failed:", res.status, await res.text())
        return "0.0"
      }
      // The view endpoint returns a JSON array, e.g. ["1000000000"] (octas).
      const json = await res.json()
      const octas = BigInt(Array.isArray(json) ? (json[0] ?? "0") : "0")
      return (Number(octas) / 1e8).toString()
    } catch (e) {
      console.error("Aptos balance fetch failed:", e)
      return "0.0"
    }
  }

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
  if (networkId === "solana") {
    const { Connection, PublicKey: SolPublicKey, Transaction, SystemProgram, Keypair } = await import("@solana/web3.js")
    const bs58 = (await import("bs58")).default
    const connection = new Connection(NETWORKS.solana.rpcUrls[0], "confirmed")
    let decoded: Uint8Array
    try {
      decoded = bs58.decode(privateKey.trim())
    } catch {
      const clean = privateKey.replace(/^0x/, "").trim()
      decoded = Uint8Array.from(Buffer.from(clean, "hex"))
    }
    const fromKeypair = decoded.length === 64
      ? Keypair.fromSecretKey(decoded)
      : Keypair.fromSeed(decoded)
    const toPubkey = new SolPublicKey(to.trim())
    const lamports = BigInt(Math.round(Number(amount) * 1e9))

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey: toPubkey,
        lamports: lamports,
      })
    )

    const hash = await connection.sendTransaction(transaction, [fromKeypair])
    return {
      hash,
      wait: async () => {
        await connection.confirmTransaction(hash, "confirmed")
        return null
      }
    }
  }

  if (networkId === "sui") {
    const { SuiJsonRpcClient: SuiClient } = await import("@mysten/sui/jsonRpc")
    const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519")
    const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography")
    const { fromBase64 } = await import("@mysten/sui/utils")
    const { Transaction } = await import("@mysten/sui/transactions")

    const client = new SuiClient({ url: NETWORKS.sui.rpcUrls[0], network: "testnet" })

    const trimmed = privateKey.trim()
    let keypair: any
    if (trimmed.startsWith("suiprivkey")) {
      const { secretKey } = decodeSuiPrivateKey(trimmed)
      keypair = Ed25519Keypair.fromSecretKey(secretKey)
    } else {
      let bytes: Uint8Array
      try {
        bytes = fromBase64(trimmed)
      } catch {
        bytes = Uint8Array.from(Buffer.from(trimmed.replace(/^0x/, ""), "hex"))
      }
      keypair = Ed25519Keypair.fromSecretKey(bytes)
    }

    const tx = new Transaction()
    const amountMist = Math.round(Number(amount) * 1e9)
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)])
    tx.transferObjects([coin], tx.pure.address(to.trim()))

    const res = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    })

    return {
      hash: res.digest,
      wait: async () => {
        await client.waitForTransaction({ digest: res.digest })
        return null
      }
    }
  }

  if (networkId === "aptos") {
    const { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } = await import("@aptos-labs/ts-sdk")
    const config = new AptosConfig({ network: Network.TESTNET })
    const aptos = new Aptos(config)
    const cleanPk = privateKey.trim().replace(/^0x/, "")
    const pk = new Ed25519PrivateKey(cleanPk)
    const senderAccount = Account.fromPrivateKey({ privateKey: pk })

    const transaction = await aptos.transaction.build.simple({
      sender: senderAccount.accountAddress,
      data: {
        function: "0x1::aptos_account::transfer",
        functionArguments: [to.trim(), Math.round(Number(amount) * 1e8)],
      },
    })

    const senderAuthenticator = aptos.transaction.sign({
      signer: senderAccount,
      transaction,
    })

    const pendingTx = await aptos.transaction.submit.simple({
      transaction,
      senderAuthenticator,
    })

    return {
      hash: pendingTx.hash,
      wait: async () => {
        await aptos.transaction.waitForTransaction({ transactionHash: pendingTx.hash })
        return null
      }
    }
  }

  return withFallback(networkId, async (p) => {
    const signer = new Wallet(privateKey, p)
    const tx = await signer.sendTransaction({
      to,
      value: ethers.parseEther(amount),
    })
    return { hash: tx.hash, wait: () => tx.wait() }
  })
}

/**
 * Per-chain block-explorer transaction URL.
 *
 * EVM chains (monad / sepolia / base_sepolia) use the plain `${base}/tx/${hash}`
 * form. Solana and Aptos carry their cluster/network as a query string, so the
 * path segment must come BEFORE the `?...` — naive concatenation would produce
 * `.../?cluster=devnet/tx/<hash>` which 404s. Sui (Suiscan) is path-based.
 */
export function explorerTxUrl(hash: string, networkId: NetworkId = "monad"): string {
  switch (networkId) {
    case "solana":
      return `https://explorer.solana.com/tx/${hash}?cluster=devnet`
    case "aptos":
      return `https://explorer.aptoslabs.com/txn/${hash}?network=testnet`
    case "sui":
      return `https://suiscan.xyz/testnet/tx/${hash}`
    default:
      return `${NETWORKS[networkId].explorerUrl}/tx/${hash}`
  }
}

export function explorerAddrUrl(address: string, networkId: NetworkId = "monad"): string {
  switch (networkId) {
    case "solana":
      return `https://explorer.solana.com/address/${address}?cluster=devnet`
    case "aptos":
      return `https://explorer.aptoslabs.com/account/${address}?network=testnet`
    case "sui":
      return `https://suiscan.xyz/testnet/account/${address}`
    default:
      return `${NETWORKS[networkId].explorerUrl}/address/${address}`
  }
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