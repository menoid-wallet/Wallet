/**
 * background.ts
 */

export {}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("tabs/welcome.html")
    })
  }
})

// enable sidepanel support
chrome.sidePanel
  .setPanelBehavior({
    openPanelOnActionClick: true
  })
  .catch(console.error)

