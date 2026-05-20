/**
 * keyDerivation.ts
 *
 * Pure TypeScript — runs directly in popup/tab, no background worker needed.
 * Uses poseidon-lite (zero WASM, pure TS, identical output to circomlibjs).
 *
 * Install: npm install poseidon-lite ethers
 */

import { ethers } from "ethers";
import { poseidon2, poseidon4 } from "poseidon-lite";

export interface DerivedWallet {
  privateWallet: { address: string; privateKey: string; publicKey: string };
  zk: { secretKey: string; publicKey: string };
}

/**
 * Generate a deterministic Menoid wallet from any string seed.
 * Equivalent to the original circomlibjs version — same BN254 Poseidon output.
 */
export async function generatePrivateWallet(seedInput: string): Promise<DerivedWallet> {
  const seed = ethers.keccak256(ethers.toUtf8Bytes(seedInput));
  const wallet = new ethers.Wallet(seed);
  const sk = BigInt(wallet.privateKey);

  // poseidon2([3n, sk]) === circomlibjs: poseidon.F.toString(poseidon([3, sk]))
  const pk: bigint = poseidon2([3n, sk]);

  return {
    privateWallet: {
      address: wallet.address,
      privateKey: wallet.privateKey,
      publicKey: ethers.SigningKey.computePublicKey(wallet.privateKey, false),
    },
    zk: {
      secretKey: sk.toString(),
      publicKey: pk.toString(),
    },
  };
}

/**
 * Generate a mnemonic synchronously — no hashing, instant.
 */
export function generateMnemonicOnly(): { mnemonic: string; privateKey: string } {
  const wallet = ethers.Wallet.createRandom();
  const mnemonic = wallet.mnemonic?.phrase;
  if (!mnemonic) throw new Error("Failed to generate mnemonic");
  return { mnemonic, privateKey: wallet.privateKey };
}

export async function generateNewWallet(): Promise<{ mnemonic: string; derived: DerivedWallet }> {
  const { mnemonic, privateKey } = generateMnemonicOnly();
  const derived = await generatePrivateWallet(privateKey + "Menoid wallet");
  return { mnemonic, derived };
}

export async function importFromMnemonic(phrase: string): Promise<DerivedWallet> {
  const wallet = ethers.Wallet.fromPhrase(phrase.trim());
  return generatePrivateWallet(wallet.privateKey + "Menoid wallet");
}

export async function importFromPrivateKey(pk: string): Promise<DerivedWallet> {
  const wallet = new ethers.Wallet(pk.trim());
  return generatePrivateWallet(wallet.privateKey + "Menoid wallet");
}