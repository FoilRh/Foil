/**
 * Runs in the pack site's page (MAIN world). Exposes an EIP-1193 provider, announced via
 * EIP-6963 (no WalletConnect), that only ever shows the active tin on Robinhood Chain.
 * Every request goes to the extension; nothing here holds keys.
 */
type Listener = (...args: unknown[]) => void;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
const listeners = new Map<string, Set<Listener>>();
let nextId = 0;

class ProviderRpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

const provider = {
  isFoil: true,
  request({ method, params }: { method: string; params?: unknown[] }) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      window.postMessage({ __foil: "req", id, method, params: params ?? [] }, window.location.origin);
    });
  },
  on(event: string, fn: Listener) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
    return provider;
  },
  removeListener(event: string, fn: Listener) {
    listeners.get(event)?.delete(fn);
    return provider;
  },
};

window.addEventListener("message", (e: MessageEvent) => {
  if (e.origin !== window.location.origin) {
    return; // same origin only
  }
  if (e.source !== window) return; // and this window only
  const d = e.data as { __foil?: string; id?: number; result?: unknown; error?: { code: number; message: string }; event?: string; data?: unknown };
  if (d?.__foil === "res" && d.id !== undefined) {
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.error) p.reject(new ProviderRpcError(d.error.code, d.error.message));
    else p.resolve(d.result);
  } else if (d?.__foil === "event" && d.event) {
    for (const fn of listeners.get(d.event) ?? []) fn(d.data);
  }
});

const info = {
  uuid: crypto.randomUUID(),
  name: "Foil",
  rdns: "app.foil",
  icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iIzA4MTQwZiIvPjx0ZXh0IHg9IjE2IiB5PSIyMiIgZm9udC1zaXplPSIxNiIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZpbGw9IiNmMmM3NjgiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkY8L3RleHQ+PC9zdmc+",
};
const announce = () =>
  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
window.addEventListener("eip6963:requestProvider", announce);
announce();
const w = window as unknown as { ethereum?: unknown };
if (!w.ethereum) w.ethereum = provider;
