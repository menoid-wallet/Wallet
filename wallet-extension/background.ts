/**
 * background.ts
 *
 * - Opens the welcome tab on first install.
 * - Persists view-mode preference and applies matching Chrome behaviour.
 * - Handles EIP-1193 RPC requests from dapps via MENOID_RPC messages:
 *     eth_requestAccounts   → show approval, then return address
 *     eth_accounts          → return approved address if connected
 *     eth_chainId           → return Monad Testnet chainId (0x279f = 10143)
 *     net_version           → return "10143"
 *     wallet_revokePermissions → disconnect
 *     All other methods     → proxy to Monad RPC
 *
 * Connection-approval UX (updated):
 *   When a dapp requests a connection we want the request to be VISIBLE no
 *   matter what. chrome.action.openPopup() is unreliable (Chrome refuses it
 *   unless the extension is pinned / a user gesture is live), so:
 *     1. Try to open the wallet in the user's preferred mode (popup/sidebar).
 *        If the wallet is already open it picks up the pending approval via
 *        storage.onChanged instantly.
 *     2. If opening fails, open a dedicated full-page tab (tabs/connect.html)
 *        that asks the user to unlock (if needed) and shows the request there.
 *   On approve/reject, that connect tab closes itself; the dapp tab is
 *   notified through its port either way.
 */

import {
  VIEW_MODE_KEY,
  applyChromeBehaviour,
  getViewMode,
  setViewMode,
  openWalletInPreferredMode,
} from "./lib/viewMode"
import {
  getConnectionsForHost,
  upsertConnection,
  removeConnectionsForHost,
  makeConnection,
  readConnections,
  writeConnections,
} from "./lib/connections"


export {}

// ── Constants ─────────────────────────────────────────────────────────────
const MONAD_CHAIN_ID = "0x279f" // 10143
const MONAD_NET_VERSION = "10143"
const MONAD_RPC = "https://testnet-rpc.monad.xyz"

// Pending approval requests: tabId → metadata only.
const pendingApprovals = new Map<
  number,
  { host: string; origin: string; favicon: string }
>()

// Pending tx-signing requests: tabId → full tx info
const pendingTxRequests = new Map<number, any>()

// Track the original RPC message id for pending tx so we can respond later
const portPendingIds = new Map<number, number>()

const PENDING_TX_KEY = "menoid_pending_tx"

async function storePendingTx(info: any): Promise<void> {
  const store = (chrome.storage as any).session ?? chrome.storage.local
  await store.set({ [PENDING_TX_KEY]: info })
}

async function clearPendingTx(): Promise<void> {
  const store = (chrome.storage as any).session ?? chrome.storage.local
  await store.remove(PENDING_TX_KEY)
}

async function surfaceTx(info: { host: string; origin: string; favicon: string; tabId: number; txParams: any; fromAddress: string }) {
  if (await isWalletOpen()) return

  let opened = false
  try {
    const result = await openWalletInPreferredMode()
    opened = result.opened
  } catch {}

  if (opened) {
    // Verify the wallet actually appeared within 2.5s
    const walletAppeared = await waitForWalletOpen(2500)
    if (walletAppeared) return
    console.log("[BG] surfaceTx: wallet open call succeeded but heartbeat never appeared — falling back to sign tab")
  }

  // Open the sign fallback tab
  const sp = new URLSearchParams({
    host: info.host,
    origin: info.origin,
    favicon: info.favicon,
    tabId: String(info.tabId),
    from: info.fromAddress,
  })
  const url = chrome.runtime.getURL(`tabs/sign.html?${sp.toString()}`)
  const tab = await chrome.tabs.create({ url, active: true })
  if (tab.id) connectTabId = tab.id
}

// Track the connect-fallback tab we opened (if any) so we can focus/close it.
let connectTabId: number | null = null

// ── View mode lifecycle ────────────────────────────────────────────────────
async function applyFromStorage() {
  const mode = await getViewMode()
  await applyChromeBehaviour(mode)
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("tabs/welcome.html") })
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

// ── RPC proxy helper ──────────────────────────────────────────────────────
async function proxyRpc(method: string, params: any[]): Promise<any> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  const res = await fetch(MONAD_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message ?? "RPC error")
  return json.result
}

// ── Is the wallet (popup or sidepanel) currently open? ─────────────────────
// chrome.extension.getViews() is unreliable for side panels in MV3, so we use
// a heartbeat the open wallet view writes to storage.session. The view writes
// `{ at: Date.now() }` on mount + every few seconds, and removes it on unload.
// We treat the wallet as open if the heartbeat is fresh (< STALE_MS old).
const WALLET_OPEN_KEY = "menoid_wallet_open_heartbeat"
const HEARTBEAT_STALE_MS = 8_000

async function isWalletOpen(): Promise<boolean> {
  try {
    const store = (chrome.storage as any).session ?? chrome.storage.local
    const r = await store.get(WALLET_OPEN_KEY)
    const hb = r?.[WALLET_OPEN_KEY] as { at: number } | undefined
    if (!hb?.at) return false
    return Date.now() - hb.at < HEARTBEAT_STALE_MS
  } catch {
    return false
  }
}

// Poll until the wallet heartbeat appears (wallet confirmed open) or timeout
async function waitForWalletOpen(timeoutMs: number): Promise<boolean> {
  const interval = 200
  const attempts = Math.ceil(timeoutMs / interval)
  for (let i = 0; i < attempts; i++) {
    if (await isWalletOpen()) return true
    await new Promise((r) => setTimeout(r, interval))
  }
  return false
}

// ── Open the full-page connect fallback tab ────────────────────────────────
async function openConnectFallbackTab(info: {
  host: string
  origin: string
  favicon: string
  tabId: number
}) {
  // Pass the approval through the URL so the page works immediately, even
  // before it reads storage.session.
  const params = new URLSearchParams({
    host: info.host,
    origin: info.origin,
    favicon: info.favicon ?? "",
    tabId: String(info.tabId),
  })
  const url = chrome.runtime.getURL(`tabs/connect.html?${params.toString()}`)

  try {
    // Reuse an existing connect tab if we already opened one.
    if (connectTabId !== null) {
      try {
        await chrome.tabs.update(connectTabId, { url, active: true })
        const tab = await chrome.tabs.get(connectTabId)
        if (tab?.windowId !== undefined) {
          await chrome.windows.update(tab.windowId, { focused: true })
        }
        return
      } catch {
        connectTabId = null // stale; fall through and create a new one
      }
    }
    const tab = await chrome.tabs.create({ url, active: true })
    connectTabId = tab.id ?? null
    if (tab?.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {})
    }
  } catch (e) {
    console.error("[BG] failed to open connect fallback tab:", e)
  }
}

// ── Surface a pending connection approval to the user ──────────────────────
async function surfaceApproval(info: {
  host: string
  origin: string
  favicon: string
  tabId: number
}) {
  if (await isWalletOpen()) {
    console.log("[BG] wallet already open — showing request in place")
    return
  }

  console.log("[BG] wallet closed — attempting to open it")
  let opened = false
  try {
    const result = await openWalletInPreferredMode()
    opened = result.opened
    console.log("[BG] openWalletInPreferredMode result:", result)
  } catch (e) {
    console.error("[BG] could not open wallet:", e)
  }

  if (opened) {
    // chrome.action.openPopup() / sidePanel.open() can silently fail even
    // when they return success. Wait up to 2.5s for the heartbeat to appear,
    // then fall back to the connect tab if it never did.
    const walletAppeared = await waitForWalletOpen(2500)
    if (walletAppeared) {
      console.log("[BG] wallet confirmed open via heartbeat")
      return
    }
    console.log("[BG] wallet open call succeeded but heartbeat never appeared — falling back to connect tab")
  }

  console.log("[BG] opening connect fallback tab")
  await openConnectFallbackTab(info)
}

async function handleRpc(
  method: string,
  params: any[],
  host: string,
  origin: string,
  tabId: number
): Promise<any> {

  if (method === "eth_chainId") return MONAD_CHAIN_ID
  if (method === "net_version") return MONAD_NET_VERSION

  if (method === "eth_accounts") {
    const conns = await getConnectionsForHost(host)
    if (conns.length === 0) return []
    return [conns[0].exposedAddress]
  }

  if (method === "menoid_getConnectionMode") {
    const conns = await getConnectionsForHost(host)
    if (conns.length === 0) return null
    return { mode: conns[0].mode, exposedAddress: conns[0].exposedAddress }
  }

  if (method === "eth_requestAccounts") {
    console.log("[BG] eth_requestAccounts from", host)

    const existing = await getConnectionsForHost(host)
    if (existing.length > 0) {
      console.log("[BG] already connected, returning:", existing[0].exposedAddress)
      return [existing[0].exposedAddress]
    }

    const favicon = await getTabFavicon(tabId)
    const info = { host, origin, favicon, tabId }

    await storePendingApproval(info)
    pendingApprovals.set(tabId, { host, origin, favicon })

    await surfaceApproval(info)

    // Respond immediately — result will arrive via MENOID_APPROVAL_RESULT.
    return { pending: true }
  }

  if (method === "wallet_revokePermissions") {
    await removeConnectionsForHost(host)
    notifyTab(tabId, "accountsChanged", [])
    notifyTab(tabId, "disconnect", { code: 4900, message: "Disconnected" })
    return null
  }

  if (method === "wallet_switchEthereumChain") {
    const requested = params?.[0]?.chainId
    if (requested === MONAD_CHAIN_ID || requested === "0x279f") return null
    throw new Error("Chain not supported. Menoid only supports Monad Testnet.")
  }

  if (method === "personal_sign" || method === "eth_sign") {
    throw new Error(
      "Menoid: signing not yet supported via dapp injection. Use the wallet UI."
    )
  }

  if (method === "eth_sendTransaction") {
    // Check the dapp is connected first
    const conns = await getConnectionsForHost(host)
    if (conns.length === 0) {
      throw new Error("Menoid: not connected to this dapp. Connect first.")
    }


    const txParams = params?.[0] ?? {}
    const favicon = await getTabFavicon(tabId)
    const info = {
      host,
      origin,
      favicon,
      tabId,
      txParams,
      fromAddress: conns[0].exposedAddress,
      isNoidMode: conns[0].mode === "noid", 
    }

    await storePendingTx(info)
    pendingTxRequests.set(tabId, info)
    await surfaceTx(info)

    return { pending: true }
  }

  return proxyRpc(method, params)
}

// ── Port-based RPC handler ──────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'menoid-rpc') return

  const tabId = port.sender?.tab?.id ?? -1
  console.log("[BG] port connected from tab:", tabId)

  if (tabId >= 0) tabPorts.set(tabId, port)

  port.onMessage.addListener(async (msg) => {
    if (msg?.type === 'MENOID_KEEPALIVE') {
      port.postMessage({ type: 'MENOID_KEEPALIVE_ACK' })
      return
    }

    if (msg?.type !== 'MENOID_RPC') return

    const { id, method, params = [], host, origin } = msg
    console.log("[BG] received MENOID_RPC:", method, "from tab:", tabId)

    try {
      const result = await handleRpc(method, params, host, origin, tabId)
      if (result && (result as any).pending) {
        // Store the message id so we can respond when the user approves/rejects
        portPendingIds.set(tabId, id)
        port.postMessage({ type: 'MENOID_RPC_RESPONSE', id, pending: true })
      } else {
        port.postMessage({ type: 'MENOID_RPC_RESPONSE', id, result })
      }
    } catch (err: any) {
      console.error("[BG] handleRpc error:", err)
      port.postMessage({
        type: 'MENOID_RPC_RESPONSE',
        id,
        error: { message: err?.message ?? 'Unknown error', code: 4001 },
      })
    }
  })

  port.onDisconnect.addListener(() => {
    console.log("[BG] port disconnected from tab:", tabId)
    if (tabId >= 0) tabPorts.delete(tabId)
  })
})

// ── Approval / rejection from the popup or connect tab ──────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "MENOID_APPROVE") {
    ;(async () => {
      const { tabId, walletId, walletName, mode, exposedAddress,
              noidAccountCommitment, noidAccountName, host } = msg

      const conn = makeConnection({
        walletId, walletName, mode, exposedAddress,
        noidAccountCommitment: noidAccountCommitment ?? null,
        noidAccountName: noidAccountName ?? null,
        host,
      })
      await upsertConnection(conn)
      pendingApprovals.delete(tabId)

      notifyTab(tabId, "accountsChanged", [exposedAddress])
      notifyTab(tabId, "connect", { chainId: MONAD_CHAIN_ID })
      notifyTabPort(tabId, {
        type: "MENOID_APPROVAL_RESULT",
        accounts: [exposedAddress],
      })

      await clearPendingApproval()
      // Focus the dapp tab so the user lands back there after approving
      await focusDappTab(tabId)
      await closeConnectTabSoon()
      sendResponse({ ok: true })
    })()
    return true
  }

  if (msg?.type === "MENOID_REJECT") {
    ;(async () => {
      const { tabId } = msg
      pendingApprovals.delete(tabId)

      notifyTabPort(tabId, {
        type: "MENOID_APPROVAL_RESULT",
        error: { message: "User rejected the request.", code: 4001 },
      })

      await clearPendingApproval()
      // Focus the dapp tab so the user lands back there after rejecting
      await focusDappTab(tabId)
      await closeConnectTabSoon()
      sendResponse({ ok: true })
    })()
    return true
  }

  // Focus the dapp tab on demand (called from connect.tsx via handleDone)
  if (msg?.type === "MENOID_FOCUS_DAPP_TAB") {
    ;(async () => {
      const { tabId } = msg
      await focusDappTab(tabId)
      sendResponse({ ok: true })
    })()
    return true
  }

  // ── Tx approved: sign and broadcast ─────────────────────────────────────
  if (msg?.type === "MENOID_TX_RESULT") {
    ;(async () => {
      const { txHash, tabId } = msg
      const port = tabPorts.get(tabId)
      if (port) {
        // Content script moved the promise to pendingAccountRequests waiting
        // for MENOID_APPROVAL_RESULT — use that so it resolves correctly
        port.postMessage({ type: "MENOID_APPROVAL_RESULT", result: txHash })
      }
      pendingTxRequests.delete(tabId)
      portPendingIds.delete(tabId)
      await clearPendingTx()
      sendResponse({ ok: true })
    })()
    return true
  }

  // ── Tx rejected ───────────────────────────────────────────────────────────
  if (msg?.type === "MENOID_TX_REJECT") {
    ;(async () => {
      const { tabId } = msg
      const port = tabPorts.get(tabId)
      if (port) {
        port.postMessage({
          type: "MENOID_APPROVAL_RESULT",
          error: { message: "User rejected the transaction", code: 4001 },
        })
      }
      pendingTxRequests.delete(tabId)
      portPendingIds.delete(tabId)
      await clearPendingTx()
      sendResponse({ ok: true })
    })()
    return true
  }

  // ── Noid smart account changed (or mode switched open↔noid) ─────────────
  // Updates all live dapp connections for this wallet that used noid mode
  // and fires accountsChanged to the dapp with the new exposed address.
  if (msg?.type === "MENOID_NOID_ACCOUNT_SWITCHED") {
    ;(async () => {
      const { walletId, noidSmartAccountAddress, noidAccountCommitment, openAddress } = msg

      const allConns = await readConnections()

      for (const [tabId] of tabPorts.entries()) {
        try {
          const tab = await chrome.tabs.get(tabId)
          if (!tab?.url || tab.url.startsWith("chrome")) continue

          const url = new URL(tab.url)
          const host = url.host

          // Find the connection for this wallet+host
          const conn = allConns.find(
            (c) => c.walletId === walletId && c.host === host
          )
          if (!conn) continue

          if (noidSmartAccountAddress) {
            // Noid account changed — update the stored connection and notify dapp
            const updated = {
              ...conn,
              exposedAddress: noidSmartAccountAddress,
              noidAccountCommitment: noidAccountCommitment ?? conn.noidAccountCommitment,
              mode: "noid" as const,
            }
            const list = allConns.map((c) =>
              c.walletId === walletId && c.host === host ? updated : c
            )
            await writeConnections(list)
            notifyTab(tabId, "accountsChanged", [noidSmartAccountAddress])
          } else {
            // Mode switched back to open.
            // Use the openAddress sent directly in the message — don't rely on
            // searching stored connections because they may have been overwritten
            // to mode:"noid" by a prior noid connection approval.
            if (openAddress) {
              // Update the stored connection back to open mode
              const updated = { ...conn, exposedAddress: openAddress, mode: "open" as const }
              const list = allConns.map((c) =>
                c.walletId === walletId && c.host === host ? updated : c
              )
              await writeConnections(list)
              notifyTab(tabId, "accountsChanged", [openAddress])
            }
          }
        } catch { /* tab closed — skip */ }
      }

      sendResponse({ ok: true })
    })()
    return true
  }

  // ── Account switched in wallet → trigger approval ONLY if the new wallet
  //    has no existing connection to the currently open dapp ──────────────
  if (msg?.type === "MENOID_ACCOUNT_SWITCHED") {
    ;(async () => {
      const { walletId } = msg

      // Find which dapp tabs are currently open and have an active port
      const liveDappTabs: { tabId: number; host: string; origin: string; favicon: string }[] = []

      for (const [tabId] of tabPorts.entries()) {
        try {
          const tab = await chrome.tabs.get(tabId)
          if (tab?.url && !tab.url.startsWith("chrome")) {
            const url = new URL(tab.url)
            liveDappTabs.push({
              tabId,
              host: url.host,
              origin: url.origin,
              favicon: tab.favIconUrl ?? "",
            })
          }
        } catch { /* tab closed — skip */ }
      }

      // No live dapp tabs — clear any stale pending approval and bail
      if (liveDappTabs.length === 0) {
        await clearPendingApproval()
        sendResponse({ ok: true, skipped: "no live dapp tabs" })
        return
      }

      const allConns = await readConnections()

      let needsApproval = false
      for (const dapp of liveDappTabs) {
        const alreadyConnected = allConns.some(
          (c) => c.walletId === walletId && c.host === dapp.host
        )

        if (alreadyConnected) {
          // Already connected — notify dapp directly and clear any stale pending approval
          const existingConn = allConns.find(
            (c) => c.walletId === walletId && c.host === dapp.host
          )!
          notifyTab(dapp.tabId, "accountsChanged", [existingConn.exposedAddress])
          await clearPendingApproval()
          continue
        }

        // Not connected — verify the tab is truly reachable before surfacing
        try {
          await chrome.tabs.get(dapp.tabId)
        } catch {
          continue // tab was closed between our scan and now
        }

        needsApproval = true
        const info = { host: dapp.host, origin: dapp.origin, favicon: dapp.favicon, tabId: dapp.tabId }
        // Clear dismissed list so the banner shows fresh for this new account
        const store = (chrome.storage as any).session ?? chrome.storage.local
        await store.remove("menoid_dismissed_approvals").catch(() => {})
        await storePendingApproval(info)
        pendingApprovals.set(dapp.tabId, { host: dapp.host, origin: dapp.origin, favicon: dapp.favicon })
        await surfaceApproval(info)
      }

      if (!needsApproval) {
        // All dapps were already connected — make sure no stale banner lingers
        await clearPendingApproval()
      }

      sendResponse({ ok: true })
    })()
    return true
  }

  return false
})

// Focus the dapp tab so the user lands back on the dapp after approve/reject.
async function focusDappTab(tabId: number) {
  if (tabId < 0) return
  try {
    const tab = await chrome.tabs.get(tabId)
    if (tab?.windowId !== undefined) {
      await chrome.tabs.update(tabId, { active: true })
      await chrome.windows.update(tab.windowId, { focused: true })
    }
  } catch {
    // Tab may have been closed — ignore
  }
}

// Close the connect fallback tab (if we opened one) shortly after the user
// acts, leaving a beat for the success animation. The connect page also
// closes itself via storage.onChanged; this is a backstop.
async function closeConnectTabSoon() {
  if (connectTabId === null) return
  const id = connectTabId
  connectTabId = null
  setTimeout(() => {
    chrome.tabs.remove(id).catch(() => {})
  }, 700)
}

// Keep our connectTabId in sync if the user closes the tab manually.
chrome.tabs.onRemoved.addListener((closedId) => {
  if (closedId === connectTabId) connectTabId = null
  // If the closed tab had a pending approval, clear it so the banner goes away
  if (pendingApprovals.has(closedId)) {
    pendingApprovals.delete(closedId)
    clearPendingApproval()
  }
  // If the closed tab had a pending tx, clear it too
  if (pendingTxRequests.has(closedId)) {
    pendingTxRequests.delete(closedId)
    portPendingIds.delete(closedId)
    clearPendingTx()
  }
})

// ── Tab port registry ────────────────────────────────────────────────────
const tabPorts = new Map<number, chrome.runtime.Port>()

function notifyTab(tabId: number, event: string, data: any) {
  if (tabId < 0) return
  const port = tabPorts.get(tabId)
  if (port) {
    try { port.postMessage({ type: "MENOID_EVENT", event, data }) } catch {}
  } else {
    chrome.tabs.sendMessage(tabId, { type: "MENOID_EVENT", event, data }).catch(() => {})
  }
}

function notifyTabPort(tabId: number, msg: any) {
  if (tabId < 0) return
  const port = tabPorts.get(tabId)
  if (port) {
    try { port.postMessage(msg) } catch {}
  } else {
    chrome.tabs.sendMessage(tabId, msg).catch(() => {})
  }
}

// ── Pending approval stored in session for the popup/tab to read ───────────
const PENDING_APPROVAL_KEY = "menoid_pending_approval"

async function storePendingApproval(info: {
  host: string
  origin: string
  favicon: string
  tabId: number
}) {
  if ((chrome.storage as any).session) {
    await (chrome.storage as any).session.set({ [PENDING_APPROVAL_KEY]: info })
  } else {
    await chrome.storage.local.set({ [PENDING_APPROVAL_KEY]: info })
  }
}

async function clearPendingApproval() {
  if ((chrome.storage as any).session) {
    await (chrome.storage as any).session.remove(PENDING_APPROVAL_KEY)
  } else {
    await chrome.storage.local.remove(PENDING_APPROVAL_KEY)
  }
}

export async function readPendingApproval(): Promise<{
  host: string
  origin: string
  favicon: string
  tabId: number
} | null> {
  const store = (chrome.storage as any).session ?? chrome.storage.local
  const r = await store.get(PENDING_APPROVAL_KEY)
  return r?.[PENDING_APPROVAL_KEY] ?? null
}

async function getTabFavicon(tabId: number): Promise<string> {
  try {
    const tab = await chrome.tabs.get(tabId)
    return tab.favIconUrl ?? ""
  } catch {
    return ""
  }
}