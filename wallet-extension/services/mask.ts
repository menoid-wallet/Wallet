/**
 * mask.ts
 *
 * "Mask" is Menoid's name for what the underlying contract calls
 * `deposit`. Funds leave the public account and enter the ZK pool as a
 * pair of commitments — one for the user (the masked amount) and one
 * for the relayer (its fee).
 *
 * Flow:
 *   1. Fetch relayer keys (one HTTP call to /relayer/get).
 *   2. Roll 2 random field elements as note randomness.
 *   3. Build two Poseidon commitments:
 *        c1 = poseidon([1, userAmount, r1, userZkPub])
 *        c2 = poseidon([1, feeAmount,  r2, relayerZkPub])
 *   4. ECIES-encrypt the notes (amount, randomness) so each party can
 *      later decrypt and spend.
 *   5. Run snarkjs.groth16.fullProve with the deposit circuit. This is
 *      the slow part (~20s) and runs entirely in the browser.
 *   6. Format the proof to solidity calldata.
 *   7. Sign + send the tx with the user's own `normalAccount.privateKey`
 *      via the Monad RPC provider (no MetaMask popup).
 *
 * WASM / zkey paths:
 *   Plasmo treats `assets/` at project root as a special folder. We
 *   place the artifacts at:
 *     assets/zk/deposit_proof.wasm
 *     assets/zk/deposit_proof_final.zkey
 *   and declare them as web_accessible_resources in package.json's
 *   manifest section:
 *     "web_accessible_resources": [
 *       { "resources": ["assets/zk/*"], "matches": ["<all_urls>"] }
 *     ]
 *   chrome.runtime.getURL("assets/zk/...") then resolves to a real URL
 *   the browser can fetch.
 */

import * as snarkjs from "snarkjs"
import { ethers, Wallet, Contract} from "ethers"
import { createCommitment } from "../crypto/commitment"
import { encryptMessage } from "../lib/crypto"
import { getProvider } from "../lib/monadRpc"
import PrivatePoolABI from "../abis/NoidPool.json"
import type { RelayerKeys } from "./api"

// ── runtime config ──────────────────────────────────────────────────────
// Build the chrome-extension:// URL for a packaged ZK asset. Source-of-
// truth path: assets/zk/<name> at the project root. The file must also
// be listed in web_accessible_resources in package.json's manifest block,
// otherwise it'll 404 even though it's in the bundle.
function zkAssetUrl(name: string): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(`assets/zk/${name}`)
  }
  return `/assets/zk/${name}`
}

// Pool contract address. Plasmo exposes PLASMO_PUBLIC_* env to the bundle.
function poolAddress(): string {

  const a =
    process.env
      .PLASMO_PUBLIC_PRIVATE_POOL_ADDRESS

  console.log("POOL ADDRESS:", a)

  if (!a) {
    throw new Error(
      "PLASMO_PUBLIC_PRIVATE_POOL_ADDRESS not set"
    )
  }

  return a
}

// ── random 31-byte field element (decimal string) ───────────────────────
function randomFieldElement(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(31))
  let hex = "0x"
  for (const b of bytes) hex += b.toString(16).padStart(2, "0")
  return BigInt(hex).toString()
}

// ── inputs / outputs ────────────────────────────────────────────────────
export interface ExecuteMaskArgs {
  /** decimal MON, e.g. "1.5" */
  depositAmountMon: string
  /** decimal MON, e.g. "0.5" */
  feeMon: string
  /** user's wallet — both accounts used */
  normalPrivateKey: string
  noidPublicKey: string
  noidZkPublicKey: string
  /** relayer info from /relayer/get */
  relayerKeys: RelayerKeys
  /** optional callbacks for the UI step bar */
  onProofStart?: () => void
  onSendTx?: (hash: string) => void
}

export interface ExecuteMaskResult {
  hash: string
  receipt: ethers.TransactionReceipt | null
  commitments: { c1: string; c2: string }
}

// ── main ────────────────────────────────────────────────────────────────
export async function executeMask({
  depositAmountMon,
  feeMon,
  normalPrivateKey,
  noidPublicKey,
  noidZkPublicKey,
  relayerKeys,
  onProofStart,
  onSendTx
}: ExecuteMaskArgs): Promise<ExecuteMaskResult> {
  const depositWei = ethers.parseEther(depositAmountMon)
  const feeWei = ethers.parseEther(feeMon)
  const userWei = depositWei - feeWei
  if (userWei <= 0n) throw new Error("Fee must be less than deposit amount")

  // 1. note randomness
  const r1 = randomFieldElement()
  const r2 = randomFieldElement()

  // 2. commitments
  const c1 = await createCommitment(userWei.toString(), r1, noidZkPublicKey)
  const c2 = await createCommitment(
    feeWei.toString(),
    r2,
    relayerKeys.zkPublicKey
  )

  // 3. encrypted notes — user's note encrypts to their own noid public
  // key so PoolContext can later decrypt it. Relayer's note encrypts to
  // the relayer's public key.
  const encryptedNote1 = encryptMessage(
    JSON.stringify({ amount: userWei.toString(), randomness: r1 }),
    noidPublicKey
  )
  const encryptedNote2 = encryptMessage(
    JSON.stringify({ amount: feeWei.toString(), randomness: r2 }),
    relayerKeys.publicKey
  )

  // 4. circuit inputs (must match the names in the .wasm)
  const input = {
    depositAmount: depositWei.toString(),
    c1: c1.decimal,
    c2: c2.decimal,
    a1: userWei.toString(),
    r1,
    pk1: noidZkPublicKey,
    a2: feeWei.toString(),
    r2,
    pk2: relayerKeys.zkPublicKey
  }

  onProofStart?.()

  // Sanity-check the assets are actually fetchable before snarkjs tries.
  // If the manifest's web_accessible_resources isn't set up, the HEAD
  // request fails fast with a clear message rather than the cryptic
  // "Failed to fetch" deep inside snarkjs.
  const wasmPath = zkAssetUrl("deposit_proof.wasm")
  const zkeyPath = zkAssetUrl("deposit_proof_final.zkey")

  try {
    const probe = await fetch(wasmPath, { method: "HEAD" })
    if (!probe.ok) {
      throw new Error(
        `ZK artifact not reachable at ${wasmPath} (HTTP ${probe.status}). ` +
          `Make sure assets/zk/deposit_proof.wasm exists and is listed in ` +
          `package.json → manifest.web_accessible_resources.`
      )
    }
  } catch (e: any) {
    if (e?.message?.startsWith("ZK artifact")) throw e
    throw new Error(
      `Can't reach ZK artifact at ${wasmPath}. ` +
        `Check assets/zk/deposit_proof.wasm and your manifest.`
    )
  }

  // 5. Groth16 proof — heavy, ~20s on a decent laptop.
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmPath,
    zkeyPath
  )

  // 6. solidity calldata
  const calldata = await snarkjs.groth16.exportSolidityCallData(
    proof,
    publicSignals
  )
  const argv = calldata.replace(/["[\]\s]/g, "").split(",")
  const a: [string, string] = [argv[0], argv[1]]
  const b: [[string, string], [string, string]] = [
    [argv[2], argv[3]],
    [argv[4], argv[5]]
  ]
  const c: [string, string] = [argv[6], argv[7]]

  // 7. sign + send with the LOCAL private key (no MetaMask)
  const provider = getProvider()
  const signer = new Wallet(normalPrivateKey, provider)
  const contract = new Contract(poolAddress(), PrivatePoolABI, signer)

  const tx = await contract.deposit(
    a,
    b,
    c,
    c1.bytes32,
    c2.bytes32,
    encryptedNote1,
    encryptedNote2,
    { value: depositWei }
  )

  onSendTx?.(tx.hash)
  const receipt = await tx.wait()

  return {
    hash: tx.hash,
    receipt,
    commitments: { c1: c1.bytes32, c2: c2.bytes32 }
  }
}