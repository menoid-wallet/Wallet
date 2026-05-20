/**
 * background.ts
 *
 * - Opens the welcome tab on first install.
 * - Persists the user's view-mode preference ("sidebar" | "popup") and applies
 *   the matching Chrome behaviour on install, browser startup, and on every
 *   storage change.
 * - Defaults to "popup" on install so the toggle starts in the correct state.
 */

import {
  VIEW_MODE_KEY,
  applyChromeBehaviour,
  getViewMode,
  setViewMode
} from "./lib/viewMode"

export {}

async function applyFromStorage() {
  const mode = await getViewMode()
  await applyChromeBehaviour(mode)
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("tabs/welcome.html")
    })
    // seed a definite default so the toggle UI is accurate from first open
    await setViewMode("popup")
  }
  await applyFromStorage()
})

chrome.runtime.onStartup.addListener(() => {
  applyFromStorage()
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[VIEW_MODE_KEY]) {
    applyFromStorage()
  }
})
