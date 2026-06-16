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
import { BASE_URL, type RelayerKeys } from "./api"
import bs58 from "bs58"

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
const ZERO_HASH   = "0x0000000000000000000000000000000000000000000000000000000000000000"
const ZERO_BIG    = BigInt(0)
// BN254 base field modulus (Fq) — used for curve point coordinates / G1 negation.
const FQ = BigInt("21888242871839275222246405745257275088696311157297823662689037894645226208583")
// BN254 scalar field modulus (Fr) — the prime the ZK circuit operates over.
// A receiver address is a CIRCUIT INPUT, so it must be reduced mod Fr so that the
// value baked into the proof's public signals matches what the on-chain verifier
// reconstructs (the Solana program reduces the receiver pubkey mod Fr).
const SCALAR_FIELD = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617")

const DECIMALS: Record<NetworkId, number> = {
  monad: 18,
  sepolia: 18,
  base_sepolia: 18,
  solana: 9,
  sui: 9,
  aptos: 8,
}

function parseAmount(val: string, decs: number): bigint {
  const parts = val.split(".")
  const main = BigInt(parts[0]) * (10n ** BigInt(decs))
  let frac = 0n
  if (parts[1]) {
    const fStr = parts[1].padEnd(decs, "0").slice(0, decs)
    frac = BigInt(fStr)
  }
  return main + frac
}

function formatAmount(val: bigint, decs: number): string {
  const s = val.toString().padStart(decs + 1, "0")
  const main = s.slice(0, s.length - decs)
  let frac = s.slice(s.length - decs)
  frac = frac.replace(/0+$/, "")
  return frac ? `${main}.${frac}` : main
}

function getRelayerFeeWei(networkId: NetworkId): bigint {
  const decs = DECIMALS[networkId] || 18
  const feeMon = ["monad", "sepolia", "base_sepolia"].includes(networkId) ? "0.5" : "0.0001"
  return parseAmount(feeMon, decs)
}

function addressToFieldElement(addr: string, networkId: NetworkId): string {
  if (networkId === "solana") {
    const bytes = bs58.decode(addr)
    const hex = Buffer.from(bytes).toString("hex")
    // Reduce mod Fr (scalar field), NOT Fq — a 32-byte Solana pubkey routinely
    // exceeds Fr, and the on-chain verifier reconstructs `receiver = pubkey % Fr`.
    return (BigInt("0x" + hex) % SCALAR_FIELD).toString()
  }
  if (networkId === "aptos") {
    // 32-byte Aptos address — same situation as Solana: it routinely exceeds Fr,
    // and the Move contract reconstructs `address_to_u256_mod_p = addr % BN254_P`
    // (BN254_P == Fr). Reduce mod Fr so the proof's public signal matches on-chain.
    return (BigInt(addr) % SCALAR_FIELD).toString()
  }
  // Other networks unchanged (EVM addresses are < Fr, so this is equivalent).
  return (BigInt(addr) % FQ).toString()
}

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
  withdrawAmt: bigint,
  relayerFee: bigint
): { plans: any[]; totalFee: bigint } | null {
  if (!unspent?.length || withdrawAmt <= ZERO_BIG) return null

  const totalNeeded = withdrawAmt + relayerFee
  const selected = selectUTXOs(unspent, totalNeeded)
  if (!selected) return null

  const flat = [...selected]
  const batches: any[][] = []
  while (flat.length > 0) batches.push(flat.splice(0, MAX_INPUTS))

  const plans: any[] = []
  let withdrawRemaining = withdrawAmt
  let feeRemaining = relayerFee

  for (const batch of batches) {
    const batchTotal: bigint = batch.reduce(
      (s: bigint, u: any) => s + BigInt(u.amount),
      ZERO_BIG
    )
    const feeAmt: bigint = batchTotal >= feeRemaining ? feeRemaining : batchTotal
    feeRemaining -= feeAmt
    const available: bigint = batchTotal - feeAmt
    const toWithdraw: bigint = withdrawRemaining <= available ? withdrawRemaining : available
    const changeAmt: bigint  = available - toWithdraw
    withdrawRemaining -= toWithdraw
    plans.push({ inputs: batch, withdrawAmt: toWithdraw, changeAmt, feeAmt })
  }

  if (withdrawRemaining > ZERO_BIG || feeRemaining > ZERO_BIG) return null
  return { plans, totalFee: relayerFee }
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
  getMerkleProof: (poolId: string, leafIndex: number) => any,
  networkId: NetworkId = "monad"
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
    sender.privateWallet.publicKey,
    networkId
  )
  const encryptedNote2 = encryptMessage(
    JSON.stringify({ amount: feeAmt.toString(), randomness: rRelayer }),
    relayer.publicKey,
    networkId
  )

  const receiverUint = addressToFieldElement(toAddress, networkId)

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

  const prefix = ["monad", "sepolia", "base_sepolia"].includes(networkId) ? "" : `${networkId}/`
  const wasmPath = zkAssetUrl(`${prefix}withdraw_proof.wasm`)
  const zkeyPath = zkAssetUrl(`${prefix}withdraw_proof_final.zkey`)

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
      c1Decimal: changeEnabled ? changeCommitment.decimal : "0",
      c2Decimal: relayerEnabled ? relayerCommitment.decimal : "0",
      encryptedNote1,
      encryptedNote2,
      withdrawAmount: withdrawAmt,
    },
    zkProof,
    publicSignals,
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
  const decs = DECIMALS[networkId] || 18
  const withdrawAmt = parseAmount(withdrawAmountMon, decs)
  if (withdrawAmt <= ZERO_BIG) throw new Error("Withdraw amount must be greater than 0")

  const relayerFee = getRelayerFeeWei(networkId)
  const totalAvailable = allUnspentUTXOs.reduce((s, u) => s + BigInt(u.amount), ZERO_BIG)
  const maxWithdrawable = totalAvailable > relayerFee ? totalAvailable - relayerFee : ZERO_BIG

  if (withdrawAmt > maxWithdrawable) {
    throw new Error(
      `Insufficient balance. Max withdrawable: ${formatAmount(maxWithdrawable, decs)} ` +
        `(after ${formatAmount(relayerFee, decs)} relayer fee). ` +
        `Total available: ${formatAmount(totalAvailable, decs)}.`
    )
  }

  const withdrawPlan = planWithdraw(allUnspentUTXOs, withdrawAmt, relayerFee)
  if (!withdrawPlan) throw new Error("Failed to plan withdrawal batches")

  const { plans } = withdrawPlan

  const sender = {
    zk: { secretKey: noidSecretKey, publicKey: noidZkPublicKey },
    privateWallet: { publicKey: noidPublicKey },
  }

  onRelayerFetch?.()

  if (["solana", "sui", "aptos"].includes(networkId)) {
    let lastHash = ""
    for (let i = 0; i < plans.length; i++) {
      onBatchStart?.(i + 1, plans.length)
      onProofStart?.(i + 1)
      const p = plans[i]
      const { withdrawCall, zkProof, publicSignals } = await buildWithdrawCall(
        p.inputs, p.withdrawAmt, p.changeAmt, p.feeAmt,
        toAddress, sender, relayerKeys, getMerkleProof, networkId
      )

      const outputEnabled = [p.changeAmt > ZERO_BIG ? 1 : 0, p.feeAmt > ZERO_BIG ? 1 : 0]
      const commitments = [withdrawCall.c1Decimal, withdrawCall.c2Decimal]
      const encNotes = [withdrawCall.encryptedNote1, withdrawCall.encryptedNote2]

      const decRoots: string[] = []
      const decNullifiers: string[] = []
      const poseidon = await getPoseidon()
      
      for (const utxo of p.inputs) {
        const merkleProof = getMerkleProof(utxo.poolId, utxo.leafIndex)
        decRoots.push(merkleProof.root.toString())
        const nullifier = poseidon.F.toString(
          poseidon([2n, BigInt(utxo.commitment), BigInt(utxo.randomness), BigInt(sender.zk.secretKey)])
        )
        decNullifiers.push(nullifier)
      }
      while (decRoots.length < MAX_INPUTS) {
        decRoots.push("0")
        decNullifiers.push("0")
      }

      let res: Response
      if (networkId === "solana") {
        const { formatProofForSolana } = await import("./solanaTx")
        const solanaProof = formatProofForSolana(zkProof)
        const body = {
          proof: {
            pi_a: zkProof.pi_a,
            pi_b: zkProof.pi_b,
            pi_c: zkProof.pi_c,
            protocol: zkProof.protocol,
            curve: zkProof.curve,
            proofA: solanaProof.proofA,
            proofB: solanaProof.proofB,
            proofC: solanaProof.proofC,
          },
          publicSignals,
          enabled: withdrawCall.inputs.enabled,
          roots: decRoots,
          nullifiers: decNullifiers,
          receiverPublicKey: toAddress,
          withdrawAmount: p.withdrawAmt.toString(),
          outputEnabled,
          commitments,
          encNotes,
        }
        res = await fetch(`${BASE_URL}/solana/withdraw`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      } else if (networkId === "sui") {
        const { proofToBytes } = await import("./suiTx")
        const proofBytes = proofToBytes(zkProof)
        const body = {
          proof: zkProof,
          publicSignals,
          proofBytes: Array.from(proofBytes),
          enabled: withdrawCall.inputs.enabled,
          poolIds: withdrawCall.inputs.poolIds,
          roots: decRoots,
          nullifiers: decNullifiers,
          receiverAddress: toAddress,
          withdrawAmount: p.withdrawAmt.toString(),
          outputEnabled,
          commitments,
          encNotes,
        }
        res = await fetch(`${BASE_URL}/sui/withdraw`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      } else { // aptos
        const { proofToBytes } = await import("./aptosTx")
        const aptosProof = proofToBytes(zkProof)
        const body = {
          proof: zkProof,
          publicSignals,
          aBytes: Array.from(aptosProof.aBytes),
          bBytes: Array.from(aptosProof.bBytes),
          cBytes: Array.from(aptosProof.cBytes),
          enabled: withdrawCall.inputs.enabled,
          poolIds: withdrawCall.inputs.poolIds,
          roots: decRoots,
          nullifiers: decNullifiers,
          receiverAddress: toAddress,
          withdrawAmount: p.withdrawAmt.toString(),
          outputEnabled,
          commitments,
          encNotes,
        }
        res = await fetch(`${BASE_URL}/aptos/withdraw`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      }

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData?.message || `${networkId} relayer withdraw failed`)
      }

      const resData = await res.json()
      lastHash = resData.txHash
      onSendTx?.(lastHash)
    }

    return { hash: lastHash, receipt: null, totalFee: relayerFee }
  }

  const withdrawCalls: any[] = []

  for (let i = 0; i < plans.length; i++) {
    onBatchStart?.(i + 1, plans.length)
    onProofStart?.(i + 1)
    const p = plans[i]
    const { withdrawCall } = await buildWithdrawCall(
      p.inputs, p.withdrawAmt, p.changeAmt, p.feeAmt,
      toAddress, sender, relayerKeys, getMerkleProof, networkId
    )
    withdrawCalls.push(withdrawCall)
  }

  const provider = getProvider(networkId)
  const signer   = new Wallet(normalPrivateKey, provider)
  const contract = new Contract(poolAddress(networkId), PrivatePoolABI, signer)

  const tx = await contract.withdraw(withdrawCalls, toAddress)
  onSendTx?.(tx.hash)

  const receipt = await tx.wait()
  return { hash: tx.hash, receipt, totalFee: relayerFee }
}