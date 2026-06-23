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

// Object-code deployment: the module/function prefix is the object address, but
// the PoolState resource lives under the deployer (POOL_ADDR), which is the
// `pool_addr` argument every entry function takes.
const MODULE_ADDR = "0x3d4f846b4023cba619dc1e1523b0a80716887da90cbdcdaa3e50f453a9b915cc";
const POOL_ADDR = "0xb50ddea69fa72666f7fc54ad9e1814a66e47ea61288131b0991e17a2ef08dabb";

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

  // The contract computes the root via per-commitment new_root proofs that the
  // relayer attaches on-chain (pool::update_root). The client only signs the
  // deposit, which queues the commitments — no off-chain roots are passed.

  // Initialize Aptos SDK and Account
  const config = new AptosConfig({ network: Network.TESTNET });
  const aptos = new Aptos(config);
  const pk = new Ed25519PrivateKey(aptosPrivateKey.trim().replace(/^0x/, ""));
  const aliceAccount = Account.fromPrivateKey({ privateKey: pk });

  // Build a single-signer, fee-payer (sponsored) transaction. Alice is the sender
  // (her APT is deposited); the relayer co-signs as fee payer on the backend.
  const tx = await aptos.transaction.build.simple({
    sender: aliceAccount.accountAddress,
    withFeePayer: true,
    data: {
      function: `${MODULE_ADDR}::pool::deposit`,
      typeArguments: [],
      functionArguments: [
        POOL_ADDR,                          // pool_addr: address
        Array.from(aptosProof.aBytes),      // a_bytes: vector<u8>
        Array.from(aptosProof.bBytes),      // b_bytes: vector<u8>
        Array.from(aptosProof.cBytes),      // c_bytes: vector<u8>
        BigInt(c1.decimal).toString(),      // c1: u256
        BigInt(c2.decimal).toString(),      // c2: u256
        depositWei.toString(),              // amount: u64
        Array.from(Buffer.from(encNote1)),  // encrypted_note1: vector<u8>
        Array.from(Buffer.from(encNote2)),  // encrypted_note2: vector<u8>
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
      // Send the authenticator as BCS bytes; the relayer reconstructs it with
      // AccountAuthenticator.deserialize (a JSON object can't be re-hydrated).
      senderAuth: Array.from(aliceAuth.bcsToBytes()),
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
