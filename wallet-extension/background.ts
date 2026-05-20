/**
 * background.ts
 * Handles extension install → open welcome tab.
 * Crypto (poseidon-lite) runs directly in the UI — no worker needed.
 */

export {};

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("tabs/welcome.html") });
  }
});