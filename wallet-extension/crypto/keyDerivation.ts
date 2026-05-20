/**
 * keyDerivation.ts
 *
 * Two separate account types:
 *
 * normalAccount — standard ETH wallet derived directly from seed phrase
 *   { address, privateKey, publicKey }
 *
 * noidAccount — Menoid ZK wallet derived from normalAccount.privateKey + "Menoid wallet"
 *   { address, privateKey, publicKey, zkSecretKey, zkPublicKey }
 *
 * Install: npm install poseidon-lite ethers
 */

import { ethers } from "ethers";
import { poseidon2 } from "poseidon-lite";
import {
  Wallet,
  SigningKey,
  keccak256,
  toUtf8Bytes
} from "ethers";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NormalAccount {
  address: string;
  privateKey: string;
  publicKey: string;
}

export interface NoidAccount {
  address: string;
  privateKey: string;
  publicKey: string;
  zkSecretKey: string;
  zkPublicKey: string;
}

export interface FullWallet {
  normalAccount: NormalAccount;
  noidAccount: NoidAccount;
  seedPhrase?: string;
}

// ─── Normal account (from seed phrase directly) ───────────────────────────────

export function deriveNormalAccount(seedPhrase: string): NormalAccount {
  const wallet = ethers.Wallet.fromPhrase(seedPhrase.trim());
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    publicKey: SigningKey.computePublicKey(wallet.privateKey, false),
  };
}

export function deriveNormalAccountFromPrivateKey(privateKey: string): NormalAccount {
  const wallet = new Wallet(privateKey.trim());
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    publicKey: SigningKey.computePublicKey(wallet.privateKey, false),
  };
}

// ─── Noid account (from normalAccount.privateKey + "Menoid wallet") ───────────

export function deriveNoidAccount(normalPrivateKey: string): NoidAccount {
  const seedInput = normalPrivateKey + "Menoid wallet";

  // deterministic seed via keccak256
  console.log("toUtf bytes:",toUtf8Bytes)
  const seed = keccak256(toUtf8Bytes(seedInput));

  // derived Menoid wallet
  const privateWallet = new Wallet(seed);

  // zk secret key = privateKey as decimal bigint string
  const sk = BigInt(privateWallet.privateKey).toString();

  // zk public key = poseidon2([3n, sk]) — same as circomlibjs: poseidon.F.toString(poseidon([3, sk]))
  const pk = poseidon2([3n, BigInt(sk)]).toString();

  return {
    address: privateWallet.address,
    privateKey: privateWallet.privateKey,
    publicKey: SigningKey.computePublicKey(privateWallet.privateKey, false),
    zkSecretKey: sk,
    zkPublicKey: pk,
  };
}

// ─── Full wallet generators ───────────────────────────────────────────────────

/**
 * Generate a brand new wallet.
 * Returns a random mnemonic + both normal and noid accounts.
 */
export function generateNewWallet(): FullWallet {
  const wallet = Wallet.createRandom();
  const mnemonic = wallet.mnemonic?.phrase;
  if (!mnemonic) throw new Error("Failed to generate mnemonic");

  const normalAccount = deriveNormalAccount(mnemonic);
  const noidAccount = deriveNoidAccount(normalAccount.privateKey);

  return { normalAccount, noidAccount, seedPhrase: mnemonic };
}

/**
 * Generate a mnemonic only — no derivation yet, for showing instantly in UI.
 */
export function generateMnemonicOnly(): { mnemonic: string } {
  console.log("ethers =", ethers)
  console.log("Wallet =", ethers.Wallet)
  const wallet = ethers.Wallet.createRandom();
  const mnemonic = wallet.mnemonic?.phrase;
  if (!mnemonic) throw new Error("Failed to generate mnemonic");
  return { mnemonic };
}

/**
 * Derive full wallet from an existing mnemonic (import by seed phrase).
 */
export function importFromMnemonic(phrase: string): FullWallet {
  const normalAccount = deriveNormalAccount(phrase);
  const noidAccount = deriveNoidAccount(normalAccount.privateKey);
  return { normalAccount, noidAccount, seedPhrase: phrase.trim() };
}

/**
 * Derive full wallet from a raw private key (import by private key).
 */
export function importFromPrivateKey(pk: string): FullWallet {
  const normalAccount = deriveNormalAccountFromPrivateKey(pk);
  const noidAccount = deriveNoidAccount(normalAccount.privateKey);
  return { normalAccount, noidAccount };
}