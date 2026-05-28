(() => {
  // lib/inpage.ts
  (function() {
    if (window.__menoidInjected) return;
    window.__menoidInjected = true;
    let _nextId = 1;
    const _pending = /* @__PURE__ */ new Map();
    let _accounts = [];
    const _listeners = {};
    function emit(event, ...args) {
      const handlers = _listeners[event];
      if (!handlers) return;
      for (const fn of handlers) {
        try {
          fn(...args);
        } catch {
        }
      }
    }
    window.addEventListener("message", (e) => {
      if (e.source !== window) return;
      const msg = e.data;
      if (!msg || msg.type !== "MENOID_RESPONSE") return;
      const prom = _pending.get(msg.id);
      if (!prom) return;
      _pending.delete(msg.id);
      if (msg.error) {
        const err = new Error(msg.error.message ?? "Request rejected");
        err.code = msg.error.code ?? 4001;
        prom.reject(err);
      } else {
        prom.resolve(msg.result);
      }
    });
    window.addEventListener("message", (e) => {
      if (e.source !== window) return;
      const msg = e.data;
      if (!msg || msg.type !== "MENOID_EVENT") return;
      if (msg.event === "accountsChanged") {
        _accounts = msg.data ?? [];
        emit("accountsChanged", _accounts);
      } else if (msg.event === "chainChanged") {
        emit("chainChanged", msg.data);
      } else if (msg.event === "connect") {
        emit("connect", msg.data);
      } else if (msg.event === "disconnect") {
        emit("disconnect", msg.data);
      }
    });
    const provider = {
      isMetaMask: false,
      isMenoid: true,
      isConnected: () => _accounts.length > 0,
      request({ method, params = [] }) {
        return new Promise((resolve, reject) => {
          const id = _nextId++;
          _pending.set(id, { resolve, reject });
          window.postMessage(
            { type: "MENOID_REQUEST", id, method, params },
            "*"
          );
        });
      },
      on(event, listener) {
        if (!_listeners[event]) _listeners[event] = /* @__PURE__ */ new Set();
        _listeners[event].add(listener);
        return provider;
      },
      removeListener(event, listener) {
        _listeners[event]?.delete(listener);
        return provider;
      },
      once(event, listener) {
        const wrapper = (...args) => {
          listener(...args);
          provider.removeListener(event, wrapper);
        };
        return provider.on(event, wrapper);
      },
      // Legacy eth_requestAccounts shorthand
      enable() {
        return provider.request({ method: "eth_requestAccounts" });
      },
      // Legacy sendAsync / send compatibility shims
      sendAsync(payload, cb) {
        provider.request({ method: payload.method, params: payload.params }).then(
          (result) => cb(null, { id: payload.id, jsonrpc: "2.0", result })
        ).catch((err) => cb(err, null));
      },
      send(methodOrPayload, paramsOrCb) {
        if (typeof methodOrPayload === "string") {
          return provider.request({
            method: methodOrPayload,
            params: paramsOrCb
          });
        }
        const cb = paramsOrCb;
        provider.sendAsync(methodOrPayload, cb);
      }
    };
    try {
      Object.defineProperty(window, "ethereum", {
        value: provider,
        writable: false,
        configurable: false
      });
    } catch {
      ;
      window.ethereum = provider;
    }
    const info = {
      uuid: "menoid-wallet-" + Math.random().toString(36).slice(2),
      name: "Menoid",
      icon: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iI0U4QUUzQSIvPjx0ZXh0IHg9IjE2IiB5PSIyMSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzE3MTMxMSIgZm9udC1zaXplPSIxNCIgZm9udC13ZWlnaHQ9IjcwMCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiPk08L3RleHQ+PC9zdmc+",
      rdns: "io.menoid"
    };
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info, provider })
      })
    );
    window.addEventListener("eip6963:requestProvider", () => {
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: Object.freeze({ info, provider })
        })
      );
    });
  })();
})();
