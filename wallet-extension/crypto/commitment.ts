/**
 * commitment.ts — pure TS, runs in UI directly.
 */

import { ethers } from "ethers";
import { poseidon4 } from "poseidon-lite";

export interface Commitment {
  decimal: string;
  bytes32: string;
}

export async function createCommitment(
  amount: bigint | string,
  randomness: bigint | string,
  zkPublicKey: bigint | string
): Promise<Commitment> {
  const result: bigint = poseidon4([
    1n,
    BigInt(amount),
    BigInt(randomness),
    BigInt(zkPublicKey),
  ]);
  return {
    decimal: result.toString(),
    bytes32: ethers.zeroPadValue(ethers.toBeHex(result), 32),
  };
}