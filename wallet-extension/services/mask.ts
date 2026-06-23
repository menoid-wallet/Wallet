/**
 * mask.ts
 *
 * "Mask" = deposit into the ZK pool. Now network-aware.
 *
 * The caller passes the active `networkId` (from WalletContext), which is
 * used to:
 *   - Resolve the correct pool contract address.
 *   - Connect to the right RPC provider.
 */

import * as snarkjs from "snarkjs"
import { ethers, Wallet, Contract } from "ethers"
import { createCommitment } from "../crypto/commitment"
import { encryptMessage } from "../lib/crypto"
import { getProvider } from "../lib/rpc"
import { NETWORKS, type NetworkId } from "../lib/networks"
import PrivatePoolABI from "../abis/NoidPool.json"
import { BASE_URL, type RelayerKeys } from "./api"

// ── ZK asset URL helper ──────────────────────────────────────────────────────

export function zkAssetUrl(name: string): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(`assets/zk/${name}`)
  }
  return `/assets/zk/${name}`
}

/** Resolve pool contract address for the given network. */
export function poolAddress(networkId: NetworkId = "monad"): string {
  const addr = NETWORKS[networkId]?.poolAddress
  if (!addr) throw new Error(`Pool address not configured for network: ${networkId}`)
  return addr
}

// ── random 31-byte field element ────────────────────────────────────────────

function randomFieldElement(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(31))
  let hex = "0x"
  for (const b of bytes) hex += b.toString(16).padStart(2, "0")
  return BigInt(hex).toString()
}

// ── inputs / outputs ─────────────────────────────────────────────────────────

export interface ExecuteMaskArgs {
  /** decimal native currency, e.g. "1.5" */
  depositAmountMon: string
  /** decimal fee, e.g. "0.5" */
  feeMon: string
  normalPrivateKey: string
  noidPublicKey: string
  noidZkPublicKey: string
  relayerKeys: RelayerKeys
  /** Active network — determines which pool contract is used */
  networkId?: NetworkId
  onProofStart?: () => void
  onSendTx?: (hash: string) => void
}

export interface ExecuteMaskResult {
  hash: string
  receipt: ethers.TransactionReceipt | null
  commitments: { c1: string; c2: string }
}

// ── main ─────────────────────────────────────────────────────────────────────

export async function executeMask({
  depositAmountMon,
  feeMon,
  normalPrivateKey,
  noidPublicKey,
  noidZkPublicKey,
  relayerKeys,
  networkId = "monad",
  onProofStart,
  onSendTx,
}: ExecuteMaskArgs): Promise<ExecuteMaskResult> {
  const depositWei = ethers.parseEther(depositAmountMon)
  const feeWei     = ethers.parseEther(feeMon)
  const userWei    = depositWei - feeWei
  if (userWei <= 0n) throw new Error("Fee must be less than deposit amount")

  const r1 = randomFieldElement()
  const r2 = randomFieldElement()

  const c1 = await createCommitment(userWei.toString(), r1, noidZkPublicKey)
  const c2 = await createCommitment(feeWei.toString(), r2, relayerKeys.zkPublicKey)

  const encryptedNote1 = encryptMessage(
    JSON.stringify({ amount: userWei.toString(), randomness: r1 }),
    noidPublicKey,
    networkId
  )
  const encryptedNote2 = encryptMessage(
    JSON.stringify({ amount: feeWei.toString(), randomness: r2 }),
    relayerKeys.publicKey,
    networkId
  )

  const input = {
    depositAmount: depositWei.toString(),
    c1: c1.decimal,
    c2: c2.decimal,
    a1: userWei.toString(),
    r1,
    pk1: noidZkPublicKey,
    a2: feeWei.toString(),
    r2,
    pk2: relayerKeys.zkPublicKey,
  }

  onProofStart?.()

  const wasmPath = zkAssetUrl("deposit_proof.wasm")
  const zkeyPath = zkAssetUrl("deposit_proof_final.zkey")

  try {
    const probe = await fetch(wasmPath, { method: "HEAD" })
    if (!probe.ok) {
      throw new Error(
        `ZK artifact not reachable at ${wasmPath} (HTTP ${probe.status}). ` +
          `Make sure assets/zk/deposit_proof.wasm is listed in manifest.web_accessible_resources.`
      )
    }
  } catch (e: any) {
    if (e?.message?.startsWith("ZK artifact")) throw e
    throw new Error(`Can't reach ZK artifact at ${wasmPath}. Check assets/zk/deposit_proof.wasm and your manifest.`)
  }

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath)

  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)
  const argv = calldata.replace(/["[\]\s]/g, "").split(",")
  const a: [string, string]             = [argv[0], argv[1]]
  const b: [[string, string], [string, string]] = [[argv[2], argv[3]], [argv[4], argv[5]]]
  const c: [string, string]             = [argv[6], argv[7]]

  const provider = getProvider(networkId)
  const signer   = new Wallet(normalPrivateKey, provider)
  const contract = new Contract(poolAddress(networkId), PrivatePoolABI, signer)

  // Build + sign the deposit transaction locally (the user pays gas + value),
  // then hand the raw signed tx to the relayer, which broadcasts it and updates
  // the pool state. Mirrors the Solana/Sui/Aptos "submit a signed txn" model.
  const txReq     = await contract.deposit.populateTransaction(
    a, b, c, c1.bytes32, c2.bytes32, encryptedNote1, encryptedNote2, { value: depositWei }
  )
  const populated = await signer.populateTransaction(txReq)
  const signedTx  = await signer.signTransaction(populated)

  const res = await fetch(`${BASE_URL}/evm/${networkId}/deposit`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ signedTx }),
  })
  const data = await res.json()
  if (!res.ok || !data.success) {
    throw new Error(data.message || `${networkId} deposit failed`)
  }

  onSendTx?.(data.txHash)

  return { hash: data.txHash, receipt: null, commitments: { c1: c1.bytes32, c2: c2.bytes32 } }
}