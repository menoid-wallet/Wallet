/**
 * networks.ts
 *
 * Single source of truth for every network the Menoid wallet supports.
 * Add/remove chains here; every other file reads from this module.
 *
 * Env vars (PLASMO_PUBLIC_* are inlined at build time by Plasmo):
 *   PLASMO_PUBLIC_MONAD_POOL_ADDRESS
 *   PLASMO_PUBLIC_SEPOLIA_POOL_ADDRESS
 *   PLASMO_PUBLIC_BASE_SEPOLIA_POOL_ADDRESS
 *   PLASMO_PUBLIC_SOLANA_POOL_STATE_PDA
 *   PLASMO_PUBLIC_SUI_RPC_URL / PLASMO_PUBLIC_SUI_POOL_STATE_ID
 *   PLASMO_PUBLIC_APTOS_POOL_RESOURCE_ADDR
 *
 * The literals below are fallbacks for when a var is missing at build time.
 * Keep them in sync with menoid/deploy.txt — a stale fallback silently points
 * the wallet at an abandoned pool.
 *
 * All six were redeployed 2026-09-25 (on-chain encryption key).
 */

export type NetworkId = "monad" | "sepolia" | "base_sepolia" | "solana" | "sui" | "aptos"

export interface NetworkConfig {
  /** Backend-facing id  (matches :network route param) */
  id: NetworkId
  /** Human-readable display label */
  label: string
  /** EIP-155 chain id (decimal) or placeholder */
  chainId: number
  /** Hex chain id for EIP-1193 eth_chainId */
  chainIdHex: string
  /** net_version string */
  netVersion: string
  /** Ordered list of RPC endpoints; first is preferred */
  rpcUrls: string[]
  /** Block explorer base URL */
  explorerUrl: string
  /** Native token symbol */
  nativeCurrency: string
  /** Pool contract address / Program ID / Pool State object / Pool resource */
  poolAddress: string
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  monad: {
    id: "monad",
    label: "Monad Testnet",
    chainId: 10143,
    chainIdHex: "0x279f",
    netVersion: "10143",
    rpcUrls: [
      // The public endpoint caps at 15 req/sec and answers a rate-limited
      // eth_call with something ethers reports as a revert, so a second live
      // endpoint is what keeps reads (balances, registration checks) honest.
      // rpc.testnet.monad.xyz used to sit here but no longer resolves — a dead
      // entry just burns a fallback attempt.
      "https://testnet-rpc.monad.xyz",
      "https://monad-testnet.drpc.org",
    ],
    explorerUrl: "https://testnet.monadexplorer.com",
    nativeCurrency: "MON",
    poolAddress:
      process.env.PLASMO_PUBLIC_MONAD_POOL_ADDRESS ||
      "0xf859f66DC79a1ea2ABA7832c22c82339E2a0D7c4",
  },

  sepolia: {
    id: "sepolia",
    label: "Sepolia Testnet",
    chainId: 11155111,
    chainIdHex: "0xaa36a7",
    netVersion: "11155111",
    rpcUrls: [
      // rpc.ankr.com/eth_sepolia used to lead here. It answers eth_estimateGas
      // on a contract creation with a bogus "execution reverted" and is flaky
      // on eth_call, which a registration lookup reads as "not registered".
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://1rpc.io/sepolia",
    ],
    explorerUrl: "https://sepolia.etherscan.io",
    nativeCurrency: "ETH",
    poolAddress:
      process.env.PLASMO_PUBLIC_SEPOLIA_POOL_ADDRESS ||
      "0xD184D35c4Fe39ecC2aE86a9E34f0Fb9a40198E02",
  },

  base_sepolia: {
    id: "base_sepolia",
    label: "Base Sepolia",
    chainId: 84532,
    chainIdHex: "0x14a34",
    netVersion: "84532",
    rpcUrls: [
      "https://base-sepolia.g.alchemy.com/v2/2dSafYBk1vcP-Xkk2qSFb",
      "https://base-sepolia-rpc.publicnode.com",
      "https://84532.rpc.thirdweb.com",
    ],
    explorerUrl: "https://sepolia.basescan.org",
    nativeCurrency: "ETH",
    poolAddress:
      process.env.PLASMO_PUBLIC_BASE_SEPOLIA_POOL_ADDRESS ||
      "0x1597b5e8b6876d6b0d5610D74902E0659CDF9bd6",
  },

  solana: {
    id: "solana",
    label: "Solana Devnet",
    chainId: 501,
    chainIdHex: "0x1f5",
    netVersion: "501",
    rpcUrls: [
      "https://api.devnet.solana.com",
    ],
    explorerUrl: "https://explorer.solana.com/?cluster=devnet",
    nativeCurrency: "SOL",
    poolAddress: "3wxDTqw42qqftiAcTZ6kLeNtepuSmB1mR1skrEcwD9SC", // Solana Program ID
  },

  sui: {
    id: "sui",
    label: "Sui Testnet",
    chainId: 784,
    chainIdHex: "0x310",
    netVersion: "784",
    rpcUrls: [
      // suiscan serves NO INDEX STORE — suix_getBalance / suix_getCoins 400
      // there — and fullnode.testnet.sui.io has JSON-RPC switched off entirely.
      // publicnode answers everything the wallet needs.
      process.env.PLASMO_PUBLIC_SUI_RPC_URL || "https://sui-testnet-rpc.publicnode.com",
      "https://sui-testnet-endpoint.blockvision.org",
    ],
    explorerUrl: "https://suiscan.xyz/testnet",
    nativeCurrency: "SUI",
    poolAddress:
      process.env.PLASMO_PUBLIC_SUI_POOL_STATE_ID ||
      "0x65ce5b0d1f57a527979dc92d7e3a7eb44650343ff012e13197087a9b9065eba2", // Pool State Object ID
  },

  aptos: {
    id: "aptos",
    label: "Aptos Testnet",
    chainId: 637,
    chainIdHex: "0x27d",
    netVersion: "637",
    rpcUrls: [
      "https://fullnode.testnet.aptoslabs.com/v1",
    ],
    explorerUrl: "https://explorer.aptoslabs.com/?network=testnet",
    nativeCurrency: "APT",
    poolAddress:
      process.env.PLASMO_PUBLIC_APTOS_POOL_RESOURCE_ADDR ||
      "0x0453fe5b0113fbf868c063bfb8967b5417c3ff90ea12474cf6e179cb363722e3", // Pool Resource Address
  },
}

export const NETWORK_IDS = Object.keys(NETWORKS) as NetworkId[]

export const DEFAULT_NETWORK: NetworkId = "monad"

/** Look up a NetworkConfig by EIP-155 chainId (decimal or hex). */
export function getNetworkByChainId(
  chainId: number | string
): NetworkConfig | null {
  const asNum =
    typeof chainId === "string"
      ? parseInt(chainId, chainId.startsWith("0x") ? 16 : 10)
      : chainId
  return (
    Object.values(NETWORKS).find((n) => n.chainId === asNum) ?? null
  )
}

export function getNetwork(id: NetworkId): NetworkConfig {
  return NETWORKS[id]
}