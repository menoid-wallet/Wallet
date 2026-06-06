/**
 * unmask.ts
 *
 * "Unmask" = withdraw from the ZK pool. Now network-aware.
 *
 * Pass `networkId` in ExecuteUnmaskArgs (from WalletContext.activeNetwork)
 * to use the correct pool contract and RPC endpoint.
 */

import * as snarkjs from "snarkjs"
import { ethers, Wallet, Contract } from "ethers"
import { buildPoseidon } from "circomlibjs"
import { createCommitment } from "../crypto/commitment"
import { encryptMessage } from "../lib/crypto"
import { getProvider } from "../lib/rpc"
import { NETWORKS, type NetworkId } from "../lib/networks"
import PrivatePoolABI from "../abis/NoidPool.json"
import type { RelayerKeys } from "./api"

// ── runtime config ───────────────────────────────────────────────────────────

export function zkAssetUrl(name: string): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(`assets/zk/${name}`)
  }
  return `/assets/zk/${name}`
}

export function poolAddress(networkId: NetworkId = "monad"): string {
  const addr = NETWORKS[networkId]?.poolAddress
  if (!addr) throw new Error(`Pool address not configured for network: ${networkId}`)
  return addr
}

// ── constants ────────────────────────────────────────────────────────────────

const MAX_INPUTS  = 4
const RELAYER_FEE = ethers.parseEther("0.5")
const ZERO_HASH   = "0x0000000000000000000000000000000000000000000000000000000000000000"
const ZERO_BIG    = BigInt(0)

// ── poseidon singleton ───────────────────────────────────────────────────────

let _poseidon: any = null
async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon()
  return _poseidon
}

// ── helpers ──────────────────────────────────────────────────────────────────

function toBytes32(value: string | bigint): string {
  return ethers.zeroPadValue(ethers.toBeHex(BigInt(value)), 32)
}

function randomR(): string {
  return ethers.toBigInt(ethers.randomBytes(31)).toString()
}

function selectUTXOs(unspent: any[], targetBigInt: bigint): any[] | null {
  const sorted = [...unspent].sort((a, b) => {
    const diff = BigInt(b.amount) - BigInt(a.amount)
    return diff > 0n ? 1 : diff < 0n ? -1 : 0
  })
  const selected: any[] = []
  let acc = ZERO_BIG
  for (const utxo of sorted) {
    if (acc >= targetBigInt) break
    selected.push(utxo)
    acc += BigInt(utxo.amount)
  }
  return acc >= targetBigInt ? selected : null
}

function planWithdraw(
  unspent: any[],
  withdrawAmt: bigint
): { plans: any[]; totalFee: bigint } | null {
  if (!unspent?.length || withdrawAmt <= ZERO_BIG) return null

  const totalNeeded = withdrawAmt + RELAYER_FEE
  const selected = selectUTXOs(unspent, totalNeeded)
  if (!selected) return null

  const flat = [...selected]
  const batches: any[][] = []
  while (flat.length > 0) batches.push(flat.splice(0, MAX_INPUTS))

  const plans: any[] = []
  let withdrawRemaining = withdrawAmt
  let feeRemaining = RELAYER_FEE

  for (const batch of batches) {
    const batchTotal = batch.reduce(
      (s: bigint, u: any) => s + BigInt(u.amount),
      ZERO_BIG
    )
    const feeAmt = batchTotal >= feeRemaining ? feeRemaining : batchTotal
    feeRemaining -= feeAmt
    const available = batchTotal - feeAmt
    const toWithdraw = withdrawRemaining <= available ? withdrawRemaining : available
    const changeAmt  = available - toWithdraw
    withdrawRemaining -= toWithdraw
    plans.push({ inputs: batch, withdrawAmt: toWithdraw, changeAmt, feeAmt })
  }

  if (withdrawRemaining > ZERO_BIG || feeRemaining > ZERO_BIG) return null
  return { plans, totalFee: RELAYER_FEE }
}

// ── build one WithdrawCall + ZK proof ─────────────────────────────────────────

async function buildWithdrawCall(
  inputs: any[],
  withdrawAmt: bigint,
  changeAmt: bigint,
  feeAmt: bigint,
  toAddress: string,
  sender: { zk: { secretKey: string; publicKey: string }; privateWallet: { publicKey: string } },
  relayer: { zkPublicKey: string; publicKey: string },
  getMerkleProof: (poolId: string, leafIndex: number) => any
) {
  const poseidon = await getPoseidon()
  const padded = [...inputs]
  while (padded.length < MAX_INPUTS) padded.push(null)

  const enabled: number[] = []
  const c_ins: string[]   = []
  const a_ins: string[]   = []
  const r_ins: string[]   = []
  const roots: string[]   = []
  const pathElements: string[][] = []
  const pathIndices: number[][]  = []
  const nullifiers: string[]     = []
  const poolIds: number[]        = []
  const rootsBytes32: string[]      = []
  const nullifiersBytes32: string[] = []

  for (const utxo of padded) {
    if (!utxo) {
      enabled.push(0); c_ins.push("0"); a_ins.push("0"); r_ins.push("0"); roots.push("0")
      pathElements.push(Array(20).fill("0")); pathIndices.push(Array(20).fill(0))
      nullifiers.push("0"); poolIds.push(0)
      rootsBytes32.push(ZERO_HASH); nullifiersBytes32.push(ZERO_HASH)
      continue
    }

    enabled.push(1)
    const merkleProof = getMerkleProof(utxo.poolId, utxo.leafIndex)
    if (!merkleProof) throw new Error(`No Merkle proof for leaf ${utxo.leafIndex} in pool ${utxo.poolId}`)

    const rootBig   = merkleProof.root.toString()
    const nullifier = poseidon.F.toString(
      poseidon([2n, BigInt(utxo.commitment), BigInt(utxo.randomness), BigInt(sender.zk.secretKey)])
    )

    c_ins.push(BigInt(utxo.commitment).toString())
    a_ins.push(utxo.amount)
    r_ins.push(utxo.randomness)
    roots.push(rootBig)
    pathElements.push(merkleProof.siblings.map((s: any) => s[0].toString()))
    pathIndices.push(merkleProof.pathIndices)
    nullifiers.push(nullifier)
    poolIds.push(typeof utxo.poolId === "number" ? utxo.poolId : parseInt(utxo.poolId) || 0)
    rootsBytes32.push(toBytes32(rootBig))
    nullifiersBytes32.push(toBytes32(nullifier))
  }

  const rChange  = randomR()
  const rRelayer = randomR()

  const changeEnabled  = changeAmt > ZERO_BIG ? 1 : 0
  const relayerEnabled = feeAmt    > ZERO_BIG ? 1 : 0

  const changeCommitment  = await createCommitment(changeAmt.toString(), rChange,  sender.zk.publicKey)
  const relayerCommitment = await createCommitment(feeAmt.toString(),    rRelayer, relayer.zkPublicKey)

  const encryptedNote1 = encryptMessage(
    JSON.stringify({ amount: changeAmt.toString(), randomness: rChange }),
    sender.privateWallet.publicKey
  )
  const encryptedNote2 = encryptMessage(
    JSON.stringify({ amount: feeAmt.toString(), randomness: rRelayer }),
    relayer.publicKey
  )

  const receiverUint = BigInt(toAddress).toString()

  const circuitInput = {
    pk: sender.zk.publicKey,
    sk: sender.zk.secretKey,
    receiver: receiverUint,
    changeReceiver: sender.zk.publicKey,
    relayer: relayer.zkPublicKey,
    enabled, c_ins, a_ins, r_ins, roots, pathElements, pathIndices, nullifiers,
    withdrawAmount: withdrawAmt.toString(),
    out_enabled:  [changeEnabled, relayerEnabled],
    a_outs:       [changeAmt.toString(), feeAmt.toString()],
    r_outs:       [rChange, rRelayer],
    c_outs: [
      changeEnabled  ? changeCommitment.decimal  : "0",
      relayerEnabled ? relayerCommitment.decimal : "0",
    ],
    receivers: [sender.zk.publicKey, relayer.zkPublicKey],
  }

  const wasmPath = zkAssetUrl("withdraw_proof.wasm")
  const zkeyPath = zkAssetUrl("withdraw_proof_final.zkey")

  const { proof: zkProof, publicSignals } =
    await (snarkjs as any).groth16.fullProve(circuitInput, wasmPath, zkeyPath)

  const calldata = await (snarkjs as any).groth16.exportSolidityCallData(zkProof, publicSignals)
  const argv = calldata.replace(/["[\]\s]/g, "").split(",")

  return {
    withdrawCall: {
      a: [argv[0], argv[1]],
      b: [[argv[2], argv[3]], [argv[4], argv[5]]],
      c: [argv[6], argv[7]],
      inputs: { enabled, roots: rootsBytes32, poolIds, nullifiers: nullifiersBytes32 },
      C1: changeEnabled  ? changeCommitment.bytes32  : ZERO_HASH,
      C2: relayerEnabled ? relayerCommitment.bytes32 : ZERO_HASH,
      encryptedNote1,
      encryptedNote2,
      withdrawAmount: withdrawAmt,
    },
    zkProof,
  }
}

// ── inputs / outputs ──────────────────────────────────────────────────────────

export interface ExecuteUnmaskArgs {
  withdrawAmountMon: string
  toAddress: string
  normalPrivateKey: string
  noidSecretKey: string
  noidPublicKey: string
  noidZkPublicKey: string
  relayerKeys: RelayerKeys
  allUnspentUTXOs: any[]
  getMerkleProof: (poolId: string, leafIndex: number) => any
  /** Active network — determines which pool contract and RPC is used */
  networkId?: NetworkId
  onRelayerFetch?: () => void
  onBatchStart?: (batchNum: number, totalBatches: number) => void
  onProofStart?: (batchNum: number) => void
  onSendTx?: (hash: string) => void
}

export interface ExecuteUnmaskResult {
  hash: string
  receipt: ethers.TransactionReceipt | null
  totalFee: bigint
}

// ── main ─────────────────────────────────────────────────────────────────────

export async function executeUnmask({
  withdrawAmountMon,
  toAddress,
  normalPrivateKey,
  noidSecretKey,
  noidPublicKey,
  noidZkPublicKey,
  relayerKeys,
  allUnspentUTXOs,
  getMerkleProof,
  networkId = "monad",
  onRelayerFetch,
  onBatchStart,
  onProofStart,
  onSendTx,
}: ExecuteUnmaskArgs): Promise<ExecuteUnmaskResult> {
  const withdrawAmt = ethers.parseEther(withdrawAmountMon)
  if (withdrawAmt <= ZERO_BIG) throw new Error("Withdraw amount must be greater than 0")

  const totalAvailable = allUnspentUTXOs.reduce((s, u) => s + BigInt(u.amount), ZERO_BIG)
  const maxWithdrawable = totalAvailable > RELAYER_FEE ? totalAvailable - RELAYER_FEE : ZERO_BIG

  if (withdrawAmt > maxWithdrawable) {
    throw new Error(
      `Insufficient balance. Max withdrawable: ${ethers.formatEther(maxWithdrawable)} ` +
        `(after ${ethers.formatEther(RELAYER_FEE)} relayer fee). ` +
        `Total available: ${ethers.formatEther(totalAvailable)}.`
    )
  }

  const withdrawPlan = planWithdraw(allUnspentUTXOs, withdrawAmt)
  if (!withdrawPlan) throw new Error("Failed to plan withdrawal batches")

  const { plans } = withdrawPlan

  const sender = {
    zk: { secretKey: noidSecretKey, publicKey: noidZkPublicKey },
    privateWallet: { publicKey: noidPublicKey },
  }

  onRelayerFetch?.()

  const withdrawCalls: any[] = []

  for (let i = 0; i < plans.length; i++) {
    onBatchStart?.(i + 1, plans.length)
    onProofStart?.(i + 1)
    const p = plans[i]
    const { withdrawCall } = await buildWithdrawCall(
      p.inputs, p.withdrawAmt, p.changeAmt, p.feeAmt,
      toAddress, sender, relayerKeys, getMerkleProof
    )
    withdrawCalls.push(withdrawCall)
  }

  const provider = getProvider(networkId)
  const signer   = new Wallet(normalPrivateKey, provider)
  const contract = new Contract(poolAddress(networkId), PrivatePoolABI, signer)

  const tx = await contract.withdraw(withdrawCalls, toAddress)
  onSendTx?.(tx.hash)

  const receipt = await tx.wait()
  return { hash: tx.hash, receipt, totalFee: RELAYER_FEE }
}