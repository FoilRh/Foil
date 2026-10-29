/**
 * Background worker. Sits between pack sites (content-script ports) and the user's Foil
 * tab (an external port). Decides with core.decide(), asks the user to confirm anything
 * that moves assets or signs, and forwards approved work to the Foil tab, which holds
 * the keys and talks to Foil only through OHTTP.
 */
import { WIPE, decide, fromWire, pacScript, type Session, type WirePolicy } from "./core";

/** Build-time: e.g. "HTTPS tunnel.foil.example:443". Empty: pack sites are reached directly. */
declare const TUNNEL_PROXY: string;

async function routeThroughTunnel(on: boolean) {
  if (!TUNNEL_PROXY) return;
  if (on) await chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data: pacScript(TUNNEL_PROXY) } }, scope: "regular" });
  else await chrome.proxy.settings.clear({ scope: "regular" });
}

let session: Session = { policy: null, pausedReason: null };
let app: chrome.runtime.Port | null = null;
const pages = new Set<chrome.runtime.Port>();
const appCalls = new Map<number, (r: { result?: unknown; error?: string }) => void>();
const confirms = new Map<number, (approved: boolean) => void>();
let seq = 0;

// Session survives a worker restart (MV3 workers are short-lived). Handlers await this, so a
// request that wakes the worker is answered with the restored tin, not an empty session.
const restored = chrome.storage.session.get("session").then((v) => {
  const s = v.session as { policy: WirePolicy | null; pausedReason: string | null } | undefined;
  if (s) session = { policy: s.policy ? fromWire(s.policy) : null, pausedReason: s.pausedReason };
});
async function setSession(policy: WirePolicy | null, pausedReason: string | null) {
  session = { policy: policy ? fromWire(policy) : null, pausedReason };
  await chrome.storage.session.set({ session: { policy, pausedReason } });
}

function broadcast(event: string, data: unknown) {
  pages.forEach((p) => p.postMessage({ event, data }));
}

/**
 * Navigate a tab to about:blank and wait until it loads (its pack page has unloaded). A page
 * that holds on (a beforeunload prompt, or anything else past 5 s) has its tab closed
 * instead, so no pack page outlives the wipe. Resolves true if the tab was closed.
 */
function blank(id: number) {
  return new Promise<boolean>((done) => {
    const finish = (closed: boolean) => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(on); done(closed); };
    const close = () => chrome.tabs.remove(id).catch(() => {}).then(() => finish(true));
    const on = (tid: number, info: { status?: string }, tab: chrome.tabs.Tab) => {
      if (tid === id && info.status === "complete" && tab.url === "about:blank") finish(false);
    };
    const timer = setTimeout(close, 5000);
    chrome.tabs.onUpdated.addListener(on);
    chrome.tabs.update(id, { url: "about:blank" }).catch(close);
  });
}

/**
 * Fresh storage for every tin (Build §5A.1). No pack page may see the next tin while it can
 * still write storage (an unload handler would re-persist an old ID under it, linking the
 * tins). So: pause, drop every page port, blank the pack tabs, wipe. Only then does the
 * caller set the next tin and reopen the returned tabs.
 */
async function retirePackPages(reason: string | null) {
  await setSession(null, reason ?? "Switching to a fresh tin.");
  broadcast("accountsChanged", []);
  pages.forEach((p) => p.disconnect());
  pages.clear();
  const tabs = (await chrome.tabs.query({ url: WIPE.origins.map((o) => `${o}/*`) })).filter((t) => t.id !== undefined);
  const closed = await Promise.all(tabs.map((t) => blank(t.id!)));
  await chrome.browsingData.remove({ origins: WIPE.origins as [string, ...string[]] }, WIPE.dataTypes);
  return tabs.map((t, i) => ({ ...t, closed: closed[i] }));
}

function callApp(msg: Record<string, unknown>): Promise<unknown> {
  if (!app) return Promise.reject(Object.assign(new Error("Open your Foil tab to continue."), { code: 4900 }));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    appCalls.set(id, (r) => (r.error ? reject(Object.assign(new Error(r.error), { code: 4001 })) : resolve(r.result)));
    app!.postMessage({ ...msg, id });
  });
}

async function confirmWithUser(summary: string, origin: string): Promise<boolean> {
  const id = ++seq;
  const url = chrome.runtime.getURL(`confirm.html?id=${id}&s=${encodeURIComponent(summary)}&o=${encodeURIComponent(origin)}`);
  await chrome.windows.create({ url, type: "popup", width: 380, height: 440 });
  return new Promise((resolve) => confirms.set(id, resolve));
}

chrome.runtime.onMessage.addListener((msg: { type?: string; id?: number; approved?: boolean }) => {
  if (msg.type === "confirm-result" && msg.id !== undefined) {
    confirms.get(msg.id)?.(Boolean(msg.approved));
    confirms.delete(msg.id);
  }
});

// Pack site pages.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "page") return;
  pages.add(port);
  port.onDisconnect.addListener(() => pages.delete(port));
  port.onMessage.addListener(async (req: { id: number; method: string; params: unknown[]; origin: string }) => {
    const reply = (body: { result?: unknown; error?: { code: number; message: string } }) => port.postMessage({ id: req.id, ...body });
    await restored;
    const d = decide(session, req.origin, req.method, req.params);
    try {
      if (d.kind === "result") return reply({ result: d.result });
      if (d.kind === "error") return reply({ error: { code: d.code, message: d.message } });
      if (d.kind === "read") return reply({ result: await callApp({ type: "read", method: req.method, params: req.params }) });
      if (!(await confirmWithUser(d.verdict.summary, req.origin))) return reply({ error: { code: 4001, message: "Rejected in Foil." } });
      return reply({ result: await callApp({ type: "sign", method: req.method, params: req.params, origin: req.origin }) });
    } catch (e) {
      const err = e as Error & { code?: number };
      reply({ error: { code: err.code ?? 4001, message: err.message } });
    }
  });
});

// The user's Foil tab (externally_connectable). It owns the session.
chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== "foil-app") return;
  app = port;
  port.onDisconnect.addListener(async () => {
    if (app === port) app = null;
    await setSession(null, "Foil was closed. Open Foil to continue.");
    broadcast("accountsChanged", []);
  });
  port.onMessage.addListener(async (msg: { type: string; id?: number; policy?: WirePolicy | null; reason?: string; result?: unknown; error?: string }) => {
    // "ping": the Foil tab's heartbeat. Any message keeps the worker (and every port) alive.
    if (msg.type === "ping") return;
    await restored;
    if (msg.type === "reply" && msg.id !== undefined) {
      appCalls.get(msg.id)?.({ result: msg.result, error: msg.error });
      appCalls.delete(msg.id);
    } else if (msg.type === "session") {
      // A fresh tin (or a pause): new tin → fresh site storage, so tins cannot be linked.
      const changed = session.policy?.tin !== msg.policy?.tin;
      const tabs = changed ? await retirePackPages(msg.reason ?? null) : [];
      await setSession(msg.policy ?? null, msg.reason ?? null);
      await routeThroughTunnel(Boolean(msg.policy));
      if (changed) {
        await Promise.all(tabs.map((t) => (!t.url ? undefined : t.closed ? chrome.tabs.create({ url: t.url }) : chrome.tabs.update(t.id!, { url: t.url }))));
        broadcast("accountsChanged", session.policy ? [session.policy.tin] : []);
      }
      port.postMessage({ type: "session-ack", tin: session.policy?.tin ?? null });
    }
  });
});
