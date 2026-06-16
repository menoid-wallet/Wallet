/**
 * aptosTx.ts
 *
 * Handles Aptos-specific ZK multi-agent deposit, transfer, and withdraw.
 */

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import * as snarkjs from "snarkjs";
import { createCommitment } from "../crypto/commitment";
import { encryptMessage } from "../lib/crypto";
import { BASE_URL, type RelayerKeys } from "./api";
import { zkAssetUrl } from "./mask";

const MODULE_ADDR = "0xb50ddea69fa72666f7fc54ad9e1814a66e47ea61288131b0991e17a2ef08dabb";

interface ProofCalldata {
  aBytes: Uint8Array;
  bBytes: Uint8Array;
  cBytes: Uint8Array;
}

function writeLE(buf: Uint8Array, value: bigint, offset: number, len: number) {
  let v = value;
  for (let i = offset; i < offset + len; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

export function proofToBytes(proof: any): ProofCalldata {
  const g1 = (pt: string[]) => {
    const b = new Uint8Array(64);
    writeLE(b, BigInt(pt[0]), 0,  32);
    writeLE(b, BigInt(pt[1]), 32, 32);
    return b;
  };
  const g2 = (pt: string[][]) => {
    const b = new Uint8Array(128);
    writeLE(b, BigInt(pt[0][0]), 0,  32);  // x0
    writeLE(b, BigInt(pt[0][1]), 32, 32);  // x1
    writeLE(b, BigInt(pt[1][0]), 64, 32);  // y0
    writeLE(b, BigInt(pt[1][1]), 96, 32);  // y1
    return b;
  };
  return { aBytes: g1(proof.pi_a), bBytes: g2(proof.pi_b), cBytes: g1(proof.pi_c) };
}

function randomFieldElement(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex).toString();
}

export interface ExecuteAptosMaskArgs {
  depositAmountApt: string;
  feeApt: string;
  aptosPrivateKey: string;
  noidPublicKey: string;
  noidZkPublicKey: string;
  relayerKeys: RelayerKeys;
  onProofStart?: () => void;
  onSendTx?: (hash: string) => void;
}

export async function executeAptosMask({
  depositAmountApt,
  feeApt,
  aptosPrivateKey,
  noidPublicKey,
  noidZkPublicKey,
  relayerKeys,
  onProofStart,
  onSendTx,
}: ExecuteAptosMaskArgs) {
  const depositWei = ethersParseEther(depositAmountApt);
  const feeWei = ethersParseEther(feeApt);
  const userWei = depositWei - feeWei;
  if (userWei <= 0n) throw new Error("Fee must be less than deposit amount");

  const r1 = randomFieldElement();
  const r2 = randomFieldElement();

  const c1 = await createCommitment(userWei.toString(), r1, noidZkPublicKey);
  const c2 = await createCommitment(feeWei.toString(), r2, relayerKeys.zkPublicKey);

  const encNote1 = encryptMessage(
    JSON.stringify({ amount: userWei.toString(), randomness: r1 }),
    noidPublicKey,
    "aptos"
  );
  const encNote2 = encryptMessage(
    JSON.stringify({ amount: feeWei.toString(), randomness: r2 }),
    relayerKeys.publicKey,
    "aptos"
  );

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
  };

  onProofStart?.();

  const wasmPath = zkAssetUrl("aptos/deposit_proof.wasm");
  const zkeyPath = zkAssetUrl("aptos/deposit_proof_final.zkey");

  const { proof } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
  const aptosProof = proofToBytes(proof);

  // Fetch Aptos state to calculate roots
  const stateRes = await fetch(`${BASE_URL}/state/aptos/latest`);
  if (!stateRes.ok) throw new Error("Failed to fetch Aptos state");
  const stateData = await stateRes.json();
  const pool = stateData.poolStates?.find((p: any) => p.poolId === "0");
  const existingCommitments = pool?.commitments || [];

  // Compute root1 and root2
  const { IncrementalMerkleTree } = await import("@zk-kit/incremental-merkle-tree");
  const { buildPoseidon } = await import("circomlibjs");
  const poseidon = await buildPoseidon();
  const hash = (inputs: bigint[]) => BigInt(poseidon.F.toString(poseidon(inputs)));
  const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);
  for (const cm of existingCommitments) {
    tree.insert(BigInt(cm));
  }
  tree.insert(BigInt(c1.decimal));
  const root1 = tree.root.toString();
  tree.insert(BigInt(c2.decimal));
  const root2 = tree.root.toString();

  // Initialize Aptos SDK and Account
  const config = new AptosConfig({ network: Network.TESTNET });
  const aptos = new Aptos(config);
  const pk = new Ed25519PrivateKey(aptosPrivateKey.trim().replace(/^0x/, ""));
  const aliceAccount = Account.fromPrivateKey({ privateKey: pk });

  // Fetch Aptos Relayer Address
  const relayerAddressRes = await fetch(`${BASE_URL}/aptos/relayer-address`);
  if (!relayerAddressRes.ok) throw new Error("Failed to fetch Aptos relayer address");
  const relayerAddressData = await relayerAddressRes.json();
  const relayerAddress = relayerAddressData.address;

  // Build multi-agent transaction (Alice is sender, Relayer is secondary signer and fee payer)
  const tx = await aptos.transaction.build.multiAgent({
    sender: aliceAccount.accountAddress,
    secondarySignerAddresses: [relayerAddress],
    withFeePayer: true,
    data: {
      function: `${MODULE_ADDR}::pool::deposit`,
      typeArguments: [],
      functionArguments: [
        MODULE_ADDR,
        Array.from(aptosProof.aBytes),
        Array.from(aptosProof.bBytes),
        Array.from(aptosProof.cBytes),
        BigInt(c1.decimal).toString(),
        BigInt(c2.decimal).toString(),
        depositWei.toString(),
        Array.from(Buffer.from(encNote1)),
        Array.from(Buffer.from(encNote2)),
      ],
    },
    options: { maxGasAmount: 2_000_000, gasUnitPrice: 100 },
  });

  const aliceAuth = await aptos.transaction.sign({ signer: aliceAccount, transaction: tx });
  const rawTxBytes = tx.bcsToBytes();

  // Submit sponsored deposit to backend relayer
  const res = await fetch(`${BASE_URL}/aptos/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawTxBytes: Array.from(rawTxBytes),
      senderAuth: aliceAuth,
      commitments: [c1.decimal, c2.decimal],
      encryptedNotes: [encNote1, encNote2],
      depositAmount: depositWei.toString(),
    }),
  });

  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData?.message || "Aptos relayer deposit failed");
  }

  const resData = await res.json();
  onSendTx?.(resData.txHash);

  return {
    hash: resData.txHash,
    commitments: { c1: c1.bytes32, c2: c2.bytes32 },
  };
}

function ethersParseEther(val: string): bigint {
  const parts = val.split(".");
  const main = BigInt(parts[0]) * 100000000n; // 8 decimals for APT
  let frac = 0n;
  if (parts[1]) {
    const fStr = parts[1].padEnd(8, "0").slice(0, 8);
    frac = BigInt(fStr);
  }
  return main + frac;
}
