/**
 * inpage.ts
 *
 * Injected directly into the PAGE's JavaScript world (not isolated
 * content-script world). Sets up window.ethereum with the EIP-1193
 * provider interface.
 *
 * Communication model:
 *   inpage → content script: window.postMessage({ type: "MENOID_REQUEST", ... })
 *   content script → inpage: window.postMessage({ type: "MENOID_RESPONSE", ... })
 *
 * This file must be compiled as a standalone IIFE and injected via
 * a <script> tag by the content script.
 */

;(function () {
  if ((window as any).__menoidInjected) return
  ;(window as any).__menoidInjected = true

  type RequestArguments = { method: string; params?: any[] }

  // ── Pending request registry ───────────────────────────────────────────
  let _nextId = 1
  const _pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: any) => void }
  >()

  // Track connected accounts (returned by eth_requestAccounts / eth_accounts)
  let _accounts: string[] = []

  // Event listeners (EIP-1193)
  const _listeners: Record<string, Set<Function>> = {}

  function emit(event: string, ...args: any[]) {
    const handlers = _listeners[event]
    if (!handlers) return
    for (const fn of handlers) {
      try {
        fn(...args)
      } catch {}
    }
  }

  // ── Listen for responses from the content script ───────────────────────
  window.addEventListener("message", (e) => {
    if (e.source !== window) return
    const msg = e.data
    if (!msg || msg.type !== "MENOID_RESPONSE") return

    const prom = _pending.get(msg.id)
    if (!prom) return
    _pending.delete(msg.id)

    if (msg.error) {
      const err = new Error(msg.error.message ?? "Request rejected")
      ;(err as any).code = msg.error.code ?? 4001
      prom.reject(err)
    } else {
      prom.resolve(msg.result)
    }
  })

  // ── Listen for wallet-initiated events ─────────────────────────────────
  window.addEventListener("message", (e) => {
    if (e.source !== window) return
    const msg = e.data
    if (!msg || msg.type !== "MENOID_EVENT") return
    if (msg.event === "accountsChanged") {
      _accounts = msg.data ?? []
      emit("accountsChanged", _accounts)
    } else if (msg.event === "chainChanged") {
      emit("chainChanged", msg.data)
    } else if (msg.event === "connect") {
      emit("connect", msg.data)
    } else if (msg.event === "disconnect") {
      emit("disconnect", msg.data)
    }
  })

  // ── EIP-1193 provider ──────────────────────────────────────────────────
  const provider = {
    isMetaMask: false,
    isMenoid: true,
    isConnected: () => _accounts.length > 0,

    request({ method, params = [] }: RequestArguments): Promise<any> {
      return new Promise((resolve, reject) => {
        const id = _nextId++
        _pending.set(id, { resolve, reject })
        window.postMessage(
          { type: "MENOID_REQUEST", id, method, params },
          "*"
        )
      })
    },

    on(event: string, listener: Function) {
      if (!_listeners[event]) _listeners[event] = new Set()
      _listeners[event].add(listener)
      return provider
    },

    removeListener(event: string, listener: Function) {
      _listeners[event]?.delete(listener)
      return provider
    },

    once(event: string, listener: Function) {
      const wrapper = (...args: any[]) => {
        listener(...args)
        provider.removeListener(event, wrapper)
      }
      return provider.on(event, wrapper)
    },

    // Legacy eth_requestAccounts shorthand
    enable() {
      return provider.request({ method: "eth_requestAccounts" })
    },

    // Legacy sendAsync / send compatibility shims
    sendAsync(
      payload: { id: number; method: string; params?: any[] },
      cb: (err: any, res: any) => void
    ) {
      provider
        .request({ method: payload.method, params: payload.params })
        .then((result) =>
          cb(null, { id: payload.id, jsonrpc: "2.0", result })
        )
        .catch((err) => cb(err, null))
    },

    send(
      methodOrPayload: string | { method: string; params?: any[] },
      paramsOrCb?: any[] | ((err: any, res: any) => void)
    ) {
      if (typeof methodOrPayload === "string") {
        // send(method, params) → returns promise
        return provider.request({
          method: methodOrPayload,
          params: paramsOrCb as any[],
        })
      }
      // send(payload, callback)
      const cb = paramsOrCb as (err: any, res: any) => void
      provider.sendAsync(methodOrPayload as any, cb)
    },
  }

  // Expose as window.ethereum (EIP-1193)
  try {
    Object.defineProperty(window, "ethereum", {
      value: provider,
      writable: false,
      configurable: false,
    })
  } catch {
    // If another wallet already defined it non-writable, just try to set
    ;(window as any).ethereum = provider
  }

  // EIP-6963: announce provider
  const info = {
    uuid: "menoid-wallet-" + Math.random().toString(36).slice(2),
    name: "Menoid",
    icon: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iI0U4QUUzQSIvPjx0ZXh0IHg9IjE2IiB5PSIyMSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzE3MTMxMSIgZm9udC1zaXplPSIxNCIgZm9udC13ZWlnaHQ9IjcwMCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiPk08L3RleHQ+PC9zdmc+",
    rdns: "io.menoid",
  }

  window.dispatchEvent(
    new CustomEvent("eip6963:announceProvider", {
      detail: Object.freeze({ info, provider }),
    })
  )

  window.addEventListener("eip6963:requestProvider", () => {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info, provider }),
      })
    )
  })
})()