/**
 * tabs/create-wallet.tsx
 * Standalone tab for the Create Wallet onboarding flow.
 */

import React from "react"
import "../style.css"
import CreateWallet from "../components/CreateWallet"

function CreateWalletTab() {
  function handleBack() {
    // If there's history go back, else close
    if (window.history.length > 1) {
      window.history.back()
    } else {
      window.close()
    }
  }

  return <CreateWallet onBack={handleBack} />
}

export default CreateWalletTab