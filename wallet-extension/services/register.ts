/**
 * register.ts
 *
 * On-chain wallet registration, relayed through the backend.
 *
 * The REAL wallet signs a register(userCommitment) transaction client-side
 * (the on-chain registered map is keyed by msg.sender, so it must come from the
 * user's own wallet). The signed transaction is POSTed to the backend, which
 * broadcasts it — the extension never needs its own RPC/indexer.
 *
 * userCommitment for a chain = the wallet's noidAccount.zkPublicKey (which, in
 * the register architecture, IS the user commitment).
 */

import { ethers, Wallet, Contract } from "ethers"
import { Connection, PublicKey, Keypair, SystemProgram, Transaction } from "@solana/web3.js"
import { Program, AnchorProvider } from "@coral-xyz/anchor"
import bs58 from "bs58"
import { SuiJsonRpcClient as SuiClient } from "@mysten/sui/jsonRpc"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography"
import { Transaction as SuiTransaction } from "@mysten/sui/transactions"
import { toBase64 } from "@mysten/bcs"
import {
  Aptos,
  AptosConfig,
  Network,
  Account,
  Ed25519PrivateKey,
  generateSignedTransaction
} from "@aptos-labs/ts-sdk"
import solanaIdl from "../abis/noid_solana.json"
import PrivatePoolABI from "../abis/NoidPool.json"
import { getProvider } from "../lib/rpc"
import { NETWORKS, type NetworkId } from "../lib/networks"
import { BASE_URL } from "./api"
import { setChainRegistered } from "../lib/registration"
import type { StoredWallet } from "../crypto/walletCrypto"

// ─── Config from env (new deployments) ──────────────────────────────────────────

const SOLANA_RPC = "https://api.devnet.solana.com"
const SOLANA_PROGRAM_ID = new PublicKey(
  process.env.PLASMO_PUBLIC_SOLANA_PROGRAM_ID || "3wxDTqw42qqftiAcTZ6kLeNtepuSmB1mR1skrEcwD9SC"
)
const SOLANA_POOL_STATE_PDA = new PublicKey(
  process.env.PLASMO_PUBLIC_SOLANA_POOL_STATE_PDA || "285h75BTpGyFUCPoyFucNZKVfPYVv8msDEaEceTTETZj"
)

const SUI_RPC = process.env.PLASMO_PUBLIC_SUI_RPC_URL || "https://rpc-testnet.suiscan.xyz:443"
const SUI_PACKAGE_ID =
  process.env.PLASMO_PUBLIC_SUI_PACKAGE_ID ||
  "0x198edf8b1081a2ddccd0fa681b39d564493a774bfdd2218af2b05aabd52d0a4d"
const SUI_POOL_STATE_ID =
  process.env.PLASMO_PUBLIC_SUI_POOL_STATE_ID ||
  "0xcd8f1c778c0cc807f98e5aaf15b7fcd9911d8f2ba3e14126c4f6cb7f33d67d1c"

const APTOS_NODE_URL = "https://fullnode.testnet.aptoslabs.com/v1"
const APTOS_MODULE_ADDR =
  process.env.PLASMO_PUBLIC_APTOS_MODULE_ADDR ||
  "0xcaf04754afdea6523026a6bc9de0199f5665f4399e471ef84ae4456de01f546c"
const APTOS_POOL_ADDR =
  process.env.PLASMO_PUBLIC_APTOS_POOL_ADDR ||
  "0xb50ddea69fa72666f7fc54ad9e1814a66e47ea61288131b0991e17a2ef08dabb"

const EVM_NETWORKS = new Set<NetworkId>(["monad", "sepolia", "base_sepolia"])

function toBE32(valStr: string): Uint8Array {
  let temp = BigInt(valStr)
  const buf = new Uint8Array(32)
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(temp & 0xffn)
    temp >>= 8n
  }
  return buf
}

/** Resolve the noid account (holds the user commitment) for a network. */
function noidFor(wallet: StoredWallet, network: NetworkId) {
  if (network === "solana") return wallet.solanaNoidAccount
  if (network === "sui") return wallet.suiNoidAccount
  if (network === "aptos") return wallet.aptosNoidAccount
  return wallet.noidAccount
}

/** Resolve the base (real) account for a network. */
function baseFor(wallet: StoredWallet, network: NetworkId) {
  if (network === "solana") return wallet.solanaAccount
  if (network === "sui") return wallet.suiAccount
  if (network === "aptos") return wallet.aptosAccount
  return wallet.normalAccount
}

// ─── On-chain status ────────────────────────────────────────────────────────────

export interface RegistrationStatus {
  registered: boolean
  userCommitment: string | null
  /** off-chain-stored encryption public key (needed to encrypt a note). */
  encryptionPublicKey: string | null
}

export async function fetchRegistrationStatus(
  network: NetworkId,
  address: string
): Promise<RegistrationStatus> {
  // EVM addresses are case-insensitive, but the backend's on-chain check runs
  // them through ethers, which throws "bad address checksum" on any mixed-case
  // address that isn't valid EIP-55. Lowercasing (which ethers always accepts,
  // and which is how the address is stored) makes any pasted casing resolve.
  const addr = EVM_NETWORKS.has(network) ? address.trim().toLowerCase() : address.trim()
  const res = await fetch(`${BASE_URL}/register/${network}/status/${addr}`)
  const data = await res.json()
  if (!res.ok || !data.success) {
    throw new Error(data.message || `Failed to check registration on ${network}`)
  }
  return {
    registered: !!data.registered,
    userCommitment: data.userCommitment ?? null,
    encryptionPublicKey: data.encryptionPublicKey ?? null
  }
}

/**
 * Resolve a receiver's REAL address to the material a sender needs:
 *   - userCommitment    → locks the note commitment to the receiver
 *   - encryptionPublicKey → encrypts the note so only the receiver can read it
 *
 * Returns registered=false when the address has not registered for private mode.
 */
export interface ResolvedRecipient {
  registered: boolean
  userCommitment: string | null
  encryptionPublicKey: string | null
}

export async function resolveRecipient(
  network: NetworkId,
  address: string
): Promise<ResolvedRecipient> {
  const status = await fetchRegistrationStatus(network, address)
  return {
    registered: status.registered,
    userCommitment: status.userCommitment,
    encryptionPublicKey: status.encryptionPublicKey
  }
}

// ─── Register (build + sign client-side, relay via backend) ──────────────────────

export async function registerOnChain(
  wallet: StoredWallet,
  network: NetworkId
): Promise<{ txHash: string }> {
  const noid = noidFor(wallet, network)
  const base = baseFor(wallet, network)
  if (!noid || !base) throw new Error(`No ${network} account in this wallet`)

  const userCommitment = noid.zkPublicKey // = the user commitment

  let body: Record<string, unknown>

  if (EVM_NETWORKS.has(network)) {
    const provider = getProvider(network)
    const signer = new Wallet(base.privateKey, provider)
    const pool = new Contract(NETWORKS[network].poolAddress, PrivatePoolABI, signer)
    const ucBytes32 = ethers.zeroPadValue(ethers.toBeHex(BigInt(userCommitment)), 32)

    const txReq = await pool.register.populateTransaction(ucBytes32)
    const populated = await signer.populateTransaction(txReq)
    const signedTx = await signer.signTransaction(populated)
    body = { signedTx }
  } else if (network === "solana") {
    const connection = new Connection(SOLANA_RPC, "confirmed")
    const userKeypair = Keypair.fromSecretKey(bs58.decode(base.privateKey))
    const provider = new AnchorProvider(connection, { publicKey: userKeypair.publicKey } as any, {
      commitment: "confirmed"
    })
    const program = new Program(solanaIdl as any, provider) as any

    const [registrationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registration"), userKeypair.publicKey.toBuffer()],
      SOLANA_PROGRAM_ID
    )

    const ix = await program.methods
      .register(Array.from(toBE32(userCommitment)))
      .accounts({
        user: userKeypair.publicKey,
        registration: registrationPda,
        systemProgram: SystemProgram.programId
      })
      .instruction()

    const tx = new Transaction().add(ix)
    tx.feePayer = userKeypair.publicKey
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
    tx.sign(userKeypair)
    body = { serializedTx: Buffer.from(tx.serialize()).toString("hex") }
  } else if (network === "sui") {
    const client = new SuiClient({ url: SUI_RPC, network: "testnet" })
    const seed = base.privateKey.startsWith("suiprivkey")
      ? decodeSuiPrivateKey(base.privateKey).secretKey
      : Uint8Array.from(Buffer.from(base.privateKey, "base64"))
    const keypair = Ed25519Keypair.fromSecretKey(seed)

    const tx = new SuiTransaction()
    tx.moveCall({
      target: `${SUI_PACKAGE_ID}::pool::register`,
      arguments: [tx.object(SUI_POOL_STATE_ID), tx.pure.u256(BigInt(userCommitment))]
    })
    tx.setSender(keypair.getPublicKey().toSuiAddress())
    const txBytes = await tx.build({ client })
    const { signature } = await keypair.signTransaction(txBytes)
    body = { txBytes: toBase64(txBytes), signature }
  } else if (network === "aptos") {
    const aptos = new Aptos(
      new AptosConfig({ network: Network.TESTNET, fullnode: APTOS_NODE_URL })
    )
    const account = Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(base.privateKey.replace(/^0x/, ""))
    })
    const transaction = await aptos.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function: `${APTOS_MODULE_ADDR}::pool::register` as `${string}::${string}::${string}`,
        typeArguments: [],
        functionArguments: [APTOS_POOL_ADDR, BigInt(userCommitment)]
      }
    })
    const senderAuthenticator = aptos.transaction.sign({ signer: account, transaction })
    const signedBytes = generateSignedTransaction({ transaction, senderAuthenticator })
    body = { signedTxn: "0x" + Buffer.from(signedBytes).toString("hex") }
  } else {
    throw new Error(`Unknown network ${network}`)
  }

  // Include the real address, user commitment, and encryption public key so the
  // backend can store the encryption key off-chain (a sender needs it to encrypt
  // a note to this wallet, and it can't be recovered from the on-chain commitment).
  const res = await fetch(`${BASE_URL}/register/${network}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      address: base.address,
      userCommitment,
      encryptionPublicKey: noid.publicKey
    })
  })
  const data = await res.json()
  if (!res.ok || !data.success) {
    throw new Error(data.message || `Registration failed on ${network}`)
  }

  await setChainRegistered(base.address, network, true)
  return { txHash: data.txHash }
}

/**
 * "Already registered?" repair: verify on-chain and, if registered, mark the
 * local cache so the chain drops out of the register selector.
 */
export async function verifyAndRepair(
  wallet: StoredWallet,
  network: NetworkId
): Promise<boolean> {
  const base = baseFor(wallet, network)
  if (!base) return false
  const status = await fetchRegistrationStatus(network, base.address)
  if (status.registered) {
    await setChainRegistered(base.address, network, true)
    return true
  }
  return false
}
