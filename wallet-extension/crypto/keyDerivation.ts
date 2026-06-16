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
  solanaNoidAccount?: NoidAccount;
  suiAccount?: { address: string; privateKey: string; publicKey: string };
  suiNoidAccount?: NoidAccount;
  aptosAccount?: { address: string; privateKey: string; publicKey: string };
  aptosNoidAccount?: NoidAccount;
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

export function deriveSolanaNoidAccount(privateKeyBase58: string): NoidAccount {
  const seedInput = privateKeyBase58.trim() + "Menoid wallet";
  const hashHex = ethers.sha256(ethers.toUtf8Bytes(seedInput));
  const hashBytes = ethers.getBytes(hashHex);

  const keypair = Keypair.fromSeed(hashBytes);
  const address = keypair.publicKey.toBase58();
  const privateKey = bs58.encode(keypair.secretKey);
  const publicKey = keypair.publicKey.toBase58();

  const sk = BigInt(hashHex).toString();
  const pk = poseidon2([3n, BigInt(sk)]).toString();

  return {
    address,
    privateKey,
    publicKey,
    zkSecretKey: sk,
    zkPublicKey: pk,
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

export function deriveSuiNoidAccount(privateKeyBech32OrBase64: string): NoidAccount {
  const seedInput = privateKeyBech32OrBase64.trim() + "Menoid wallet";
  const hashHex = ethers.sha256(ethers.toUtf8Bytes(seedInput));
  const hashBytes = ethers.getBytes(hashHex);

  const keypair = Ed25519Keypair.fromSecretKey(hashBytes);
  const address = keypair.getPublicKey().toSuiAddress();
  const privateKey = keypair.getSecretKey();
  const publicKey = keypair.getPublicKey().toBase64();

  const sk = BigInt(hashHex).toString();
  const pk = poseidon2([3n, BigInt(sk)]).toString();

  return {
    address,
    privateKey,
    publicKey,
    zkSecretKey: sk,
    zkPublicKey: pk,
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

export function deriveAptosNoidAccount(privateKeyHex: string): NoidAccount {
  const seedInput = privateKeyHex.trim() + "Menoid wallet";
  const hashHex = ethers.sha256(ethers.toUtf8Bytes(seedInput));
  const hashBytes = ethers.getBytes(hashHex);

  const privateKeyObj = new Ed25519PrivateKey(hashBytes);
  const account = Account.fromPrivateKey({ privateKey: privateKeyObj });
  const address = account.accountAddress.toString();

  const toHex = (bytes: Uint8Array) => "0x" + Buffer.from(bytes).toString("hex");
  const privateKey = toHex(privateKeyObj.toUint8Array());
  const publicKey = toHex(privateKeyObj.publicKey().toUint8Array());

  const sk = BigInt(hashHex).toString();
  const pk = poseidon2([3n, BigInt(sk)]).toString();

  return {
    address,
    privateKey,
    publicKey,
    zkSecretKey: sk,
    zkPublicKey: pk,
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
  const solanaNoidAccount = deriveSolanaNoidAccount(solanaAccount.privateKey);
  const suiAccount = deriveSuiAccount(mnemonic);
  const suiNoidAccount = deriveSuiNoidAccount(suiAccount.privateKey);
  const aptosAccount = deriveAptosAccount(mnemonic);
  const aptosNoidAccount = deriveAptosNoidAccount(aptosAccount.privateKey);

  return {
    normalAccount,
    noidAccount,
    solanaAccount,
    solanaNoidAccount,
    suiAccount,
    suiNoidAccount,
    aptosAccount,
    aptosNoidAccount,
    seedPhrase: mnemonic
  };
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
  const solanaNoidAccount = deriveSolanaNoidAccount(solanaAccount.privateKey);
  const suiAccount = deriveSuiAccount(phrase);
  const suiNoidAccount = deriveSuiNoidAccount(suiAccount.privateKey);
  const aptosAccount = deriveAptosAccount(phrase);
  const aptosNoidAccount = deriveAptosNoidAccount(aptosAccount.privateKey);

  return {
    normalAccount,
    noidAccount,
    solanaAccount,
    solanaNoidAccount,
    suiAccount,
    suiNoidAccount,
    aptosAccount,
    aptosNoidAccount,
    seedPhrase: phrase.trim()
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
    const solanaNoidAccount = deriveSolanaNoidAccount(solanaAccount.privateKey);
    return { solanaAccount, solanaNoidAccount, importedNetwork: "solana" };
  } else if (network === "sui") {
    const suiAccount = deriveSuiAccountFromPrivateKey(pk);
    const suiNoidAccount = deriveSuiNoidAccount(suiAccount.privateKey);
    return { suiAccount, suiNoidAccount, importedNetwork: "sui" };
  } else if (network === "aptos") {
    const aptosAccount = deriveAptosAccountFromPrivateKey(pk);
    const aptosNoidAccount = deriveAptosNoidAccount(aptosAccount.privateKey);
    return { aptosAccount, aptosNoidAccount, importedNetwork: "aptos" };
  }
  throw new Error("Invalid network for private key import");
}