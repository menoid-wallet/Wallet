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
 * Solana, Sui, and Aptos accounts derived using their respective BIP44 paths.
 */

import { ethers } from "ethers";
import { poseidon2 } from "poseidon-lite";
import {
  Wallet,
  SigningKey,
  keccak256,
  toUtf8Bytes
} from "ethers";
import { Keypair } from "@solana/web3.js";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { fromBase64 } from "@mysten/sui/utils";
import { Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import * as bip39 from "bip39";
import { derivePath } from "ed25519-hd-key";
import bs58 from "bs58";

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
  normalAccount?: NormalAccount;
  noidAccount?: NoidAccount;
  solanaAccount?: { address: string; privateKey: string; publicKey: string };
  suiAccount?: { address: string; privateKey: string; publicKey: string };
  aptosAccount?: { address: string; privateKey: string; publicKey: string };
  seedPhrase?: string;
  importedNetwork?: "ethereum" | "solana" | "sui" | "aptos";
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
  const normalizedPk =
    normalPrivateKey
      .replace(/^0x/, "")
      .toLowerCase();

  const seedInput =
    normalizedPk + "Menoid wallet";

  // deterministic seed via keccak256
  const seed = keccak256(toUtf8Bytes(seedInput));

  // derived Menoid wallet
  const privateWallet = new Wallet(seed);

  // zk secret key = privateKey as decimal bigint string
  const sk = BigInt(privateWallet.privateKey).toString();

  // zk public key = poseidon2([3n, sk])
  const pk = poseidon2([3n, BigInt(sk)]).toString();

  return {
    address: privateWallet.address,
    privateKey: privateWallet.privateKey,
    publicKey: SigningKey.computePublicKey(privateWallet.privateKey, false),
    zkSecretKey: sk,
    zkPublicKey: pk,
  };
}

// ─── Solana Account Derivation ────────────────────────────────────────────────

export function deriveSolanaAccount(seedPhrase: string): { address: string; privateKey: string; publicKey: string } {
  const seed = bip39.mnemonicToSeedSync(seedPhrase.trim());
  const derived = derivePath("m/44'/501'/0'/0'", seed.toString("hex"));
  const keypair = Keypair.fromSeed(derived.key);
  return {
    address: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
    publicKey: keypair.publicKey.toBase58(),
  };
}

export function deriveSolanaAccountFromPrivateKey(privateKey: string): { address: string; privateKey: string; publicKey: string } {
  let keypair: Keypair;
  try {
    const decoded = bs58.decode(privateKey.trim());
    if (decoded.length === 64) {
      keypair = Keypair.fromSecretKey(decoded);
    } else if (decoded.length === 32) {
      keypair = Keypair.fromSeed(decoded);
    } else {
      throw new Error("Invalid Solana private key length");
    }
  } catch (e) {
    // Try hex fallback
    const cleanPk = privateKey.replace(/^0x/, "").trim();
    const decoded = Uint8Array.from(Buffer.from(cleanPk, "hex"));
    if (decoded.length === 64) {
      keypair = Keypair.fromSecretKey(decoded);
    } else if (decoded.length === 32) {
      keypair = Keypair.fromSeed(decoded);
    } else {
      throw new Error("Invalid Solana private key format");
    }
  }
  return {
    address: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
    publicKey: keypair.publicKey.toBase58(),
  };
}

// ─── Sui Account Derivation ───────────────────────────────────────────────────

export function deriveSuiAccount(seedPhrase: string): { address: string; privateKey: string; publicKey: string } {
  const keypair = Ed25519Keypair.deriveKeypair(seedPhrase.trim(), "m/44'/784'/0'/0'/0'");
  return {
    address: keypair.toSuiAddress(),
    privateKey: keypair.getSecretKey(),
    publicKey: keypair.getPublicKey().toBase64(),
  };
}

export function deriveSuiAccountFromPrivateKey(privateKey: string): { address: string; privateKey: string; publicKey: string } {
  let keypair: Ed25519Keypair;
  const trimmed = privateKey.trim();
  if (trimmed.startsWith("suiprivkey")) {
    try {
      const { secretKey } = decodeSuiPrivateKey(trimmed);
      keypair = Ed25519Keypair.fromSecretKey(secretKey);
    } catch (e: any) {
      throw new Error(`Invalid Sui private key format: ${e.message}`);
    }
  } else {
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(trimmed);
    } catch {
      const cleanPk = trimmed.replace(/^0x/, "");
      bytes = Uint8Array.from(Buffer.from(cleanPk, "hex"));
    }
    keypair = Ed25519Keypair.fromSecretKey(bytes);
  }
  return {
    address: keypair.toSuiAddress(),
    privateKey: keypair.getSecretKey(),
    publicKey: keypair.getPublicKey().toBase64(),
  };
}

// ─── Aptos Account Derivation ─────────────────────────────────────────────────

export function deriveAptosAccount(seedPhrase: string): { address: string; privateKey: string; publicKey: string } {
  const account = Account.fromDerivationPath({
    mnemonic: seedPhrase.trim(),
    path: "m/44'/637'/0'/0'/0'",
  });
  return {
    address: account.accountAddress.toString(),
    privateKey: account.privateKey.toString(),
    publicKey: account.publicKey.toString(),
  };
}

export function deriveAptosAccountFromPrivateKey(privateKey: string): { address: string; privateKey: string; publicKey: string } {
  const cleanPk = privateKey.trim().replace(/^0x/, "");
  const pk = new Ed25519PrivateKey(cleanPk);
  const account = Account.fromPrivateKey({ privateKey: pk });
  return {
    address: account.accountAddress.toString(),
    privateKey: account.privateKey.toString(),
    publicKey: account.publicKey.toString(),
  };
}

// ─── Full wallet generators ───────────────────────────────────────────────────

/**
 * Generate a brand new wallet.
 * Returns a random mnemonic + all chain accounts.
 */
export function generateNewWallet(): FullWallet {
  const wallet = Wallet.createRandom();
  const mnemonic = wallet.mnemonic?.phrase;
  if (!mnemonic) throw new Error("Failed to generate mnemonic");

  const normalAccount = deriveNormalAccount(mnemonic);
  const noidAccount = deriveNoidAccount(normalAccount.privateKey);
  const solanaAccount = deriveSolanaAccount(mnemonic);
  const suiAccount = deriveSuiAccount(mnemonic);
  const aptosAccount = deriveAptosAccount(mnemonic);

  return { normalAccount, noidAccount, solanaAccount, suiAccount, aptosAccount, seedPhrase: mnemonic };
}

/**
 * Generate a mnemonic only.
 */
export function generateMnemonicOnly(): { mnemonic: string } {
  const wallet = Wallet.createRandom();
  const mnemonic = wallet.mnemonic?.phrase;
  if (!mnemonic) throw new Error("Failed to generate mnemonic");
  return { mnemonic };
}

/**
 * Derive full wallet from an existing mnemonic.
 */
export function importFromMnemonic(phrase: string): FullWallet {
  const normalAccount = deriveNormalAccount(phrase);
  const noidAccount = deriveNoidAccount(normalAccount.privateKey);
  const solanaAccount = deriveSolanaAccount(phrase);
  const suiAccount = deriveSuiAccount(phrase);
  const aptosAccount = deriveAptosAccount(phrase);
  return { normalAccount, noidAccount, solanaAccount, suiAccount, aptosAccount, seedPhrase: phrase.trim() };
}

function deriveZkKeysFromBytes(pkBytes: Uint8Array): { noidAccount: NoidAccount } {
  const hex = Buffer.from(pkBytes).toString("hex");
  const seedInput = hex + "Menoid wallet";
  const seed = keccak256(toUtf8Bytes(seedInput));
  const privateWallet = new Wallet(seed);
  const sk = BigInt(privateWallet.privateKey).toString();
  const pk = poseidon2([3n, BigInt(sk)]).toString();
  return {
    noidAccount: {
      address: privateWallet.address,
      privateKey: privateWallet.privateKey,
      publicKey: SigningKey.computePublicKey(privateWallet.privateKey, false),
      zkSecretKey: sk,
      zkPublicKey: pk,
    }
  };
}

/**
 * Derive full wallet from a raw private key based on target network selection.
 */
export function importFromPrivateKey(
  pk: string,
  network: "ethereum" | "solana" | "sui" | "aptos" = "ethereum"
): FullWallet {
  if (network === "ethereum") {
    const normalAccount = deriveNormalAccountFromPrivateKey(pk);
    const noidAccount = deriveNoidAccount(normalAccount.privateKey);
    return { normalAccount, noidAccount, importedNetwork: "ethereum" };
  } else if (network === "solana") {
    const solanaAccount = deriveSolanaAccountFromPrivateKey(pk);
    const decoded = bs58.decode(solanaAccount.privateKey);
    const rawSeed = decoded.slice(0, 32);
    const { noidAccount } = deriveZkKeysFromBytes(rawSeed);
    return { solanaAccount, noidAccount, importedNetwork: "solana" };
  } else if (network === "sui") {
    const suiAccount = deriveSuiAccountFromPrivateKey(pk);
    let rawSeed: Uint8Array;
    if (pk.trim().startsWith("suiprivkey")) {
      const { secretKey } = decodeSuiPrivateKey(pk.trim());
      rawSeed = secretKey;
    } else {
      try {
        rawSeed = fromBase64(pk.trim());
      } catch {
        rawSeed = Uint8Array.from(Buffer.from(pk.trim().replace(/^0x/, ""), "hex"));
      }
    }
    const { noidAccount } = deriveZkKeysFromBytes(rawSeed.slice(0, 32));
    return { suiAccount, noidAccount, importedNetwork: "sui" };
  } else if (network === "aptos") {
    const aptosAccount = deriveAptosAccountFromPrivateKey(pk);
    const cleanPk = pk.trim().replace(/^0x/, "");
    const rawSeed = Uint8Array.from(Buffer.from(cleanPk, "hex"));
    const { noidAccount } = deriveZkKeysFromBytes(rawSeed);
    return { aptosAccount, noidAccount, importedNetwork: "aptos" };
  }
  throw new Error("Invalid network for private key import");
}