/**
 * popup.tsx
 *
 * Flow:
 *  1. Check chrome.storage for menoid_onboarding
 *     → false/missing → open welcome tab
 *  2. Onboarding done → show LockScreen
 *  3. Correct password → decrypt keys → WalletProvider → WalletHome
 */

import React, { useEffect, useState } from "react"
import "./style.css"
import { WalletProvider, useWallet } from "./context/WalletContext"
import LockScreen from "./components/LockScreen"
import WalletHome from "./components/WalletHome"
import type { WalletKeys } from "./crypto/walletCrypto"

type AppState = "loading" | "locked" | "unlocked"

function AppInner() {
  const { keys, unlock } = useWallet()
  const [appState, setAppState] = useState<AppState>("loading")

  useEffect(() => {
    ;(async () => {
      // chrome APIs only exist inside the real extension context.
      // If chrome or chrome.storage is undefined, skip straight to locked
      // so the popup doesn't crash when previewed in a plain browser tab.
      const chromeAvailable =
        typeof chrome !== "undefined" &&
        chrome?.storage?.local !== undefined &&
        chrome?.runtime?.getURL !== undefined

      if (!chromeAvailable) {
        setAppState("locked")
        return
      }

      let onboarding = false
      let wallet: string | null = null

      try {
        const result = await chrome.storage.local.get([
          "menoid_onboarding",
          "menoid_wallet",
        ])
        onboarding = result?.menoid_onboarding ?? false
        wallet = result?.menoid_wallet ?? null
      } catch {
        // storage unavailable — treat as fresh install
      }

      if (!onboarding || !wallet) {
        try {
          chrome.tabs.create({ url: chrome.runtime.getURL("tabs/welcome.html") })
          window.close()
        } catch {
          // If tabs API also fails, just show lock screen
          setAppState("locked")
        }
        return
      }

      setAppState("locked")
    })()
  }, [])

  function handleUnlock(decryptedKeys: WalletKeys) {
    unlock(decryptedKeys)
    setAppState("unlocked")
  }

  if (appState === "loading") {
    return (
      <div className="w-[360px] h-[600px] bg-cream flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative h-12 w-12">
            <div className="absolute inset-0 rounded-full bg-gold/40 blur-lg animate-shimmer" />
            <div className="relative h-12 w-12 rounded-full border border-goldDeep/30 animate-spin border-t-goldDeep" />
          </div>
          <p className="font-serif italic text-[12px] text-ink/40">Loading Menoid…</p>
        </div>
      </div>
    )
  }

  if (appState === "locked" || !keys) {
    return <LockScreen onUnlock={handleUnlock} />
  }

  return <WalletHome />
}

function IndexPopup() {
  return (
    <WalletProvider>
      <AppInner />
    </WalletProvider>
  )
}

export default IndexPopup