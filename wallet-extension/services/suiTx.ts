/**
 * suiTx.ts
 *
 * Handles Sui-specific ZK sponsored deposit, transfer, and withdraw.
 */

import { SuiJsonRpcClient as SuiClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64, fromBase64 } from "@mysten/bcs";
import * as snarkjs from "snarkjs";
import { createCommitment } from "../crypto/commitment";
import { encryptMessage } from "../lib/crypto";
import { BASE_URL, type RelayerKeys } from "./api";
import { zkAssetUrl } from "./mask";

const FQ = BigInt("21888242871839275222246405745257275088696311157297823662689037894645226208583");
const PACKAGE_ID = "0x0612ba9aec07eebbf0940b2f3334a92dc02131bca754f8d7cda2b42376a6b6ee";
const POOL_STATE_ID = "0xfe2b2ee932de17bee89e4fb2526d3a08e7b38c283bf11b786e7450b63a7784ee";
const VERIFIER_CONFIG_ID = "0x6eeab199388238932894d200c575fd39aa0b5014d5b2cb371b5573d0b7700a9b";

function toLE32(val: bigint): Uint8Array {
  const buf = new Uint8Array(32);
  let v = val;
  for (let i = 0; i < 32; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

function g1Compress(x: bigint, y: bigint): Uint8Array {
  const buf = toLE32(x);
  const yIsNeg = y > (FQ - y);
  buf[31] = (buf[31] & 0x3f) | (yIsNeg ? 0x80 : 0x00);
  return buf;
}

function g2Compress(xc0: bigint, xc1: bigint, yc0: bigint, yc1: bigint): Uint8Array {
  const negYc1 = yc1 === 0n ? 0n : FQ - yc1;
  const negYc0 = yc0 === 0n ? 0n : FQ - yc0;
  const yIsNeg = yc1 > negYc1 || (yc1 === negYc1 && yc0 > negYc0);
  const c0buf = toLE32(xc0);
  const c1buf = toLE32(xc1);
  c1buf[31] = (c1buf[31] & 0x3f) | (yIsNeg ? 0x80 : 0x00);
  const out = new Uint8Array(64);
  out.set(c0buf, 0);
  out.set(c1buf, 32);
  return out;
}

export function proofToBytes(proof: any): Uint8Array {
  const a = g1Compress(BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1]));
  const b = g2Compress(
    BigInt(proof.pi_b[0][0]), BigInt(proof.pi_b[0][1]),
    BigInt(proof.pi_b[1][0]), BigInt(proof.pi_b[1][1])
  );
  const c = g1Compress(BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1]));
  const out = new Uint8Array(128);
  out.set(a, 0);
  out.set(b, 32);
  out.set(c, 96);
  return out;
}

function randomFieldElement(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex).toString();
}

function getSuiKeypair(suiPrivateKey: string): Ed25519Keypair {
  const trimmed = suiPrivateKey.trim();
  if (trimmed.startsWith("suiprivkey")) {
    const { secretKey } = decodeSuiPrivateKey(trimmed);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(trimmed);
  } catch {
    bytes = Uint8Array.from(Buffer.from(trimmed.replace(/^0x/, ""), "hex"));
  }
  return Ed25519Keypair.fromSecretKey(bytes);
}

export interface ExecuteSuiMaskArgs {
  depositAmountSui: string;
  feeSui: string;
  suiPrivateKey: string;
  noidPublicKey: string;
  noidZkPublicKey: string;
  relayerKeys: RelayerKeys;
  onProofStart?: () => void;
  onSendTx?: (hash: string) => void;
}

export async function executeSuiMask({
  depositAmountSui,
  feeSui,
  suiPrivateKey,
  noidPublicKey,
  noidZkPublicKey,
  relayerKeys,
  onProofStart,
  onSendTx,
}: ExecuteSuiMaskArgs) {
  const depositWei = ethersParseEther(depositAmountSui);
  const feeWei = ethersParseEther(feeSui);
  const userWei = depositWei - feeWei;
  if (userWei <= 0n) throw new Error("Fee must be less than deposit amount");

  const r1 = randomFieldElement();
  const r2 = randomFieldElement();

  const c1 = await createCommitment(userWei.toString(), r1, noidZkPublicKey);
  const c2 = await createCommitment(feeWei.toString(), r2, relayerKeys.zkPublicKey);

  const encNote1 = encryptMessage(
    JSON.stringify({ amount: userWei.toString(), randomness: r1 }),
    noidPublicKey,
    "sui"
  );
  const encNote2 = encryptMessage(
    JSON.stringify({ amount: feeWei.toString(), randomness: r2 }),
    relayerKeys.publicKey,
    "sui"
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

  const wasmPath = zkAssetUrl("sui/deposit_proof.wasm");
  const zkeyPath = zkAssetUrl("sui/deposit_proof_final.zkey");

  const { proof } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
  const proofBytes = proofToBytes(proof);

  // The Move package recomputes the Merkle root on-chain — no off-chain roots.

  // Reconstruct SUI keypair and address
  const keypair = getSuiKeypair(suiPrivateKey);
  const aliceAddress = keypair.getPublicKey().toSuiAddress();

  const client = new SuiClient({ url: "https://fullnode.testnet.sui.io:443", network: "testnet" });

  // Gather ALL of the user's SUI coins. Because this is a sponsored transaction
  // (the relayer is the gas owner), none of the user's coins are reserved for
  // gas, so the full balance is available for the deposit. The balance is often
  // split across several coin objects, so we merge them inside the deposit PTB
  // and split the exact amount — rather than requiring one big-enough coin.
  const coinsData = await client.getCoins({ owner: aliceAddress, coinType: "0x2::sui::SUI" });
  if (coinsData.data.length === 0) {
    throw new Error(`No SUI coins found for ${aliceAddress}.`);
  }
  const sorted = coinsData.data.sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)));
  const totalBalance = sorted.reduce((s, c) => s + BigInt(c.balance), 0n);
  if (totalBalance < depositWei) {
    const haveSui = (Number(totalBalance) / 1e9).toFixed(6);
    throw new Error(`Insufficient SUI balance. Have ${haveSui} SUI across ${sorted.length} coin(s), need ${depositAmountSui} SUI.`);
  }
  const primaryCoinId = sorted[0].coinObjectId;
  const otherCoinIds = sorted.slice(1).map((c) => c.coinObjectId);

  // Fetch Sui Relayer Address
  const relayerAddressRes = await fetch(`${BASE_URL}/sui/relayer-address`);
  if (!relayerAddressRes.ok) throw new Error("Failed to fetch Sui relayer address");
  const relayerAddressData = await relayerAddressRes.json();
  const sponsorAddress = relayerAddressData.address;

  // Build sponsored transaction block
  const tx = new Transaction();
  const primaryCoin = tx.object(primaryCoinId);
  // Consolidate all of the user's coins into the primary so the split always has
  // enough, regardless of how the balance is fragmented across coin objects.
  if (otherCoinIds.length > 0) {
    tx.mergeCoins(primaryCoin, otherCoinIds.map((id) => tx.object(id)));
  }
  const [depositCoin] = tx.splitCoins(primaryCoin, [depositWei.toString()]);

  tx.moveCall({
    target: `${PACKAGE_ID}::pool::deposit`,
    arguments: [
      tx.object(POOL_STATE_ID),
      tx.object(VERIFIER_CONFIG_ID),
      depositCoin,
      tx.pure.vector("u8", Array.from(proofBytes)),
      tx.pure.u256(BigInt(c1.decimal)),
      tx.pure.u256(BigInt(c2.decimal)),
      tx.pure.u64(Number(depositWei)),
      tx.pure.vector("u8", Array.from(Buffer.from(encNote1))),
      tx.pure.vector("u8", Array.from(Buffer.from(encNote2))),
    ],
  });

  tx.setSender(aliceAddress);
  tx.setGasOwner(sponsorAddress);
  tx.setGasBudget(50_000_000);

  const txBytes = await tx.build({ client });
  const { signature: senderSignature } = await keypair.signTransaction(txBytes);

  // Submit sponsored deposit to backend relayer
  const res = await fetch(`${BASE_URL}/sui/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      txBytes: toBase64(txBytes),
      senderSignature,
      commitments: [c1.decimal, c2.decimal],
      encryptedNotes: [encNote1, encNote2],
      depositAmount: depositWei.toString(),
    }),
  });

  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData?.message || "Sui relayer deposit failed");
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
  const main = BigInt(parts[0]) * 1000000000n; // 9 decimals for SUI
  let frac = 0n;
  if (parts[1]) {
    const fStr = parts[1].padEnd(9, "0").slice(0, 9);
    frac = BigInt(fStr);
  }
  return main + frac;
}
