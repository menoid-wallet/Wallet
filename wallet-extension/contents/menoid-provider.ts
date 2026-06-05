console.log('[Menoid] content script running', document.readyState)

export const config = {
  matches: ['<all_urls>'],
  run_at: 'document_start' as const,
}

// ── Inject inpage.js into the page world ──────────────────────────────────
try {
  const url = chrome.runtime.getURL('assets/inpage.js')
  console.log('[Menoid] injecting inpage from:', url)
  const script = document.createElement('script')
  script.src = url
  script.type = 'text/javascript'
  script.onload = () => {
    console.log('[Menoid] inpage.js loaded successfully')
    script.remove()
  }
  script.onerror = (e) => console.error('[Menoid] inpage.js failed to load:', e)
  ;(document.head || document.documentElement).appendChild(script)
} catch (e) {
  console.error('[Menoid] content script failed to inject inpage:', e)
}

// ── Port-based bridge to background ──────────────────────────────────────
// MV3 service workers die aggressively. We keep the worker alive by:
// 1. Using a persistent port (chrome.runtime.connect) instead of sendMessage
// 2. Sending a keepalive ping every 20s while there are pending requests

let _port: chrome.runtime.Port | null = null
let _keepaliveTimer: ReturnType<typeof setInterval> | null = null

// All in-flight requests keyed by id — resolves/rejects when background responds
const _pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()

// eth_sendTransaction still uses a separate pending channel (MENOID_APPROVAL_RESULT)
// because the tx signing happens asynchronously in the wallet UI.
// eth_requestAccounts NO LONGER uses this — it now resolves directly via _pending.
const pendingTxRequests = new Map<number, (result: any) => void>()

function stopKeepalive() {
  if (_keepaliveTimer) {
    clearInterval(_keepaliveTimer)
    _keepaliveTimer = null
  }
}

function startKeepalive(port: chrome.runtime.Port) {
  stopKeepalive()
  _keepaliveTimer = setInterval(() => {
    if (_pending.size === 0 && pendingTxRequests.size === 0) {
      stopKeepalive()
      return
    }
    try {
      port.postMessage({ type: 'MENOID_KEEPALIVE' })
    } catch {
      stopKeepalive()
    }
  }, 20_000)
}

function connectPort(): chrome.runtime.Port {
  const port = chrome.runtime.connect({ name: 'menoid-rpc' })
  console.log('[Menoid content] connected port to background')

  port.onMessage.addListener((msg) => {
    // ── Standard RPC response ─────────────────────────────────────────
    if (msg?.type === 'MENOID_RPC_RESPONSE') {
      const p = _pending.get(msg.id)
      if (!p) return

      // NOTE: eth_requestAccounts no longer returns { pending: true }.
      // The background holds the promise open until user approves/rejects.
      // So we never see msg.pending for eth_requestAccounts anymore.
      // We still handle it for eth_sendTransaction which uses the old pattern.
      if (msg.pending) {
        console.log('[Menoid content] tx pending, waiting for user...')
        pendingTxRequests.set(msg.id, (result: any) => {
          _pending.delete(msg.id)
          if (_pending.size === 0 && pendingTxRequests.size === 0) stopKeepalive()
          window.postMessage({ type: 'MENOID_RESPONSE', id: msg.id, ...result }, '*')
        })
        return
      }

      _pending.delete(msg.id)
      if (_pending.size === 0 && pendingTxRequests.size === 0) stopKeepalive()

      if (msg.error) {
        p.reject(Object.assign(new Error(msg.error.message ?? 'Request failed'), { code: msg.error.code ?? 4001 }))
      } else {
        p.resolve(msg.result)
      }
      return
    }

    // ── Tx approval result (eth_sendTransaction) ──────────────────────
    if (msg?.type === 'MENOID_APPROVAL_RESULT') {
      console.log('[Menoid content] got tx approval result:', msg)
      pendingTxRequests.forEach((cb) => {
        cb(msg.error ? { error: msg.error } : { result: msg.result ?? msg.accounts })
      })
      pendingTxRequests.clear()
      stopKeepalive()
      return
    }

    // ── Wallet-initiated events (accountsChanged, chainChanged, etc.) ──
    if (msg?.type === 'MENOID_EVENT') {
      window.postMessage(msg, '*')
    }
  })

  port.onDisconnect.addListener(() => {
    console.log('[Menoid content] port disconnected')
    stopKeepalive()
    _port = null

    if (_pending.size > 0) {
      console.log('[Menoid content] retrying', _pending.size, 'pending requests after reconnect...')
      const pendingEntries = Array.from(_pending.entries())
      _pending.clear()

      setTimeout(() => {
        const newPort = connectPort()
        _port = newPort
        startKeepalive(newPort)
        for (const [, { reject }] of pendingEntries) {
          reject(new Error('Extension restarted. Please try again.'))
        }
        _pending.clear()
      }, 200)
    }
  })

  return port
}

function getPort(): chrome.runtime.Port {
  if (!_port) {
    _port = connectPort()
  }
  return _port
}

function sendToBackground(msg: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = msg.id
    _pending.set(id, { resolve, reject })

    try {
      const port = getPort()
      startKeepalive(port)
      port.postMessage({
        ...msg,
        type: 'MENOID_RPC',
        host: location.host,
        origin: location.origin,
      })
    } catch (e) {
      _pending.delete(id)
      reject(e)
    }
  })
}

// ── Bridge: page world → background ──────────────────────────────────────
// Receives MENOID_REQUEST from inpage.ts, forwards to background,
// posts MENOID_RESPONSE back to inpage.ts with the result.
window.addEventListener('message', (e) => {
  if (e.source !== window) return
  const msg = e.data
  if (!msg || msg.type !== 'MENOID_REQUEST') return

  console.log('[Menoid content] got request, forwarding to background:', msg)

  sendToBackground(msg)
    .then((response) => {
      console.log('[Menoid content] got response from background:', response)
      window.postMessage({ type: 'MENOID_RESPONSE', id: msg.id, result: response }, '*')
    })
    .catch((err) => {
      console.error('[Menoid content] error:', err)
      window.postMessage({
        type: 'MENOID_RESPONSE',
        id: msg.id,
        error: { message: err?.message ?? 'Extension error. Please refresh.', code: (err as any)?.code ?? 4001 },
      }, '*')
    })
})