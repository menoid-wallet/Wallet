import React, { useEffect, useState } from "react"
import "./style.css"
import { WalletProvider, useWallet } from "./context/WalletContext"
import LockScreen from "./components/LockScreen"
import WalletHome from "./components/WalletHome"
import type { StoredWallet } from "./crypto/walletCrypto"

type AppState = "loading" | "locked" | "unlocked"

function AppInner() {
  const { wallet, unlock } = useWallet()
  const [appState, setAppState] = useState<AppState>("loading")

  useEffect(() => {
    ;(async () => {
      const chromeAvailable =
        typeof chrome !== "undefined" &&
        chrome?.storage?.local !== undefined &&
        chrome?.runtime?.getURL !== undefined

      if (!chromeAvailable) {
        setAppState("locked")
        return
      }

      let onboarding = false
      let storedWallet: string | null = null

      try {
        const result = await chrome.storage.local.get([
          "menoid_onboarding",
          "menoid_wallet"
        ])

        onboarding = result?.menoid_onboarding ?? false
        storedWallet = result?.menoid_wallet ?? null
      } catch {}

      if (!onboarding || !storedWallet) {
        try {
          chrome.tabs.create({
            url: chrome.runtime.getURL("tabs/welcome.html")
          })

          window.close()
        } catch {
          setAppState("locked")
        }

        return
      }

      setAppState("locked")
    })()
  }, [])

  function handleUnlock(w: StoredWallet) {
    unlock(w)
    setAppState("unlocked")
  }

  if (appState === "loading") {
    return (
      <div className="w-full h-full bg-cream flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative h-12 w-12">
            <div className="absolute inset-0 rounded-full bg-gold/40 blur-lg animate-shimmer" />
            <div className="relative h-12 w-12 rounded-full border border-goldDeep/30 animate-spin border-t-goldDeep" />
          </div>

          <p className="font-serif italic text-[12px] text-ink/40">
            Loading Menoid…
          </p>
        </div>
      </div>
    )
  }

  if (appState === "locked" || !wallet) {
    return <LockScreen onUnlock={handleUnlock} />
  }

  return <WalletHome />
}

function SidePanel() {
  return (
    <WalletProvider>
      <AppInner />
    </WalletProvider>
  )
}

export default SidePanel

