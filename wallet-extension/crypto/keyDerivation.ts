/**
 * keyDerivation.ts
 *
 * Register / user-commitment architecture.
 *
 * There is NO separate "noid wallet" address anymore. Both open mode and noid
 * mode show the SAME real address. The `noidAccount` (and per-chain variants)
 * carry only the derived cryptographic material — never shown in the UI:
 *
 *   The REAL wallet signs the message "menoid_Wallet" once; from that signature:
 *     - spending keypair (BabyJubJub): sk = H("menoid/spend" ‖ sig) mod l,
 *       pk = sk·Base8
 *     - encryption keypair:            H("menoid/encryption" ‖ sig)
 *       (used only to encrypt/decrypt notes — never an on-chain account)
 *
 *   userCommitment = Poseidon(address mod p, spendPk.x, spendPk.y)
 *
 * The StoredWallet noid fields map as:
 *   address      → the REAL wallet address (same as the base account)
 *   privateKey   → encryption private key   (note decryption)
 *   publicKey    → encryption public key    (note encryption)
 *   zkSecretKey  → spend private key         (nullifiers)
 *   zkPublicKey  → userCommitment            (commitments / receiver identity)
 */

import { ethers } from "ethers";
import { poseidon3 } from "poseidon-lite";
import { buildBabyjub } from "circomlibjs";
import nacl from "tweetnacl";
import {
  Wallet,
  SigningKey,
  keccak256,
  solidityPackedKeccak256,
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

const REGISTRATION_MESSAGE = "menoid_Wallet";

// BabyJubJub prime subgroup order (l)
const BABYJUB_SUBGROUP_ORDER =
  2736030358979909402780800718157159386076813972158567259200215660948447373041n;

// BN254 scalar field prime
const BN254_P =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NormalAccount {
  address: string;
  privateKey: string;
  publicKey: string;
}

export interface NoidAccount {
  address: string;      // the REAL wallet address (never a separate address)
  privateKey: string;   // encryption private key
  publicKey: string;    // encryption public key
  zkSecretKey: string;  // BabyJubJub spending private key
  zkPublicKey: string;  // userCommitment (decimal)
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

// ─── Poseidon / BabyJubJub helpers ──────────────────────────────────────────────

let _babyjub: any = null;
async function getBabyjub() {
  if (!_babyjub) _babyjub = await buildBabyjub();
  return _babyjub;
}

async function spendKeysFromScalarSeed(skBig: bigint): Promise<{
  privateKey: string;
  publicKey: { x: string; y: string };
}> {
  const babyJub = await getBabyjub();
  const sk = skBig % BABYJUB_SUBGROUP_ORDER;
  const pkPoint = babyJub.mulPointEscalar(babyJub.Base8, sk);
  return {
    privateKey: sk.toString(),
    publicKey: {
      x: babyJub.F.toString(pkPoint[0]),
      y: babyJub.F.toString(pkPoint[1])
    }
  };
}

function computeUserCommitment(
  addressField: string,
  spendPublicKey: { x: string; y: string }
): string {
  return poseidon3([
    BigInt(addressField),
    BigInt(spendPublicKey.x),
    BigInt(spendPublicKey.y)
  ]).toString();
}

function sha256Concat(tag: string, sig: Uint8Array): Uint8Array {
  // WebCrypto is async; use ethers sha256 over concatenated bytes (sync).
  const tagBytes = toUtf8Bytes(tag);
  const buf = new Uint8Array(tagBytes.length + sig.length);
  buf.set(tagBytes, 0);
  buf.set(sig, tagBytes.length);
  return ethers.getBytes(ethers.sha256(buf));
}

// ─── Base accounts (unchanged) ──────────────────────────────────────────────────

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

// ─── EVM noid account (from the real EVM private key) ────────────────────────────

export async function deriveNoidAccount(normalPrivateKey: string): Promise<NoidAccount> {
  const realWallet = new Wallet(normalPrivateKey.trim());
  const signature = await realWallet.signMessage(REGISTRATION_MESSAGE);

  const spendSk = BigInt(
    solidityPackedKeccak256(["string", "bytes"], ["menoid/spend", signature])
  );
  const spend = await spendKeysFromScalarSeed(spendSk);

  const encPrivateKey = solidityPackedKeccak256(
    ["string", "bytes"],
    ["menoid/encryption", signature]
  );

  const addressField = BigInt(realWallet.address).toString();
  const userCommitment = computeUserCommitment(addressField, spend.publicKey);

  return {
    address: realWallet.address,               // SAME as the open-mode address
    privateKey: encPrivateKey,
    publicKey: SigningKey.computePublicKey(encPrivateKey, false),
    zkSecretKey: spend.privateKey,
    zkPublicKey: userCommitment,
  };
}

// ─── Solana ─────────────────────────────────────────────────────────────────────

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
    if (decoded.length === 64) keypair = Keypair.fromSecretKey(decoded);
    else if (decoded.length === 32) keypair = Keypair.fromSeed(decoded);
    else throw new Error("Invalid Solana private key length");
  } catch (e) {
    const cleanPk = privateKey.replace(/^0x/, "").trim();
    const decoded = Uint8Array.from(Buffer.from(cleanPk, "hex"));
    if (decoded.length === 64) keypair = Keypair.fromSecretKey(decoded);
    else if (decoded.length === 32) keypair = Keypair.fromSeed(decoded);
    else throw new Error("Invalid Solana private key format");
  }
  return {
    address: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
    publicKey: keypair.publicKey.toBase58(),
  };
}

export async function deriveSolanaNoidAccount(privateKeyBase58: string): Promise<NoidAccount> {
  const keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58.trim()));
  const signature = nacl.sign.detached(
    new TextEncoder().encode(REGISTRATION_MESSAGE),
    keypair.secretKey
  );

  const spend = await spendKeysFromScalarSeed(
    BigInt(ethers.hexlify(sha256Concat("menoid/spend", signature)))
  );

  const encSeed = sha256Concat("menoid/encryption", signature);
  const encKeypair = nacl.sign.keyPair.fromSeed(encSeed);

  const address = keypair.publicKey.toBase58();
  const addressField = (
    BigInt(ethers.hexlify(keypair.publicKey.toBytes())) % BN254_P
  ).toString();
  const userCommitment = computeUserCommitment(addressField, spend.publicKey);

  return {
    address,
    privateKey: bs58.encode(Buffer.from(encKeypair.secretKey)),
    publicKey: bs58.encode(Buffer.from(encKeypair.publicKey)),
    zkSecretKey: spend.privateKey,
    zkPublicKey: userCommitment,
  };
}

// ─── Sui ──────────────────────────────────────────────────────────────────────

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
    const { secretKey } = decodeSuiPrivateKey(trimmed);
    keypair = Ed25519Keypair.fromSecretKey(secretKey);
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

export async function deriveSuiNoidAccount(privateKeyBech32OrBase64: string): Promise<NoidAccount> {
  const trimmed = privateKeyBech32OrBase64.trim();
  const seed = trimmed.startsWith("suiprivkey")
    ? decodeSuiPrivateKey(trimmed).secretKey
    : fromBase64(trimmed);
  const keypair = Ed25519Keypair.fromSecretKey(seed);

  const naclKeypair = nacl.sign.keyPair.fromSeed(seed);
  const signature = nacl.sign.detached(
    new TextEncoder().encode(REGISTRATION_MESSAGE),
    naclKeypair.secretKey
  );

  const spend = await spendKeysFromScalarSeed(
    BigInt(ethers.hexlify(sha256Concat("menoid/spend", signature)))
  );

  const encSeed = sha256Concat("menoid/encryption", signature);
  const encKeypair = Ed25519Keypair.fromSecretKey(encSeed);

  const address = keypair.getPublicKey().toSuiAddress();
  const addressField = (BigInt(address) % BN254_P).toString();
  const userCommitment = computeUserCommitment(addressField, spend.publicKey);

  return {
    address,
    privateKey: encKeypair.getSecretKey(),
    publicKey: encKeypair.getPublicKey().toBase64(),
    zkSecretKey: spend.privateKey,
    zkPublicKey: userCommitment,
  };
}

// ─── Aptos ──────────────────────────────────────────────────────────────────────

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

export async function deriveAptosNoidAccount(privateKeyHex: string): Promise<NoidAccount> {
  const account = Account.fromPrivateKey({
    privateKey: new Ed25519PrivateKey(privateKeyHex.trim().replace(/^0x/, ""))
  });
  const signature = account
    .sign(new TextEncoder().encode(REGISTRATION_MESSAGE))
    .toUint8Array();

  const spend = await spendKeysFromScalarSeed(
    BigInt(ethers.hexlify(sha256Concat("menoid/spend", signature)))
  );

  const encSeed = sha256Concat("menoid/encryption", signature);
  const encKeypair = nacl.sign.keyPair.fromSeed(encSeed);
  const toHex = (bytes: Uint8Array) => "0x" + Buffer.from(bytes).toString("hex");

  const address = account.accountAddress.toString();
  const addressField = (BigInt(address) % BN254_P).toString();
  const userCommitment = computeUserCommitment(addressField, spend.publicKey);

  return {
    address,
    privateKey: toHex(encKeypair.secretKey),
    publicKey: toHex(encKeypair.publicKey),
    zkSecretKey: spend.privateKey,
    zkPublicKey: userCommitment,
  };
}

// ─── Full wallet generators (async — noid derivation uses BabyJubJub) ────────────

export async function generateNewWallet(): Promise<FullWallet> {
  const wallet = Wallet.createRandom();
  const mnemonic = wallet.mnemonic?.phrase;
  if (!mnemonic) throw new Error("Failed to generate mnemonic");
  return importFromMnemonic(mnemonic);
}

export function generateMnemonicOnly(): { mnemonic: string } {
  const wallet = Wallet.createRandom();
  const mnemonic = wallet.mnemonic?.phrase;
  if (!mnemonic) throw new Error("Failed to generate mnemonic");
  return { mnemonic };
}

export async function importFromMnemonic(phrase: string): Promise<FullWallet> {
  const normalAccount = deriveNormalAccount(phrase);
  const noidAccount = await deriveNoidAccount(normalAccount.privateKey);
  const solanaAccount = deriveSolanaAccount(phrase);
  const solanaNoidAccount = await deriveSolanaNoidAccount(solanaAccount.privateKey);
  const suiAccount = deriveSuiAccount(phrase);
  const suiNoidAccount = await deriveSuiNoidAccount(suiAccount.privateKey);
  const aptosAccount = deriveAptosAccount(phrase);
  const aptosNoidAccount = await deriveAptosNoidAccount(aptosAccount.privateKey);

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

export async function importFromPrivateKey(
  pk: string,
  network: "ethereum" | "solana" | "sui" | "aptos" = "ethereum"
): Promise<FullWallet> {
  if (network === "ethereum") {
    const normalAccount = deriveNormalAccountFromPrivateKey(pk);
    const noidAccount = await deriveNoidAccount(normalAccount.privateKey);
    return { normalAccount, noidAccount, importedNetwork: "ethereum" };
  } else if (network === "solana") {
    const solanaAccount = deriveSolanaAccountFromPrivateKey(pk);
    const solanaNoidAccount = await deriveSolanaNoidAccount(solanaAccount.privateKey);
    return { solanaAccount, solanaNoidAccount, importedNetwork: "solana" };
  } else if (network === "sui") {
    const suiAccount = deriveSuiAccountFromPrivateKey(pk);
    const suiNoidAccount = await deriveSuiNoidAccount(suiAccount.privateKey);
    return { suiAccount, suiNoidAccount, importedNetwork: "sui" };
  } else if (network === "aptos") {
    const aptosAccount = deriveAptosAccountFromPrivateKey(pk);
    const aptosNoidAccount = await deriveAptosNoidAccount(aptosAccount.privateKey);
    return { aptosAccount, aptosNoidAccount, importedNetwork: "aptos" };
  }
  throw new Error("Invalid network for private key import");
}
