/**
 * register.ts
 *
 * On-chain wallet registration, and resolving a recipient's private identity.
 *
 * WRITE PATH — the REAL wallet signs a
 * register(userCommitment, encryptionPublicKey) transaction client-side (the
 * on-chain registry is keyed by msg.sender, so it must come from the user's own
 * wallet). The signed transaction is POSTed to the backend, which broadcasts it.
 *
 * READ PATH — asked of the CHAIN, directly, over this extension's own RPC list.
 * Both halves of a receiver's identity live on-chain now:
 *
 *     userCommitment       — locks the note commitment to the receiver
 *     encryptionPublicKey  — encrypts the note so only they can read it
 *
 * The encryption key used to live only in the backend's database, which put a
 * server on the critical path of a privacy decision. When that lookup missed —
 * a cold-starting backend, a stale pool address, a wallet registered on another
 * device — an address that IS registered came back as "not registered", and the
 * send modal ACTS on that by falling back to a public withdraw. Reading the
 * chain removes the whole class of failure: the only thing that can answer
 * "not registered" now is the registry itself.
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
  process.env.PLASMO_PUBLIC_SOLANA_POOL_STATE_PDA || "A4CFTtV8LXLya3bGVV4YdKmXD2KF7qWYSrv3KdyDZZVc"
)

const SUI_RPC = process.env.PLASMO_PUBLIC_SUI_RPC_URL || "https://sui-testnet-rpc.publicnode.com"
const SUI_PACKAGE_ID =
  process.env.PLASMO_PUBLIC_SUI_PACKAGE_ID ||
  "0x9467f20713dc371b452d3def674ee873d50c5850b2eaa944a3856f61dfdbaa60"
const SUI_POOL_STATE_ID =
  process.env.PLASMO_PUBLIC_SUI_POOL_STATE_ID ||
  "0x65ce5b0d1f57a527979dc92d7e3a7eb44650343ff012e13197087a9b9065eba2"

const APTOS_NODE_URL = "https://fullnode.testnet.aptoslabs.com/v1"
const APTOS_MODULE_ADDR =
  process.env.PLASMO_PUBLIC_APTOS_MODULE_ADDR ||
  "0x4f79d41d0085866c731825690954720e4543b71c254030f7c86c56b86f8f8c76"
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
  /** note-encryption public key, in this chain's wallet encoding */
  encryptionPublicKey: string | null
}

/**
 * Thrown when the registry could not be ASKED — as opposed to answering "no".
 *
 * The difference matters more than it looks. A definitive `registered: false`
 * lets the send modal fall back to a public withdraw; an unreachable registry
 * must NOT, because the recipient may well be registered and quietly sending in
 * the clear is the one outcome a privacy wallet must never produce by accident.
 */
export class RegistryUnavailableError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super("Couldn't reach the private registry for this network. Try again in a moment.");
    this.name = "RegistryUnavailableError";
    this.detail = detail;
  }
}

/** How many times a status lookup is retried before the UI hears about it. */
const STATUS_ATTEMPTS = 3

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const NOT_REGISTERED: RegistrationStatus = {
  registered: false,
  userCommitment: null,
  encryptionPublicKey: null
}

/** Hex/byte-array helpers — each chain encodes its key differently. */
const hexToBytes = (hex: string) =>
  Uint8Array.from(Buffer.from(hex.replace(/^0x/, ""), "hex"))

/**
 * One eth_call per EVM chain. `registrationOf` returns (bytes32(0), "0x") for
 * an address that never registered rather than reverting, so a miss and an
 * unreachable node stay distinguishable.
 */
const POOL_REGISTRATION_ABI = [
  "function registrationOf(address) view returns (bytes32 userCommitment, bytes encryptionPublicKey)"
]

async function evmRegistration(
  network: NetworkId,
  address: string
): Promise<RegistrationStatus> {
  const net = NETWORKS[network]
  let lastErr: unknown = null
  // Every endpoint gets a turn before we conclude anything: Monad's public RPC
  // caps at 15 req/sec and answers a rate-limited eth_call with something
  // ethers reports as a revert, which is indistinguishable from a real one.
  for (const url of net.rpcUrls) {
    try {
      const provider = new ethers.JsonRpcProvider(url, {
        name: String(net.chainId),
        chainId: net.chainId
      })
      const pool = new Contract(net.poolAddress, POOL_REGISTRATION_ABI, provider)
      const [uc, encKey]: [string, string] = await pool.registrationOf(address)
      if (!uc || BigInt(uc) === 0n) return NOT_REGISTERED
      return {
        registered: true,
        userCommitment: BigInt(uc).toString(),
        // 65-byte uncompressed secp256k1 key, exactly as the wallet derives it
        encryptionPublicKey: encKey && encKey !== "0x" ? encKey : null
      }
    } catch (e) {
      lastErr = e
    }
  }
  throw new RegistryUnavailableError(String((lastErr as any)?.message ?? lastErr))
}

async function solanaRegistration(address: string): Promise<RegistrationStatus> {
  const connection = new Connection(SOLANA_RPC, "confirmed")
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registration_v2"), new PublicKey(address).toBuffer()],
    SOLANA_PROGRAM_ID
  )
  // The PDA is created BY register() and by nothing else, so a null account is
  // the one shape that means "not registered". Anything else throws.
  const info = await connection.getAccountInfo(pda)
  if (!info) return NOT_REGISTERED

  // Registration = 8 discriminator + 32 wallet + 32 commitment + 32 encKey + 1 bump
  const data = info.data
  if (data.length < 8 + 32 + 32 + 32) {
    throw new RegistryUnavailableError(
      `Solana registration account is ${data.length} bytes, expected >= 104`
    )
  }
  const uc = BigInt("0x" + Buffer.from(data.subarray(40, 72)).toString("hex")).toString()
  const encKey = bs58.encode(Buffer.from(data.subarray(72, 104)))
  return { registered: true, userCommitment: uc, encryptionPublicKey: encKey }
}

async function aptosRegistration(address: string): Promise<RegistrationStatus> {
  const res = await fetch(`${APTOS_NODE_URL}/view`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // registration_of answers (false, 0, 0x) instead of aborting on a miss
      function: `${APTOS_MODULE_ADDR}::pool::registration_of`,
      type_arguments: [],
      arguments: [APTOS_POOL_ADDR, address]
    })
  })
  if (!res.ok) throw new RegistryUnavailableError(`Aptos view: HTTP ${res.status}`)
  const out = await res.json()
  if (!Array.isArray(out)) throw new RegistryUnavailableError("Aptos view returned no tuple")
  const [isRegistered, uc, encKey] = out
  if (isRegistered !== true) return NOT_REGISTERED
  return {
    registered: true,
    userCommitment: BigInt(uc).toString(),
    // 32-byte ed25519 key; the wallet stores it as 0x hex
    encryptionPublicKey: encKey && encKey !== "0x" ? encKey : null
  }
}

async function suiRegistration(address: string): Promise<RegistrationStatus> {
  const call = async (method: string, params: unknown[]) => {
    const res = await fetch(SUI_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    })
    if (!res.ok) throw new RegistryUnavailableError(`Sui RPC HTTP ${res.status}`)
    return res.json()
  }

  const obj = await call("sui_getObject", [SUI_POOL_STATE_ID, { showContent: true }])
  if (obj?.error) throw new RegistryUnavailableError(String(obj.error?.message ?? obj.error))
  const fields = obj?.result?.data?.content?.fields
  const ucTable = fields?.registered?.fields?.id?.id
  const keyTable = fields?.encryption_keys?.fields?.id?.id
  if (!ucTable) throw new RegistryUnavailableError("Sui pool exposes no registered table")

  /** Returns undefined for a genuine miss; throws when the node won't answer. */
  const lookup = async (tableId: string) => {
    const field = await call("suix_getDynamicFieldObject", [
      tableId,
      { type: "address", value: address }
    ])
    const err = field?.error ?? field?.result?.error
    if (err) {
      const code = String((err as any)?.code ?? "")
      // The miss arrives as an error rather than an empty result — and it is
      // the ANSWER: the address simply has no entry in the table.
      if (code === "dynamicFieldNotFound") return undefined
      throw new RegistryUnavailableError(String((err as any)?.message ?? code))
    }
    return field?.result?.data?.content?.fields?.value ?? undefined
  }

  const uc = await lookup(ucTable)
  if (uc === undefined || uc === null) return NOT_REGISTERED

  const keyBytes = keyTable ? await lookup(keyTable) : undefined
  return {
    registered: true,
    userCommitment: BigInt(uc as string).toString(),
    // 32-byte ed25519 key; the wallet stores it base64-encoded
    encryptionPublicKey: Array.isArray(keyBytes)
      ? Buffer.from(Uint8Array.from(keyBytes as number[])).toString("base64")
      : null
  }
}

/** One dispatch point — every caller below reads the chain through this. */
async function registrationFromChain(
  network: NetworkId,
  address: string
): Promise<RegistrationStatus> {
  if (EVM_NETWORKS.has(network)) {
    // EVM addresses are case-insensitive, but ethers throws "bad address
    // checksum" on any mixed-case address that isn't valid EIP-55. Lowercasing
    // (always accepted, and how the address is stored) makes pasted casing work.
    return evmRegistration(network, address.trim().toLowerCase())
  }
  if (network === "solana") return solanaRegistration(address.trim())
  if (network === "aptos") return aptosRegistration(address.trim())
  if (network === "sui") return suiRegistration(address.trim())
  throw new RegistryUnavailableError(`No on-chain registry for ${network}`)
}

/**
 * Registration status for ANY address, read from the chain.
 *
 * Retries before it gives up: testnet RPCs rate-limit (Monad's public endpoint
 * caps at 15 req/sec), so a single failed lookup says nothing about the
 * recipient — it says the registry was busy for a moment. A second attempt
 * usually clears it, and stalling the modal on a blip is its own bug.
 */
export async function fetchRegistrationStatus(
  network: NetworkId,
  address: string
): Promise<RegistrationStatus> {
  let lastDetail = ""
  for (let attempt = 0; attempt < STATUS_ATTEMPTS; attempt++) {
    try {
      return await registrationFromChain(network, address)
    } catch (e: any) {
      lastDetail = e?.detail || e?.message || "registry read failed"
      if (attempt < STATUS_ATTEMPTS - 1) await sleep(400 * 2 ** attempt)
    }
  }
  console.error(`[register] status check failed on ${network}:`, lastDetail)
  throw new RegistryUnavailableError(lastDetail)
}

/**
 * Resolve a receiver's REAL address to the material a sender needs:
 *   - userCommitment      → locks the note commitment to the receiver
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

  const userCommitment = noid.zkPublicKey   // = the user commitment
  const encryptionPublicKey = noid.publicKey // goes on-chain with it

  let body: Record<string, unknown>

  if (EVM_NETWORKS.has(network)) {
    const provider = getProvider(network)
    const signer = new Wallet(base.privateKey, provider)
    const pool = new Contract(NETWORKS[network].poolAddress, PrivatePoolABI, signer)
    const ucBytes32 = ethers.zeroPadValue(ethers.toBeHex(BigInt(userCommitment)), 32)

    const txReq = await pool.register.populateTransaction(
      ucBytes32,
      encryptionPublicKey
    )
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
      [Buffer.from("registration_v2"), userKeypair.publicKey.toBuffer()],
      SOLANA_PROGRAM_ID
    )

    const ix = await program.methods
      .register(
        Array.from(toBE32(userCommitment)),
        Array.from(bs58.decode(encryptionPublicKey))
      )
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
      arguments: [
        tx.object(SUI_POOL_STATE_ID),
        tx.pure.u256(BigInt(userCommitment)),
        tx.pure.vector(
          "u8",
          Array.from(Uint8Array.from(Buffer.from(encryptionPublicKey, "base64")))
        )
      ]
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
        functionArguments: [
          APTOS_POOL_ADDR,
          BigInt(userCommitment),
          Array.from(hexToBytes(encryptionPublicKey))
        ]
      }
    })
    const senderAuthenticator = aptos.transaction.sign({ signer: account, transaction })
    const signedBytes = generateSignedTransaction({ transaction, senderAuthenticator })
    body = { signedTxn: "0x" + Buffer.from(signedBytes).toString("hex") }
  } else {
    throw new Error(`Unknown network ${network}`)
  }

  // The backend only BROADCASTS this transaction — everything a sender needs is
  // inside it and lands on-chain. The address / commitment / key below are just
  // mirrored into its database for support lookups; nothing reads them back on
  // the send path any more.
  const res = await fetch(`${BASE_URL}/register/${network}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      address: base.address,
      userCommitment,
      encryptionPublicKey
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
 * "Is this wallet registered?" — ASKED OF THE CHAIN, not of the backend.
 *
 * Shares the exact reader the send path uses, so the two can never disagree
 * about what "registered" means on a given chain.
 */
export async function isRegisteredOnChain(
  wallet: StoredWallet,
  network: NetworkId
): Promise<boolean> {
  const base = baseFor(wallet, network)
  if (!base) return false
  const status = await registrationFromChain(network, base.address)
  return status.registered
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
  if (await isRegisteredOnChain(wallet, network)) {
    await setChainRegistered(base.address, network, true)
    return true
  }
  return false
}
