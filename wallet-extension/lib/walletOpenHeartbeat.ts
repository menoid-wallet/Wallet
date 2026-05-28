/**
 * walletOpenHeartbeat.ts
 *
 * The popup / sidepanel write a freshness heartbeat to chrome.storage.session
 * while mounted. background.ts reads it to decide whether a dapp connection
 * request can be shown in the already-open wallet, or whether it must open
 * the connect.html fallback tab.
 *
 * Why a heartbeat instead of chrome.extension.getViews()?
 *   getViews() does not reliably list side-panel documents in MV3, and is
 *   racy for popups. A timestamp in RAM-only session storage is robust and
 *   trivially cheap.
 *
 * Usage (in popup.tsx / sidepanel.tsx):
 *   useEffect(() => startWalletOpenHeartbeat(), [])
 */

export const WALLET_OPEN_KEY = "menoid_wallet_open_heartbeat"
const BEAT_MS = 3_000

function sessionStore(): chrome.storage.StorageArea {
  return (chrome.storage as any).session ?? chrome.storage.local
}

async function beat(): Promise<void> {
  try {
    await sessionStore().set({ [WALLET_OPEN_KEY]: { at: Date.now() } })
  } catch {
    /* ignore */
  }
}

async function clearBeat(): Promise<void> {
  try {
    await sessionStore().remove(WALLET_OPEN_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Starts the heartbeat and returns a cleanup function (call it from the
 * effect's teardown). Also clears the heartbeat on window unload so a
 * closed popup is detected promptly even before the next staleness check.
 */
export function startWalletOpenHeartbeat(): () => void {
  void beat()
  const timer = setInterval(beat, BEAT_MS)

  const onHide = () => { if (document.hidden) void beat() }
  const onUnload = () => { void clearBeat() }

  document.addEventListener("visibilitychange", onHide)
  window.addEventListener("pagehide", onUnload)
  window.addEventListener("beforeunload", onUnload)

  return () => {
    clearInterval(timer)
    document.removeEventListener("visibilitychange", onHide)
    window.removeEventListener("pagehide", onUnload)
    window.removeEventListener("beforeunload", onUnload)
    void clearBeat()
  }
}