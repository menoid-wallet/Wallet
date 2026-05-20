/**
 * viewMode.ts
 * Shared helpers for the popup / sidebar view-mode preference.
 *
 * Storage key: "menoid_view_mode" → "popup" | "sidebar"
 *
 * `openWalletInPreferredMode()` tries the user's preferred mode first, then
 * falls back to the other so the wallet actually opens whenever possible.
 * `chrome.action.openPopup()` is unreliable (Chrome refuses it when the
 * extension isn't pinned, or when the gesture context is lost), so the
 * caller can react to `opened: false` with a manual-click instruction UI.
 */

export const VIEW_MODE_KEY = "menoid_view_mode"
export type ViewMode = "sidebar" | "popup"

export async function getViewMode(): Promise<ViewMode> {
  try {
    const result = await chrome.storage.local.get(VIEW_MODE_KEY)
    return result?.[VIEW_MODE_KEY] === "sidebar" ? "sidebar" : "popup"
  } catch {
    return "popup"
  }
}

export async function setViewMode(mode: ViewMode): Promise<void> {
  await chrome.storage.local.set({ [VIEW_MODE_KEY]: mode })
}

export async function applyChromeBehaviour(mode: ViewMode): Promise<void> {
  const sidebar = mode === "sidebar"
  await chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: sidebar })
    .catch(console.error)
  await chrome.action
    .setPopup({ popup: sidebar ? "" : "popup.html" })
    .catch(console.error)
}

async function tryOpenSidepanel(): Promise<boolean> {
  try {
    const win = await chrome.windows.getCurrent()
    if (win?.id !== undefined) {
      await chrome.sidePanel.open({ windowId: win.id })
      return true
    }
  } catch (e) {
    console.error("sidePanel.open failed:", e)
  }
  return false
}

async function tryOpenPopup(): Promise<boolean> {
  try {
    await chrome.action.openPopup()
    return true
  } catch (e) {
    console.error("action.openPopup failed:", e)
    return false
  }
}

export type OpenResult = {
  opened: boolean
  openedAs?: ViewMode
  preferred: ViewMode
}

export async function openWalletInPreferredMode(): Promise<OpenResult> {
  const preferred = await getViewMode()

  if (preferred === "sidebar") {
    if (await tryOpenSidepanel()) return { opened: true, openedAs: "sidebar", preferred }
    if (await tryOpenPopup()) return { opened: true, openedAs: "popup", preferred }
    return { opened: false, preferred }
  }

  // popup preferred
  if (await tryOpenPopup()) return { opened: true, openedAs: "popup", preferred }
  // fall back to sidepanel so the wallet still opens somewhere reliable
  if (await tryOpenSidepanel()) return { opened: true, openedAs: "sidebar", preferred }
  return { opened: false, preferred }
}

/** Explicit single-mode openers for the toggle UI. */
export async function openSidepanelNow(): Promise<boolean> {
  return tryOpenSidepanel()
}
export async function openPopupNow(): Promise<boolean> {
  return tryOpenPopup()
}
