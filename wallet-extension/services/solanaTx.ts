/**
 * solanaTx.ts
 *
 * Handles Solana-specific ZK deposit, transfer, and withdraw.
 */

import { Connection, PublicKey, Keypair, SystemProgram, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import * as snarkjs from "snarkjs";
import bs58 from "bs58";
import idl from "../abis/noid_solana.json";
import { createCommitment } from "../crypto/commitment";
import { encryptMessage } from "../lib/crypto";
import { BASE_URL, type RelayerKeys } from "./api";
import { zkAssetUrl } from "./mask";

const FQ = BigInt("21888242871839275222246405745257275088696311157297823662689037894645226208583");
const PROGRAM_ID = new PublicKey("3wxDTqw42qqftiAcTZ6kLeNtepuSmB1mR1skrEcwD9SC");
const POOL_STATE_PDA = new PublicKey(process.env.PLASMO_PUBLIC_SOLANA_POOL_STATE_PDA || "A4CFTtV8LXLya3bGVV4YdKmXD2KF7qWYSrv3KdyDZZVc");
const VAULT_PDA = PublicKey.findProgramAddressSync([Buffer.from("vault"), POOL_STATE_PDA.toBuffer()], PROGRAM_ID)[0];

function toBE32(valStr: string): Uint8Array {
  const val = BigInt(valStr);
  const buf = new Uint8Array(32);
  let temp = val;
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return buf;
}

export function formatProofForSolana(proof: any) {
  const xA = BigInt(proof.pi_a[0]);
  const yA = BigInt(proof.pi_a[1]);
  const negYA = yA === 0n ? 0n : FQ - yA;
  const proofA = Buffer.concat([toBE32(xA.toString()), toBE32(negYA.toString())]);

  const proofB = Buffer.concat([
    toBE32(proof.pi_b[0][1]),
    toBE32(proof.pi_b[0][0]),
    toBE32(proof.pi_b[1][1]),
    toBE32(proof.pi_b[1][0]),
  ]);

  const proofC = Buffer.concat([
    toBE32(proof.pi_c[0]),
    toBE32(proof.pi_c[1]),
  ]);

  return {
    proofA: Array.from(proofA),
    proofB: Array.from(proofB),
    proofC: Array.from(proofC),
  };
}

function randomFieldElement(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex).toString();
}

export interface ExecuteSolanaMaskArgs {
  depositAmountSol: string;
  feeSol: string;
  solanaPrivateKey: string;
  noidPublicKey: string;
  noidZkPublicKey: string;
  relayerKeys: RelayerKeys;
  onProofStart?: () => void;
  onSendTx?: (hash: string) => void;
}

export async function executeSolanaMask({
  depositAmountSol,
  feeSol,
  solanaPrivateKey,
  noidPublicKey,
  noidZkPublicKey,
  relayerKeys,
  onProofStart,
  onSendTx,
}: ExecuteSolanaMaskArgs) {
  const depositWei = ethersParseEther(depositAmountSol);
  const feeWei = ethersParseEther(feeSol);
  const userWei = depositWei - feeWei;
  if (userWei <= 0n) throw new Error("Fee must be less than deposit amount");

  const r1 = randomFieldElement();
  const r2 = randomFieldElement();

  const c1 = await createCommitment(userWei.toString(), r1, noidZkPublicKey);
  const c2 = await createCommitment(feeWei.toString(), r2, relayerKeys.zkPublicKey);

  const encNote1 = encryptMessage(
    JSON.stringify({ amount: userWei.toString(), randomness: r1 }),
    noidPublicKey,
    "solana"
  );
  const encNote2 = encryptMessage(
    JSON.stringify({ amount: feeWei.toString(), randomness: r2 }),
    relayerKeys.publicKey,
    "solana"
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

  const wasmPath = zkAssetUrl("solana/deposit_proof.wasm");
  const zkeyPath = zkAssetUrl("solana/deposit_proof_final.zkey");

  const { proof } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
  const solanaProof = formatProofForSolana(proof);

  // The on-chain program recomputes the Merkle root itself — no off-chain roots
  // are passed. Deposit is permissionless and signed by the user alone.

  // Setup Solana SDK Connection and Keypair
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  let decodedSecret: Uint8Array;
  try {
    decodedSecret = bs58.decode(solanaPrivateKey.trim());
  } catch (e) {
    const clean = solanaPrivateKey.replace(/^0x/, "").trim();
    decodedSecret = Uint8Array.from(Buffer.from(clean, "hex"));
  }
  const aliceKeypair = decodedSecret.length === 64
    ? Keypair.fromSecretKey(decodedSecret)
    : Keypair.fromSeed(decodedSecret);

  const commitment1Pda = PublicKey.findProgramAddressSync(
    [Buffer.from("commitment"), toBE32(c1.decimal)],
    PROGRAM_ID
  )[0];
  const commitment2Pda = PublicKey.findProgramAddressSync(
    [Buffer.from("commitment"), toBE32(c2.decimal)],
    PROGRAM_ID
  )[0];

  const dummyWallet = {
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any[]) => txs,
    publicKey: PublicKey.default,
  };
  const provider = new AnchorProvider(connection, dummyWallet, { commitment: "confirmed" });
  const program = new Program(idl as any, provider);

  const ix = await program.methods
    .deposit(
      solanaProof.proofA,
      solanaProof.proofB,
      solanaProof.proofC,
      new BN(depositWei.toString()),
      Array.from(toBE32(c1.decimal)),
      Array.from(toBE32(c2.decimal)),
    )
    .accounts({
      user: aliceKeypair.publicKey,
      poolState: POOL_STATE_PDA,
      vault: VAULT_PDA,
      commitment1: commitment1Pda,
      commitment2: commitment2Pda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1000000 }));
  tx.add(ix);

  tx.feePayer = aliceKeypair.publicKey;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.partialSign(aliceKeypair);

  const serializedTx = tx.serialize({ requireAllSignatures: false }).toString("hex");

  // Send to backend relayer
  const res = await fetch(`${BASE_URL}/solana/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serializedTx,
      commitments: [c1.decimal, c2.decimal],
      encryptedNotes: [encNote1, encNote2],
      depositAmount: depositWei.toString(),
    }),
  });

  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData?.message || "Solana relayer deposit failed");
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
  const main = BigInt(parts[0]) * 1000000000n; // 9 decimals for SOL
  let frac = 0n;
  if (parts[1]) {
    const fStr = parts[1].padEnd(9, "0").slice(0, 9);
    frac = BigInt(fStr);
  }
  return main + frac;
}
