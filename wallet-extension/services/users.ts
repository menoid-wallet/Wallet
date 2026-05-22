/**
 * users.ts
 *
 * Tiny client for the backend identity endpoints.
 *
 *   GET  /users/all          → all open users        (User schema)
 *   POST /users/create       → { name, realAddress }
 *   GET  /noidusers/all      → all noid users        (NoidModeUser schema)
 *   POST /noidusers/create   → { name, noidModePublicKey, zkPublicKey }
 *
 * All "name" values are the .meno username (e.g. "captain.meno").
 */

import { BASE_URL } from "./api"

export interface OpenUser {
  _id: string
  name: string
  realAddress: string
  createdAt?: string
  updatedAt?: string
}

export interface NoidUser {
  _id: string
  name: string
  noidModePublicKey: string
  zkPublicKey: string
  createdAt?: string
  updatedAt?: string
}

export async function listOpenUsers(): Promise<OpenUser[]> {
  const res = await fetch(`${BASE_URL}/users/all`)
  if (!res.ok) throw new Error(`Failed to list open users (${res.status})`)
  return res.json()
}

export async function listNoidUsers(): Promise<NoidUser[]> {
  const res = await fetch(`${BASE_URL}/noidusers/all`)
  if (!res.ok) throw new Error(`Failed to list noid users (${res.status})`)
  return res.json()
}

export async function createOpenUser(input: {
  name: string
  realAddress: string
}): Promise<OpenUser> {
  const res = await fetch(`${BASE_URL}/users/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error(errBody?.error ?? `Failed to create open user (${res.status})`)
  }
  return res.json()
}

export async function createNoidUserApi(input: {
  name: string
  noidModePublicKey: string
  zkPublicKey: string
}): Promise<NoidUser> {
  const res = await fetch(`${BASE_URL}/noidusers/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error(errBody?.error ?? `Failed to create noid user (${res.status})`)
  }
  return res.json()
}

export async function isOpenRegistered(realAddress: string): Promise<{
  registered: boolean
  match: OpenUser | null
}> {
  const all = await listOpenUsers()
  const lower = realAddress.toLowerCase()
  const match = all.find((u) => (u.realAddress ?? "").toLowerCase() === lower) ?? null
  return { registered: !!match, match }
}

export async function isNoidRegistered(noidModePublicKey: string): Promise<{
  registered: boolean
  match: NoidUser | null
}> {
  const all = await listNoidUsers()
  const lower = noidModePublicKey.toLowerCase()
  const match = all.find((u) => (u.noidModePublicKey ?? "").toLowerCase() === lower) ?? null
  return { registered: !!match, match }
}

/**
 * Check if a .meno username is already taken in the Open users list.
 * Returns true if available, false if taken.
 */
export async function checkOpenNameAvailable(name: string): Promise<boolean> {
  const all = await listOpenUsers()
  const lower = name.toLowerCase()
  return !all.some((u) => (u.name ?? "").toLowerCase() === lower)
}

/**
 * Check if a .meno username is already taken in the Noid users list.
 * Returns true if available, false if taken.
 */
export async function checkNoidNameAvailable(name: string): Promise<boolean> {
  const all = await listNoidUsers()
  const lower = name.toLowerCase()
  return !all.some((u) => (u.name ?? "").toLowerCase() === lower)
}

/**
 * One-shot helper used by the Create / Import / Add flows.
 * Uses the given openAccountName / noidAccountName (already with .meno)
 * as the registered username for each account type.
 */
export async function ensureIdentities(opts: {
  realAddress: string
  noidModePublicKey: string
  zkPublicKey: string
  registerOpen: boolean
  registerNoid: boolean
  openAccountName?: string   // .meno username for open account
  noidAccountName?: string   // .meno username for noid account
}): Promise<{ registeredOpen: boolean; registeredNoid: boolean }> {
  const { registered: openExists } = await isOpenRegistered(opts.realAddress)
  const { registered: noidExists } = await isNoidRegistered(opts.noidModePublicKey)

  let registeredOpen = openExists
  let registeredNoid = noidExists

  if (!openExists && opts.registerOpen && opts.openAccountName) {
    try {
      await createOpenUser({
        name: opts.openAccountName,
        realAddress: opts.realAddress
      })
      registeredOpen = true
    } catch (e: any) {
      if (String(e?.message ?? "").toLowerCase().includes("already exists")) {
        registeredOpen = true
      } else {
        throw e
      }
    }
  }

  if (!noidExists && opts.registerNoid && opts.noidAccountName) {
    try {
      await createNoidUserApi({
        name: opts.noidAccountName,
        noidModePublicKey: opts.noidModePublicKey,
        zkPublicKey: opts.zkPublicKey
      })
      registeredNoid = true
    } catch (e: any) {
      if (String(e?.message ?? "").toLowerCase().includes("already exists")) {
        registeredNoid = true
      } else {
        throw e
      }
    }
  }

  return { registeredOpen, registeredNoid }
}