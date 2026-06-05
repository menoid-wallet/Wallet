/**
 * background.ts
 *
 * - Opens the welcome tab on first install.
 * - Persists view-mode preference and applies matching Chrome behaviour.
 * - Handles EIP-1193 RPC requests from dapps via MENOID_RPC messages:
 *     eth_requestAccounts   → show approval, then return address (MetaMask-style)
 *     eth_accounts          → return approved address if connected
 *     eth_chainId           → return Monad Testnet chainId (0x279f = 10143)
 *     net_version           → return "10143"
 *     wallet_revokePermissions → disconnect
 *     All other methods     → proxy to Monad RPC
 *
 * eth_requestAccounts now works exactly like MetaMask:
 *   The promise stays open until the user approves or rejects in the wallet.
 *   No { pending: true } hack — the dapp gets accounts[] directly on resolve,
 *   or a 4001 error on reject.
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

// ── Pending approval requests: tabId → metadata ───────────────────────────
const pendingApprovals = new Map<
  number,
  { host: string; origin: string; favicon: string }
>()

// ── Pending account resolvers: tabId → { resolve, reject } ───────────────
// This is what makes eth_requestAccounts behave like MetaMask.
// Instead of returning { pending: true }, we hold the promise open here
// and call resolve/reject when the user acts in the wallet.
const pendingAccountResolvers = new Map<number, {
  resolve: (accounts: string[]) => void
  reject: (err: Error) => void
}>()

// ── Pending tx-signing requests: tabId → full tx info ────────────────────
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
    const walletAppeared = await waitForWalletOpen(2500)
    if (walletAppeared) return
    console.log("[BG] surfaceTx: wallet open call succeeded but heartbeat never appeared — falling back to sign tab")
  }

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

// ── Is the wallet (popup or sidepanel) currently open? ────────────────────
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

async function waitForWalletOpen(timeoutMs: number): Promise<boolean> {
  const interval = 200
  const attempts = Math.ceil(timeoutMs / interval)
  for (let i = 0; i < attempts; i++) {
    if (await isWalletOpen()) return true
    await new Promise((r) => setTimeout(r, interval))
  }
  return false
}

// ── Open the full-page connect fallback tab ───────────────────────────────
async function openConnectFallbackTab(info: {
  host: string
  origin: string
  favicon: string
  tabId: number
}) {
  const params = new URLSearchParams({
    host: info.host,
    origin: info.origin,
    favicon: info.favicon ?? "",
    tabId: String(info.tabId),
  })
  const url = chrome.runtime.getURL(`tabs/connect.html?${params.toString()}`)

  try {
    if (connectTabId !== null) {
      try {
        await chrome.tabs.update(connectTabId, { url, active: true })
        const tab = await chrome.tabs.get(connectTabId)
        if (tab?.windowId !== undefined) {
          await chrome.windows.update(tab.windowId, { focused: true })
        }
        return
      } catch {
        connectTabId = null
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

// ── Surface a pending connection approval to the user ─────────────────────
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

// ── Main RPC handler ──────────────────────────────────────────────────────
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

    // Already connected — return immediately (same as MetaMask)
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

    // Hold the promise open — exactly like MetaMask.
    // resolve/reject are called in MENOID_APPROVE / MENOID_REJECT handlers below.
    return new Promise<string[]>((resolve, reject) => {
      pendingAccountResolvers.set(tabId, { resolve, reject })
    })
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

    // tx still uses the old pending pattern (separate flow)
    return { pending: true }
  }

  return proxyRpc(method, params)
}

// ── Port-based RPC handler ────────────────────────────────────────────────
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

      // eth_sendTransaction still uses pending pattern
      if (result && (result as any).pending) {
        portPendingIds.set(tabId, id)
        port.postMessage({ type: 'MENOID_RPC_RESPONSE', id, pending: true })
      } else {
        // For eth_requestAccounts this now resolves with accounts[] directly —
        // the promise above only resolves after MENOID_APPROVE fires
        port.postMessage({ type: 'MENOID_RPC_RESPONSE', id, result })
      }
    } catch (err: any) {
      console.error("[BG] handleRpc error:", err)
      port.postMessage({
        type: 'MENOID_RPC_RESPONSE',
        id,
        error: { message: err?.message ?? 'Unknown error', code: (err as any)?.code ?? 4001 },
      })
    }
  })

  port.onDisconnect.addListener(() => {
    console.log("[BG] port disconnected from tab:", tabId)
    if (tabId >= 0) tabPorts.delete(tabId)
  })
})

// ── Approval / rejection from the popup or connect tab ───────────────────
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

      // ── Resolve the pending eth_requestAccounts promise ──────────────
      // This is what makes Menoid behave like MetaMask — the dapp's
      // await provider.request({ method: 'eth_requestAccounts' })
      // now resolves with [address] directly, no event needed.
      const resolver = pendingAccountResolvers.get(tabId)
      if (resolver) {
        resolver.resolve([exposedAddress])
        pendingAccountResolvers.delete(tabId)
      }

      // Still fire accountsChanged and connect events for dapps that
      // listen to them (e.g. for UI updates)
      notifyTab(tabId, "accountsChanged", [exposedAddress])
      notifyTab(tabId, "connect", { chainId: MONAD_CHAIN_ID })

      await clearPendingApproval()
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

      // ── Reject the pending eth_requestAccounts promise ───────────────
      // Dapp gets a proper 4001 error, same as MetaMask user rejection.
      const resolver = pendingAccountResolvers.get(tabId)
      if (resolver) {
        const err = new Error("User rejected the request.")
        ;(err as any).code = 4001
        resolver.reject(err)
        pendingAccountResolvers.delete(tabId)
      }

      await clearPendingApproval()
      await focusDappTab(tabId)
      await closeConnectTabSoon()
      sendResponse({ ok: true })
    })()
    return true
  }

  if (msg?.type === "MENOID_FOCUS_DAPP_TAB") {
    ;(async () => {
      const { tabId } = msg
      await focusDappTab(tabId)
      sendResponse({ ok: true })
    })()
    return true
  }

  // ── Tx approved ───────────────────────────────────────────────────────
  if (msg?.type === "MENOID_TX_RESULT") {
    ;(async () => {
      const { txHash, tabId } = msg
      const port = tabPorts.get(tabId)
      if (port) {
        port.postMessage({ type: "MENOID_APPROVAL_RESULT", result: txHash })
      }
      pendingTxRequests.delete(tabId)
      portPendingIds.delete(tabId)
      await clearPendingTx()
      sendResponse({ ok: true })
    })()
    return true
  }

  // ── Tx rejected ───────────────────────────────────────────────────────
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

  // ── Noid smart account changed ────────────────────────────────────────
  if (msg?.type === "MENOID_NOID_ACCOUNT_SWITCHED") {
    ;(async () => {
      const { walletId, noidSmartAccountAddress, noidAccountCommitment } = msg

      const allConns = await readConnections()

      for (const [tabId] of tabPorts.entries()) {
        try {
          const tab = await chrome.tabs.get(tabId)
          if (!tab?.url || tab.url.startsWith("chrome")) continue

          const url = new URL(tab.url)
          const host = url.host

          const conn = allConns.find(
            (c) => c.walletId === walletId && c.host === host
          )
          if (!conn) continue

          if (noidSmartAccountAddress) {
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
            const openConn = allConns.find(
              (c) => c.walletId === walletId && c.host === host && c.mode === "open"
            )
            if (openConn) {
              notifyTab(tabId, "accountsChanged", [openConn.exposedAddress])
            }
          }
        } catch { /* tab closed — skip */ }
      }

      sendResponse({ ok: true })
    })()
    return true
  }

  // ── Account switched in wallet ────────────────────────────────────────
  if (msg?.type === "MENOID_ACCOUNT_SWITCHED") {
    ;(async () => {
      const { walletId } = msg

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
          const existingConn = allConns.find(
            (c) => c.walletId === walletId && c.host === dapp.host
          )!
          notifyTab(dapp.tabId, "accountsChanged", [existingConn.exposedAddress])
          await clearPendingApproval()
          continue
        }

        try {
          await chrome.tabs.get(dapp.tabId)
        } catch {
          continue
        }

        needsApproval = true
        const info = { host: dapp.host, origin: dapp.origin, favicon: dapp.favicon, tabId: dapp.tabId }
        const store = (chrome.storage as any).session ?? chrome.storage.local
        await store.remove("menoid_dismissed_approvals").catch(() => {})
        await storePendingApproval(info)
        pendingApprovals.set(dapp.tabId, { host: dapp.host, origin: dapp.origin, favicon: dapp.favicon })
        await surfaceApproval(info)
      }

      if (!needsApproval) {
        await clearPendingApproval()
      }

      sendResponse({ ok: true })
    })()
    return true
  }

  return false
})

// ── Focus the dapp tab ────────────────────────────────────────────────────
async function focusDappTab(tabId: number) {
  if (tabId < 0) return
  try {
    const tab = await chrome.tabs.get(tabId)
    if (tab?.windowId !== undefined) {
      await chrome.tabs.update(tabId, { active: true })
      await chrome.windows.update(tab.windowId, { focused: true })
    }
  } catch {}
}

async function closeConnectTabSoon() {
  if (connectTabId === null) return
  const id = connectTabId
  connectTabId = null
  setTimeout(() => {
    chrome.tabs.remove(id).catch(() => {})
  }, 700)
}

chrome.tabs.onRemoved.addListener((closedId) => {
  if (closedId === connectTabId) connectTabId = null

  if (pendingApprovals.has(closedId)) {
    pendingApprovals.delete(closedId)
    clearPendingApproval()
  }

  // If the dapp tab closes while approval is pending, reject the promise
  if (pendingAccountResolvers.has(closedId)) {
    const resolver = pendingAccountResolvers.get(closedId)!
    const err = new Error("Tab closed before approval.")
    ;(err as any).code = 4001
    resolver.reject(err)
    pendingAccountResolvers.delete(closedId)
  }

  if (pendingTxRequests.has(closedId)) {
    pendingTxRequests.delete(closedId)
    portPendingIds.delete(closedId)
    clearPendingTx()
  }
})

// ── Tab port registry ─────────────────────────────────────────────────────
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

// ── Pending approval storage ──────────────────────────────────────────────
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