/**
 * walletCrypto.ts
 * AES-GCM password encryption for the full wallet (normalAccount + noidAccount).
 */

const PBKDF2_ITERATIONS = 200_000;
const SALT_LEN = 16;
const IV_LEN = 12;

function buf2hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hex2buf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const raw = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export interface EncryptedWallet {
  ciphertext: string;
  iv: string;
  salt: string;
}

export interface StoredWallet {
  normalAccount?: {
    address: string;
    privateKey: string;
    publicKey: string;
  };
  noidAccount?: {
    address: string;
    privateKey: string;
    publicKey: string;
    zkSecretKey: string;
    zkPublicKey: string;
  };
  solanaAccount?: {
    address: string;
    privateKey: string;
    publicKey: string;
  };
  solanaNoidAccount?: {
    address: string;
    privateKey: string;
    publicKey: string;
    zkSecretKey: string;
    zkPublicKey: string;
  };
  suiAccount?: {
    address: string;
    privateKey: string;
    publicKey: string;
  };
  suiNoidAccount?: {
    address: string;
    privateKey: string;
    publicKey: string;
    zkSecretKey: string;
    zkPublicKey: string;
  };
  aptosAccount?: {
    address: string;
    privateKey: string;
    publicKey: string;
  };
  aptosNoidAccount?: {
    address: string;
    privateKey: string;
    publicKey: string;
    zkSecretKey: string;
    zkPublicKey: string;
  };
  seedPhrase?: string;
  importedNetwork?: "ethereum" | "solana" | "sui" | "aptos";
}

export async function encryptWallet(
  wallet: StoredWallet,
  password: string
): Promise<EncryptedWallet> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const aesKey = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    enc.encode(JSON.stringify(wallet))
  );
  return { ciphertext: buf2hex(cipherBuf), iv: buf2hex(iv), salt: buf2hex(salt) };
}

export async function decryptWallet(
  encrypted: EncryptedWallet,
  password: string
): Promise<StoredWallet> {
  const salt = hex2buf(encrypted.salt);
  const iv = hex2buf(encrypted.iv);
  const cipher = hex2buf(encrypted.ciphertext);
  const aesKey = await deriveKey(password, salt);
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, cipher);
  } catch {
    throw new Error("Wrong password");
  }
  return JSON.parse(new TextDecoder().decode(plainBuf)) as StoredWallet;
}

export function passwordStrength(pw: string): {
  score: number;
  label: "Too short" | "Weak" | "Fair" | "Strong" | "Very strong";
  color: string;
} {
  if (pw.length < 6) return { score: 0, label: "Too short", color: "#ef4444" };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const map = [
    { score: 0, label: "Too short" as const, color: "#ef4444" },
    { score: 1, label: "Weak" as const, color: "#f97316" },
    { score: 2, label: "Fair" as const, color: "#eab308" },
    { score: 3, label: "Strong" as const, color: "#84cc16" },
    { score: 4, label: "Very strong" as const, color: "#22c55e" },
  ];
  return map[Math.min(s, 4)];
}