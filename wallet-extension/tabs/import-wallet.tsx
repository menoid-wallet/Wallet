

import React from "react"
import "../style.css"
import ImportWallet from "../components/ImportWallet"

function ImportWalletTab() {
  function handleBack() {
    if (window.history.length > 1) {
      window.history.back()
    } else {
      window.close()
    }
  }

  return <ImportWallet onBack={handleBack} />
}

export default ImportWalletTab