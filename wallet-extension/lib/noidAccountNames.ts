/**
 * noidAccountNames.ts
 *
 * Local (chrome.storage.local) persistence for Noid Smart Account names.
 * Names are stored as a flat map: commitment (decimal string) → display name.
 * This never touches the backend or PoolContext — purely local wallet labels.
 *
 * Storage key: "noid_account_names"
 * Value: JSON string of Record<string, string>
 */

const STORAGE_KEY = "noid_account_names"

/** Read the full commitment→name map from local storage. */
export async function readNoidAccountNames(): Promise<Record<string, string>> {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY)
    if (r?.[STORAGE_KEY]) {
      return JSON.parse(r[STORAGE_KEY]) as Record<string, string>
    }
  } catch {
    /* ignore */
  }
  return {}
}

/** Write (upsert) a name for a given commitment. */
export async function writeNoidAccountName(commitment: string, name: string): Promise<void> {
  try {
    const current = await readNoidAccountNames()
    if (name.trim()) {
      current[commitment] = name.trim()
    } else {
      delete current[commitment]
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: JSON.stringify(current) })
  } catch {
    /* ignore */
  }
}

/** Delete the name for a given commitment (e.g. if account is removed). */
export async function deleteNoidAccountName(commitment: string): Promise<void> {
  try {
    const current = await readNoidAccountNames()
    delete current[commitment]
    await chrome.storage.local.set({ [STORAGE_KEY]: JSON.stringify(current) })
  } catch {
    /* ignore */
  }
}