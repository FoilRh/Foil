/**
 * Isolated-world relay between the page's provider and the extension's background worker.
 * MV3 stops an idle worker, which disconnects this port; it is reopened on the next request
 * (opening it wakes the worker), and a request that still cannot be sent gets an error
 * instead of waiting forever.
 */
let port: chrome.runtime.Port | null = null;

function connect(): chrome.runtime.Port {
  const p = chrome.runtime.connect({ name: "page" });
  p.onDisconnect.addListener(() => { if (port === p) port = null; });
  p.onMessage.addListener((msg: { id?: number; result?: unknown; error?: unknown; event?: string; data?: unknown }) => {
    if (msg.event) window.postMessage({ __foil: "event", event: msg.event, data: msg.data }, window.location.origin);
    else window.postMessage({ __foil: "res", id: msg.id, result: msg.result, error: msg.error }, window.location.origin);
  });
  return p;
}

function send(req: { id?: number; method?: string; params: unknown[]; origin: string }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      port ??= connect();
      port.postMessage(req);
      return;
    } catch {
      port = null; // disconnected under us: reopen once
    }
  }
  window.postMessage({ __foil: "res", id: req.id, error: { code: 4900, message: "Foil is not reachable. Reload this page." } }, window.location.origin);
}

port = connect();

window.addEventListener("message", (e: MessageEvent) => {
  if (e.origin !== window.location.origin) {
    return; // same origin only
  }
  if (e.source !== window) return; // and this window only
  const d = e.data as { __foil?: string; id?: number; method?: string; params?: unknown[] };
  if (d?.__foil !== "req") return;
  send({ id: d.id, method: d.method, params: d.params ?? [], origin: window.location.origin });
});
