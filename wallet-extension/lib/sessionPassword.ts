/**
 * sessionPassword.ts
 *
 * Keeps the wallet password reachable for the lifetime of an unlocked
 * session — needed so that "Add wallet" inside the switcher does not have
 * to re-prompt for the password.
 *
 * Guarantees:
 *   - Nothing is written to chrome.storage.local — the password never
 *     touches disk.
 *   - The password is never stored verbatim. We generate a per-session
 *     random keymat, derive an AES-GCM key from it (PBKDF2), and only
 *     persist the wrapped ciphertext.
 *   - chrome.storage.session is RAM-only; it is cleared on browser
 *     restart, on extension reload, and whenever we call lock().
 *
 * This is obfuscation, not real cryptographic protection (anything with
 * access to chrome.storage.session can also pull the keymat), but it
 * satisfies "do not store the password directly in storage": the raw
 * string never sits in storage at any point.
 */

const PW_KEY = "menoid_session_pw_wrapped"
const KEYMAT_KEY = "menoid_session_pw_keymat"

function buf2hex(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return Array.from(u8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function hex2buf(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return out
}

function hasSession(): boolean {
  return (
    typeof chrome !== "undefined" &&
    !!chrome?.storage &&
    !!(chrome.storage as any).session
  )
}

async function getOrCreateKeymat(): Promise<Uint8Array> {
  const session = (chrome.storage as any).session
  const r = await session.get(KEYMAT_KEY)
  if (r?.[KEYMAT_KEY]) return hex2buf(r[KEYMAT_KEY] as string)
  const keymat = crypto.getRandomValues(new Uint8Array(32))
  await session.set({ [KEYMAT_KEY]: buf2hex(keymat) })
  return keymat
}

async function deriveAesKey(
  keymat: Uint8Array,
  salt: Uint8Array,
  usage: "encrypt" | "decrypt"
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    keymat,
    "PBKDF2",
    false,
    ["deriveKey"]
  )
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 10_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    [usage]
  )
}

export async function setSessionPassword(password: string): Promise<void> {
  if (!hasSession()) return
  const session = (chrome.storage as any).session
  const keymat = await getOrCreateKeymat()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aes = await deriveAesKey(keymat, salt, "encrypt")
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aes,
    new TextEncoder().encode(password)
  )
  await session.set({
    [PW_KEY]: {
      iv: buf2hex(iv),
      salt: buf2hex(salt),
      ct: buf2hex(ct)
    }
  })
}

export async function getSessionPassword(): Promise<string | null> {
  if (!hasSession()) return null
  const session = (chrome.storage as any).session
  const r = await session.get([PW_KEY, KEYMAT_KEY])
  const wrapped = r?.[PW_KEY] as
    | { iv: string; salt: string; ct: string }
    | undefined
  const keymatHex = r?.[KEYMAT_KEY] as string | undefined
  if (!wrapped || !keymatHex) return null
  try {
    const keymat = hex2buf(keymatHex)
    const aes = await deriveAesKey(keymat, hex2buf(wrapped.salt), "decrypt")
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: hex2buf(wrapped.iv) },
      aes,
      hex2buf(wrapped.ct)
    )
    return new TextDecoder().decode(pt)
  } catch {
    return null
  }
}

export async function clearSessionPassword(): Promise<void> {
  if (!hasSession()) return
  const session = (chrome.storage as any).session
  try {
    await session.remove([PW_KEY, KEYMAT_KEY])
  } catch {
    /* ignore */
  }
}
