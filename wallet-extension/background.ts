/**
 * background.ts
 *
 * - Opens the welcome tab on first install.
 * - Persists view-mode preference and applies matching Chrome behaviour.
 * - Handles EIP-1193 RPC requests from dapps via MENOID_RPC messages.
 * - Supports Monad Testnet, Sepolia, and Base Sepolia.
 *
 * Network switching:
 *   WalletContext sends MENOID_NETWORK_CHANGED when the user changes chain.
 *   Background stores the active network and fires chainChanged to connected
 *   dapps so EIP-1193 listeners update.
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

// ── Network config ─────────────────────────────────────────────────────────────

const CHAIN_CONFIG: Record<string, { chainId: string; netVersion: string; rpc: string }> = {
  monad: {
    chainId: "0x279f",      // 10143
    netVersion: "10143",
    rpc: "https://testnet-rpc.monad.xyz",
  },
  sepolia: {
    chainId: "0xaa36a7",    // 11155111
    netVersion: "11155111",
    rpc: "https://rpc.ankr.com/eth_sepolia/8b642f4bc0d625b1f27b9d4c6cd0be2213a8c65e203716ac8efac35adc510b7b",
  },
  base_sepolia: {
    chainId: "0x14a34",     // 84532
    netVersion: "84532",
    rpc: "https://sepolia.base.org",
  },
}

// Persistent storage key for the active network
const ACTIVE_NETWORK_KEY = "menoid_active_network"

let _activeNetwork = "monad"

async function loadActiveNetwork(): Promise<void> {
  try {
    const r = await chrome.storage.local.get(ACTIVE_NETWORK_KEY)
    const n = r?.[ACTIVE_NETWORK_KEY] as string | undefined
    if (n && CHAIN_CONFIG[n]) _activeNetwork = n
  } catch {/* ignore */}
}

function activeChainConfig() {
  return CHAIN_CONFIG[_activeNetwork] ?? CHAIN_CONFIG.monad
}

// ── Pending approvals / tx ─────────────────────────────────────────────────────

const pendingApprovals = new Map<
  number,
  { host: string; origin: string; favicon: string }
>()
const pendingTxRequests = new Map<number, any>()
const portPendingIds    = new Map<number, number>()

const PENDING_TX_KEY = "menoid_pending_tx"

async function storePendingTx(info: any): Promise<void> {
  const store = (chrome.storage as any).session ?? chrome.storage.local
  await store.set({ [PENDING_TX_KEY]: info })
}

async function clearPendingTx(): Promise<void> {
  const store = (chrome.storage as any).session ?? chrome.storage.local
  await store.remove(PENDING_TX_KEY)
}

// ── Wallet-open surfacing helpers ──────────────────────────────────────────────

async function surfaceTx(info: {
  host: string; origin: string; favicon: string
  tabId: number; txParams: any; fromAddress: string
}) {
  if (await isWalletOpen()) return
  let opened = false
  try { const r = await openWalletInPreferredMode(); opened = r.opened } catch {}

  if (opened) {
    const walletAppeared = await waitForWalletOpen(2500)
    if (walletAppeared) return
    console.log("[BG] surfaceTx: wallet heartbeat never appeared — falling back to sign tab")
  }

  const sp = new URLSearchParams({
    host: info.host, origin: info.origin, favicon: info.favicon,
    tabId: String(info.tabId), from: info.fromAddress,
  })
  const url = chrome.runtime.getURL(`tabs/sign.html?${sp.toString()}`)
  const tab = await chrome.tabs.create({ url, active: true })
  if (tab.id) connectTabId = tab.id
}

let connectTabId: number | null = null

async function applyFromStorage() {
  const mode = await getViewMode()
  await applyChromeBehaviour(mode)
}

// ── Extension lifecycle ───────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("tabs/welcome.html") })
    await setViewMode("popup")
  }
  await applyFromStorage()
  await loadActiveNetwork()
})

chrome.runtime.onStartup.addListener(async () => {
  await applyFromStorage()
  await loadActiveNetwork()
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[VIEW_MODE_KEY]) applyFromStorage()
  if (area === "local" && changes[ACTIVE_NETWORK_KEY]) {
    const n = changes[ACTIVE_NETWORK_KEY].newValue as string
    if (n && CHAIN_CONFIG[n]) _activeNetwork = n
  }
})

// ── RPC proxy helper ──────────────────────────────────────────────────────────

async function proxyRpc(method: string, params: any[]): Promise<any> {
  const rpc = activeChainConfig().rpc
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message ?? "RPC error")
  return json.result
}

// ── Wallet-open heartbeat ─────────────────────────────────────────────────────

const WALLET_OPEN_KEY     = "menoid_wallet_open_heartbeat"
const HEARTBEAT_STALE_MS  = 8_000

async function isWalletOpen(): Promise<boolean> {
  try {
    const store = (chrome.storage as any).session ?? chrome.storage.local
    const r = await store.get(WALLET_OPEN_KEY)
    const hb = r?.[WALLET_OPEN_KEY] as { at: number } | undefined
    if (!hb?.at) return false
    return Date.now() - hb.at < HEARTBEAT_STALE_MS
  } catch { return false }
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

// ── Connect fallback tab ──────────────────────────────────────────────────────

async function openConnectFallbackTab(info: {
  host: string; origin: string; favicon: string; tabId: number
}) {
  const params = new URLSearchParams({
    host: info.host, origin: info.origin,
    favicon: info.favicon ?? "", tabId: String(info.tabId),
  })
  const url = chrome.runtime.getURL(`tabs/connect.html?${params.toString()}`)
  try {
    if (connectTabId !== null) {
      try {
        await chrome.tabs.update(connectTabId, { url, active: true })
        const tab = await chrome.tabs.get(connectTabId)
        if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
        return
      } catch { connectTabId = null }
    }
    const tab = await chrome.tabs.create({ url, active: true })
    connectTabId = tab.id ?? null
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {})
  } catch (e) { console.error("[BG] failed to open connect fallback tab:", e) }
}

async function surfaceApproval(info: {
  host: string; origin: string; favicon: string; tabId: number
}) {
  if (await isWalletOpen()) { console.log("[BG] wallet already open"); return }
  let opened = false
  try { const r = await openWalletInPreferredMode(); opened = r.opened } catch (e) {
    console.error("[BG] could not open wallet:", e)
  }
  if (opened) {
    const walletAppeared = await waitForWalletOpen(2500)
    if (walletAppeared) { console.log("[BG] wallet confirmed open via heartbeat"); return }
    console.log("[BG] heartbeat never appeared — falling back to connect tab")
  }
  console.log("[BG] opening connect fallback tab")
  await openConnectFallbackTab(info)
}

// ── Core RPC handler ──────────────────────────────────────────────────────────

async function handleRpc(
  method: string,
  params: any[],
  host: string,
  origin: string,
  tabId: number
): Promise<any> {
  const cfg = activeChainConfig()

  if (method === "eth_chainId")   return cfg.chainId
  if (method === "net_version")   return cfg.netVersion

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
    return { pending: true }
  }

  if (method === "wallet_revokePermissions") {
    await removeConnectionsForHost(host)
    notifyTab(tabId, "accountsChanged", [])
    notifyTab(tabId, "disconnect", { code: 4900, message: "Disconnected" })
    return null
  }

  if (method === "wallet_switchEthereumChain") {
    const requested = (params?.[0]?.chainId as string | undefined)?.toLowerCase()
    // Accept any chain we support
    const match = Object.values(CHAIN_CONFIG).find(
      (c) => c.chainId === requested || c.chainId === params?.[0]?.chainId
    )
    if (match) return null   // already on or switching to a supported chain
    throw new Error(
      "Chain not supported. Menoid supports Monad Testnet, Sepolia, and Base Sepolia."
    )
  }

  if (method === "personal_sign" || method === "eth_sign") {
    throw new Error("Menoid: signing not yet supported via dapp injection. Use the wallet UI.")
  }

  if (method === "eth_sendTransaction") {
    const conns = await getConnectionsForHost(host)
    if (conns.length === 0) throw new Error("Menoid: not connected to this dapp. Connect first.")

    const txParams = params?.[0] ?? {}
    const favicon  = await getTabFavicon(tabId)
    const info = {
      host, origin, favicon, tabId, txParams,
      fromAddress: conns[0].exposedAddress,
      isNoidMode:  conns[0].mode === "noid",
      network:     _activeNetwork,
    }

    await storePendingTx(info)
    pendingTxRequests.set(tabId, info)
    await surfaceTx(info)
    return { pending: true }
  }

  return proxyRpc(method, params)
}

// ── Port-based RPC (content script → background) ──────────────────────────────

const tabPorts = new Map<number, chrome.runtime.Port>()

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "menoid-rpc") return

  const tabId = port.sender?.tab?.id ?? -1
  console.log("[BG] port connected from tab:", tabId)
  if (tabId >= 0) tabPorts.set(tabId, port)

  port.onMessage.addListener(async (msg) => {
    if (msg?.type === "MENOID_KEEPALIVE") {
      port.postMessage({ type: "MENOID_KEEPALIVE_ACK" })
      return
    }
    if (msg?.type !== "MENOID_RPC") return

    const { id, method, params = [], host, origin } = msg
    console.log("[BG] received MENOID_RPC:", method, "from tab:", tabId)

    try {
      const result = await handleRpc(method, params, host, origin, tabId)
      if (result && (result as any).pending) {
        portPendingIds.set(tabId, id)
        port.postMessage({ type: "MENOID_RPC_RESPONSE", id, pending: true })
      } else {
        port.postMessage({ type: "MENOID_RPC_RESPONSE", id, result })
      }
    } catch (err: any) {
      console.error("[BG] handleRpc error:", err)
      port.postMessage({
        type: "MENOID_RPC_RESPONSE", id,
        error: { message: err?.message ?? "Unknown error", code: 4001 },
      })
    }
  })

  port.onDisconnect.addListener(() => {
    console.log("[BG] port disconnected from tab:", tabId)
    if (tabId >= 0) tabPorts.delete(tabId)
  })
})

// ── Tab helpers ───────────────────────────────────────────────────────────────

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

async function focusDappTab(tabId: number) {
  if (tabId < 0) return
  try {
    const tab = await chrome.tabs.get(tabId)
    if (tab?.windowId !== undefined) {
      await chrome.tabs.update(tabId, { active: true })
      await chrome.windows.update(tab.windowId, { focused: true })
    }
  } catch {/* closed */}
}

async function closeConnectTabSoon() {
  if (connectTabId === null) return
  const id = connectTabId; connectTabId = null
  setTimeout(() => chrome.tabs.remove(id).catch(() => {}), 700)
}

chrome.tabs.onRemoved.addListener((closedId) => {
  if (closedId === connectTabId) connectTabId = null
  if (pendingApprovals.has(closedId)) {
    pendingApprovals.delete(closedId); clearPendingApproval()
  }
  if (pendingTxRequests.has(closedId)) {
    pendingTxRequests.delete(closedId); portPendingIds.delete(closedId); clearPendingTx()
  }
})

// ── Pending approval store ─────────────────────────────────────────────────────

const PENDING_APPROVAL_KEY = "menoid_pending_approval"

async function storePendingApproval(info: {
  host: string; origin: string; favicon: string; tabId: number
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
  host: string; origin: string; favicon: string; tabId: number
} | null> {
  const store = (chrome.storage as any).session ?? chrome.storage.local
  const r = await store.get(PENDING_APPROVAL_KEY)
  return r?.[PENDING_APPROVAL_KEY] ?? null
}

async function getTabFavicon(tabId: number): Promise<string> {
  try { const tab = await chrome.tabs.get(tabId); return tab.favIconUrl ?? "" }
  catch { return "" }
}

// ── Message handlers (popup → background) ─────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── Approval ────────────────────────────────────────────────────────────────
  if (msg?.type === "MENOID_APPROVE") {
    ;(async () => {
      const {
        tabId, walletId, walletName, mode, exposedAddress,
        noidAccountCommitment, noidAccountName, host,
      } = msg

      const conn = makeConnection({
        walletId, walletName, mode, exposedAddress,
        noidAccountCommitment: noidAccountCommitment ?? null,
        noidAccountName: noidAccountName ?? null,
        host,
      })
      await upsertConnection(conn)
      pendingApprovals.delete(tabId)

      const cfg = activeChainConfig()
      notifyTab(tabId, "accountsChanged", [exposedAddress])
      notifyTab(tabId, "connect", { chainId: cfg.chainId })
      notifyTabPort(tabId, { type: "MENOID_APPROVAL_RESULT", accounts: [exposedAddress] })

      await clearPendingApproval()
      await focusDappTab(tabId)
      await closeConnectTabSoon()
      sendResponse({ ok: true })
    })()
    return true
  }

  // ── Rejection ────────────────────────────────────────────────────────────────
  if (msg?.type === "MENOID_REJECT") {
    ;(async () => {
      const { tabId } = msg
      pendingApprovals.delete(tabId)
      notifyTabPort(tabId, {
        type: "MENOID_APPROVAL_RESULT",
        error: { message: "User rejected the request.", code: 4001 },
      })
      await clearPendingApproval()
      await focusDappTab(tabId)
      await closeConnectTabSoon()
      sendResponse({ ok: true })
    })()
    return true
  }

  // ── Focus dapp tab ───────────────────────────────────────────────────────────
  if (msg?.type === "MENOID_FOCUS_DAPP_TAB") {
    ;(async () => {
      await focusDappTab(msg.tabId)
      sendResponse({ ok: true })
    })()
    return true
  }

  // ── Tx approved ──────────────────────────────────────────────────────────────
  if (msg?.type === "MENOID_TX_RESULT") {
    ;(async () => {
      const { txHash, tabId } = msg
      const port = tabPorts.get(tabId)
      if (port) port.postMessage({ type: "MENOID_APPROVAL_RESULT", result: txHash })
      pendingTxRequests.delete(tabId)
      portPendingIds.delete(tabId)
      await clearPendingTx()
      sendResponse({ ok: true })
    })()
    return true
  }

  // ── Tx rejected ──────────────────────────────────────────────────────────────
  if (msg?.type === "MENOID_TX_REJECT") {
    ;(async () => {
      const { tabId } = msg
      const port = tabPorts.get(tabId)
      if (port) port.postMessage({
        type: "MENOID_APPROVAL_RESULT",
        error: { message: "User rejected the transaction", code: 4001 },
      })
      pendingTxRequests.delete(tabId)
      portPendingIds.delete(tabId)
      await clearPendingTx()
      sendResponse({ ok: true })
    })()
    return true
  }

  // ── Network changed (wallet UI → background) ──────────────────────────────
  // Persists the new network and fires chainChanged to all connected dapp tabs.
  if (msg?.type === "MENOID_NETWORK_CHANGED") {
    ;(async () => {
      const { network } = msg
      if (!network || !CHAIN_CONFIG[network]) {
        sendResponse({ ok: false, error: "Unknown network" }); return
      }
      _activeNetwork = network
      await chrome.storage.local.set({ [ACTIVE_NETWORK_KEY]: network })

      const cfg = CHAIN_CONFIG[network]
      // Notify all live dapp tabs about the chain change
      for (const [tabId] of tabPorts.entries()) {
        try {
          const tab = await chrome.tabs.get(tabId)
          if (!tab?.url || tab.url.startsWith("chrome")) continue
          notifyTab(tabId, "chainChanged", cfg.chainId)
        } catch {/* closed */}
      }

      sendResponse({ ok: true })
    })()
    return true
  }

  // ── Noid smart account / mode switch ─────────────────────────────────────────
  if (msg?.type === "MENOID_NOID_ACCOUNT_SWITCHED") {
    ;(async () => {
      const { walletId, noidSmartAccountAddress, noidAccountCommitment, openAddress } = msg
      const allConns = await readConnections()

      for (const [tabId] of tabPorts.entries()) {
        try {
          const tab = await chrome.tabs.get(tabId)
          if (!tab?.url || tab.url.startsWith("chrome")) continue
          const url  = new URL(tab.url)
          const host = url.host
          const conn = allConns.find((c) => c.walletId === walletId && c.host === host)
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
          } else if (openAddress) {
            const updated = { ...conn, exposedAddress: openAddress, mode: "open" as const }
            const list = allConns.map((c) =>
              c.walletId === walletId && c.host === host ? updated : c
            )
            await writeConnections(list)
            notifyTab(tabId, "accountsChanged", [openAddress])
          }
        } catch {/* tab closed */}
      }

      sendResponse({ ok: true })
    })()
    return true
  }

  // ── Account switched ─────────────────────────────────────────────────────────
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
              tabId, host: url.host, origin: url.origin, favicon: tab.favIconUrl ?? "",
            })
          }
        } catch {/* closed */}
      }

      if (liveDappTabs.length === 0) {
        await clearPendingApproval()
        sendResponse({ ok: true, skipped: "no live dapp tabs" })
        return
      }

      const allConns  = await readConnections()
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
        try { await chrome.tabs.get(dapp.tabId) } catch { continue }

        needsApproval = true
        const info = { host: dapp.host, origin: dapp.origin, favicon: dapp.favicon, tabId: dapp.tabId }
        const store = (chrome.storage as any).session ?? chrome.storage.local
        await store.remove("menoid_dismissed_approvals").catch(() => {})
        await storePendingApproval(info)
        pendingApprovals.set(dapp.tabId, { host: dapp.host, origin: dapp.origin, favicon: dapp.favicon })
        await surfaceApproval(info)
      }

      if (!needsApproval) await clearPendingApproval()
      sendResponse({ ok: true })
    })()
    return true
  }

  return false
})