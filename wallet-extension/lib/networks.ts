/**
 * networks.ts
 *
 * Single source of truth for every network the Menoid wallet supports.
 * Add/remove chains here; every other file reads from this module.
 *
 * Env vars (PLASMO_PUBLIC_* are inlined at build time by Plasmo):
 *   PLASMO_PUBLIC_MONAD_POOL_ADDRESS
 *   PLASMO_PUBLIC_MONAD_NOID_ACCOUNT_MANAGER_ADDRESS
 *   PLASMO_PUBLIC_SEPOLIA_POOL_ADDRESS
 *   PLASMO_PUBLIC_SEPOLIA_NOID_ACCOUNT_MANAGER_ADDRESS
 *   PLASMO_PUBLIC_BASE_SEPOLIA_POOL_ADDRESS
 *   PLASMO_PUBLIC_BASE_SEPOLIA_NOID_ACCOUNT_MANAGER_ADDRESS
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
  /** Pool contract address / Program ID / Module Address */
  poolAddress: string
  /** NoidAccountManager contract address (unused for Solana/Sui/Aptos) */
  noidAccountManagerAddress: string
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
      "0xCc0857d3526674048235948d0d250F812b938751",
    noidAccountManagerAddress:
      process.env.PLASMO_PUBLIC_MONAD_NOID_ACCOUNT_MANAGER_ADDRESS ||
      "0xD184D35c4Fe39ecC2aE86a9E34f0Fb9a40198E02",
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
      "0x8EE55aC1710D02f9d6a696C053e9c39e47aaE08D",
    noidAccountManagerAddress:
      process.env.PLASMO_PUBLIC_SEPOLIA_NOID_ACCOUNT_MANAGER_ADDRESS ||
      "0x794B3cb8f9186b5B437e659C8ACa8e96bF663078",
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
      "0x8EE55aC1710D02f9d6a696C053e9c39e47aaE08D",
    noidAccountManagerAddress:
      process.env.PLASMO_PUBLIC_BASE_SEPOLIA_NOID_ACCOUNT_MANAGER_ADDRESS ||
      "0x794B3cb8f9186b5B437e659C8ACa8e96bF663078",
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
    noidAccountManagerAddress: "", // Unused
  },

  sui: {
    id: "sui",
    label: "Sui Testnet",
    chainId: 784,
    chainIdHex: "0x310",
    netVersion: "784",
    rpcUrls: [
      "https://fullnode.testnet.sui.io:443",
    ],
    explorerUrl: "https://suiscan.xyz/testnet",
    nativeCurrency: "SUI",
    poolAddress: "0x4b4aecb18020a1bd7f22dfc03f30cb10526fa167d02e40683197c334f9791a33", // Pool State Object ID
    noidAccountManagerAddress: "", // Unused
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
    poolAddress: "0x8f041f33125b093d771c93ea8f311a34b679e18ce7682c4724c62cff8728a08c", // Pool Resource Address
    noidAccountManagerAddress: "", // Unused
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