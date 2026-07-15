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
      "https://testnet-rpc.monad.xyz",
      "https://rpc.testnet.monad.xyz",
    ],
    explorerUrl: "https://testnet.monadexplorer.com",
    nativeCurrency: "MON",
    poolAddress:
      process.env.PLASMO_PUBLIC_MONAD_POOL_ADDRESS ||
      "0x4327bD4A8DA693517766699e21109BF21764CB53",
  },

  sepolia: {
    id: "sepolia",
    label: "Sepolia Testnet",
    chainId: 11155111,
    chainIdHex: "0xaa36a7",
    netVersion: "11155111",
    rpcUrls: [
      "https://rpc.ankr.com/eth_sepolia/8b642f4bc0d625b1f27b9d4c6cd0be2213a8c65e203716ac8efac35adc510b7b",
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://1rpc.io/sepolia",
    ],
    explorerUrl: "https://sepolia.etherscan.io",
    nativeCurrency: "ETH",
    poolAddress:
      process.env.PLASMO_PUBLIC_SEPOLIA_POOL_ADDRESS ||
      "0xEf758FB0606AaB7fbAf96F4772883B970e8436AE",
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
      "0x768bE43037Be62Ca081F7ccBecf49795CF25CE43",
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
      process.env.PLASMO_PUBLIC_SUI_RPC_URL || "https://rpc-testnet.suiscan.xyz:443",
    ],
    explorerUrl: "https://suiscan.xyz/testnet",
    nativeCurrency: "SUI",
    poolAddress:
      process.env.PLASMO_PUBLIC_SUI_POOL_STATE_ID ||
      "0xcd8f1c778c0cc807f98e5aaf15b7fcd9911d8f2ba3e14126c4f6cb7f33d67d1c", // Pool State Object ID
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
      "0x073bc5497e54f4cd2bbe1211e4de5ab61e9717ebfcbbd714f22e58306be38489", // Pool Resource Address
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