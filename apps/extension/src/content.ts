/** Isolated-world relay between the page's provider and the extension's background worker. */
const port = chrome.runtime.connect({ name: "page" });

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window) return;
  const d = e.data as { __foil?: string; id?: number; method?: string; params?: unknown[] };
  if (d?.__foil !== "req") return;
  port.postMessage({ id: d.id, method: d.method, params: d.params ?? [], origin: window.location.origin });
});

port.onMessage.addListener((msg: { id?: number; result?: unknown; error?: unknown; event?: string; data?: unknown }) => {
  if (msg.event) window.postMessage({ __foil: "event", event: msg.event, data: msg.data }, window.location.origin);
  else window.postMessage({ __foil: "res", id: msg.id, result: msg.result, error: msg.error }, window.location.origin);
});
