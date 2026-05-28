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
//    (the worker dies after ~30s of no messages)

let _port: chrome.runtime.Port | null = null
let _keepaliveTimer: ReturnType<typeof setInterval> | null = null
const _pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()
const pendingAccountRequests = new Map<number, (result: any) => void>()

function stopKeepalive() {
  if (_keepaliveTimer) {
    clearInterval(_keepaliveTimer)
    _keepaliveTimer = null
  }
}

function startKeepalive(port: chrome.runtime.Port) {
  stopKeepalive()
  _keepaliveTimer = setInterval(() => {
    if (_pending.size === 0 && pendingAccountRequests.size === 0) {
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
    if (msg?.type === 'MENOID_RPC_RESPONSE') {
      const p = _pending.get(msg.id)
      if (!p) return
      _pending.delete(msg.id)

      if (_pending.size === 0 && pendingAccountRequests.size === 0) stopKeepalive()

      if (msg.pending) {
        console.log('[Menoid content] approval pending, waiting for user...')
        pendingAccountRequests.set(msg.id, (result: any) => {
          window.postMessage({ type: 'MENOID_RESPONSE', id: msg.id, ...result }, '*')
        })
        return
      }

      if (msg.error) {
        p.reject(new Error(msg.error.message ?? 'Request failed'))
      } else {
        p.resolve(msg.result)
      }
      return
    }

    if (msg?.type === 'MENOID_APPROVAL_RESULT') {
      console.log('[Menoid content] got approval result:', msg)
      pendingAccountRequests.forEach((cb) => {
        cb(msg.error ? { error: msg.error } : { result: msg.accounts })
      })
      pendingAccountRequests.clear()
      stopKeepalive()
      return
    }

    if (msg?.type === 'MENOID_EVENT') {
      window.postMessage(msg, '*')
    }
  })

  port.onDisconnect.addListener(() => {
    console.log('[Menoid content] port disconnected')
    stopKeepalive()
    _port = null

    // If there were pending requests, retry by reconnecting once
    if (_pending.size > 0) {
      console.log('[Menoid content] retrying', _pending.size, 'pending requests after reconnect...')
      const pendingEntries = Array.from(_pending.entries())
      _pending.clear()

      setTimeout(() => {
        const newPort = connectPort()
        _port = newPort
        startKeepalive(newPort)
        for (const [id, { resolve, reject }] of pendingEntries) {
          _pending.set(id, { resolve, reject })
          // We don't have the original msg here, so reject — caller will retry
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
        type: 'MENOID_RPC',  // must come AFTER spread so it wins over msg.type
        host: location.host,
        origin: location.origin,
      })
    } catch (e) {
      _pending.delete(id)
      reject(e)
    }
  })
}

// ── Bridge: page → background ─────────────────────────────────────────────
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
        error: { message: err?.message ?? 'Extension error. Please refresh.', code: 4001 },
      }, '*')
    })
})