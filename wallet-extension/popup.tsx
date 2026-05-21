import React, { useEffect, useState } from "react"
import "./style.css"
import { PoolProvider } from "./context/PoolContext"
import { WalletProvider, useWallet } from "./context/WalletContext"
import LockScreen from "./components/LockScreen"
import WalletHome from "./components/WalletHome"

type AppState = "loading" | "locked" | "unlocked"

function AppInner() {
  const { wallet, unlock, hydrating } = useWallet()
  const [appState, setAppState] = useState<AppState>("loading")

  // ── First-paint resolution ────────────────────────────────────────────
  // We have to check three things before deciding what to render:
  //   1) Is chrome.storage even reachable?
  //   2) Has the user finished onboarding & stored a wallet?
  //   3) Did the WalletContext find a valid session unlock?
  //
  // We wait for `hydrating === false` so that case (3) has settled before
  // we commit to "locked", otherwise the LockScreen would flash for one
  // frame even when the user has an active session.
  useEffect(() => {
    if (hydrating) return
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
      let hasWallet = false
      try {
        const result = await chrome.storage.local.get([
          "menoid_onboarding",
          "menoid_wallets",
          "menoid_wallet"
        ])
        onboarding = result?.menoid_onboarding ?? false
        hasWallet = !!(result?.menoid_wallets || result?.menoid_wallet)
      } catch {
        /* treat as fresh */
      }

      if (!onboarding || !hasWallet) {
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

      if (wallet) {
        setAppState("unlocked")
      } else {
        setAppState("locked")
      }
    })()
  }, [hydrating, wallet])

  if (appState === "loading" || hydrating) {
    return (
      <div className="w-[360px] h-[600px] bg-cream flex items-center justify-center">
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

  if (appState === "locked" || !wallet)
    return (
      <LockScreen
        onUnlock={(payload) => {
          unlock(payload)
          setAppState("unlocked")
        }}
      />
    )
  return <WalletHome />
}

function IndexPopup() {
  return (
    <WalletProvider>
      <PoolProvider>
        <AppInner />
      </PoolProvider>
    </WalletProvider>
  )
}

export default IndexPopup
