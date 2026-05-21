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
 * The "registered?" helpers are list-based (fetch all + scan). Cheap
 * enough for the current scale; can be upgraded to dedicated lookup
 * endpoints later without changing the call sites.
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
    throw new Error(
      errBody?.error ?? `Failed to create open user (${res.status})`
    )
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
    throw new Error(
      errBody?.error ?? `Failed to create noid user (${res.status})`
    )
  }
  return res.json()
}

export async function isOpenRegistered(realAddress: string): Promise<{
  registered: boolean
  match: OpenUser | null
}> {
  const all = await listOpenUsers()
  const lower = realAddress.toLowerCase()
  const match =
    all.find((u) => (u.realAddress ?? "").toLowerCase() === lower) ?? null
  return { registered: !!match, match }
}

export async function isNoidRegistered(noidModePublicKey: string): Promise<{
  registered: boolean
  match: NoidUser | null
}> {
  const all = await listNoidUsers()
  const lower = noidModePublicKey.toLowerCase()
  const match =
    all.find((u) => (u.noidModePublicKey ?? "").toLowerCase() === lower) ?? null
  return { registered: !!match, match }
}

/**
 * One-shot helper used by the Create / Import / Add flows.
 *
 * Inspects both backends, then for each side that is missing — and only
 * after the user has agreed — POSTs the new identity. Returns the final
 * registration flags so callers can stash them on the wallet entry.
 */
export async function ensureIdentities(opts: {
  name: string
  realAddress: string
  noidModePublicKey: string
  zkPublicKey: string
  registerOpen: boolean
  registerNoid: boolean
}): Promise<{ registeredOpen: boolean; registeredNoid: boolean }> {
  const { registered: openExists } = await isOpenRegistered(opts.realAddress)
  const { registered: noidExists } = await isNoidRegistered(
    opts.noidModePublicKey
  )

  let registeredOpen = openExists
  let registeredNoid = noidExists

  if (!openExists && opts.registerOpen) {
    try {
      await createOpenUser({ name: opts.name, realAddress: opts.realAddress })
      registeredOpen = true
    } catch (e: any) {
      // "already exists" is a tolerated race
      if (String(e?.message ?? "").toLowerCase().includes("already exists")) {
        registeredOpen = true
      } else {
        throw e
      }
    }
  }

  if (!noidExists && opts.registerNoid) {
    try {
      await createNoidUserApi({
        name: opts.name,
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
