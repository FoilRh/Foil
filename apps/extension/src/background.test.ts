// Tin rotation order (audit tin-rotation-race): a pack page must never see the next tin
// before its tab is blanked and the pack sites' storage is wiped.
import { expect, test } from "bun:test";
import type { Address } from "viem";
import type { Policy } from "@foil/guard";
import { toWire } from "./core";

type Listener = (...a: any[]) => unknown;
const hub = () => { const ls: Listener[] = []; return { ls, addListener: (f: Listener) => ls.push(f), removeListener: (f: Listener) => ls.splice(ls.indexOf(f) >>> 0, 1) }; };
const port = (name: string) => {
  const msg = hub(), disc = hub(), sent: any[] = [];
  return { name, sent, onMessage: msg, onDisconnect: disc, postMessage: (m: any) => sent.push(m), disconnect: () => log.push("disconnect"), emit: (m: any) => Promise.all(msg.ls.map((f) => f(m))) };
};

const log: string[] = [];
const ev = { connect: hub(), external: hub(), message: hub(), updated: hub() };
let stored: any;
let stubborn = false; // a page that never lets its tab navigate away (beforeunload prompt)
(globalThis as any).TUNNEL_PROXY = "";
(globalThis as any).chrome = {
  storage: { session: { get: async () => ({}), set: async (v: any) => { stored = v.session; log.push(`session:${v.session.policy?.tin ?? "none"}`); } } },
  proxy: { settings: { set: async () => {}, clear: async () => {} } },
  browsingData: { remove: async () => { log.push("wipe"); } },
  tabs: {
    query: async () => [{ id: 7, url: "https://gacha.collectorcrypt.com/pack" }],
    update: async (id: number, u: { url: string }) => {
      log.push(`tab:${u.url}`);
      // The pack page unloads; its unload handler asks for the account right then.
      if (u.url === "about:blank" && stubborn) return;
      if (u.url === "about:blank") { log.push(`unload-sees:${stored?.policy?.tin ?? "none"}`); queueMicrotask(() => ev.updated.ls.forEach((f) => f(id, { status: "complete" }, { url: "about:blank" }))); }
    },
    remove: async (id: number) => { log.push(`close:${id}`); },
    create: async (c: { url: string }) => { log.push(`open:${c.url}`); },
    onUpdated: ev.updated,
  },
  runtime: { onConnect: ev.connect, onConnectExternal: ev.external, onMessage: ev.message, getURL: (p: string) => p },
};
await import("./background");

const tin = (t: string): Policy => ({
  chainId: 4663, tin: t as Address, usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  vault: "0x4d56B148624e17FD53c08D1C4998e8e3945bDE28", cards: "0xb47a306bD89E8b6fA2b14f553E534AdcD7Cc337F",
  shippingPayees: [], domains: ["gacha.collectorcrypt.com"], usdgBalance: 0n, cards_: [],
});
const A = "0x1111111111111111111111111111111111111111", B = "0x2222222222222222222222222222222222222222";

test("rotation: blank pack tabs, wipe, THEN set the new tin, then reopen", async () => {
  const app = port("foil-app"), page = port("page");
  ev.external.ls.forEach((f) => f(app));
  await app.emit({ type: "session", policy: toWire(tin(A)) });
  ev.connect.ls.forEach((f) => f(page)); // a pack page open under tin A
  log.length = 0;
  await app.emit({ type: "session", policy: toWire(tin(B)) });
  expect(log).toEqual([
    "session:none", "disconnect", "tab:about:blank", "unload-sees:none", "wipe",
    `session:${B}`, "tab:https://gacha.collectorcrypt.com/pack",
  ]);
  expect(app.sent.at(-1)).toEqual({ type: "session-ack", tin: B });
  // The old page is told it has no account and never learns B.
  expect(page.sent).toEqual([{ event: "accountsChanged", data: [] }]);
});

test("same tin again: no wipe", async () => {
  const app = port("foil-app");
  ev.external.ls.forEach((f) => f(app));
  log.length = 0;
  await app.emit({ type: "session", policy: toWire(tin(B)) });
  expect(log).toEqual([`session:${B}`]);
});

test("a pack page that will not unload has its tab closed before the wipe", async () => {
  const app = port("foil-app");
  ev.external.ls.forEach((f) => f(app));
  await app.emit({ type: "session", policy: toWire(tin(A)) });
  stubborn = true;
  log.length = 0;
  await app.emit({ type: "session", policy: toWire(tin(B)) });
  stubborn = false;
  expect(log).toEqual([
    "session:none", "tab:about:blank", "close:7", "wipe", `session:${B}`, "open:https://gacha.collectorcrypt.com/pack",
  ]);
}, 10_000);
