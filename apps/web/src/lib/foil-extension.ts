"use client";
/**
 * Bridge between the dashboard (which holds the keys) and the Foil browser extension
 * (which injects the guarded provider into pack sites). Build §5A.2:
 *   - spend limits, cool-off and region are checked before a tin is handed over
 *   - only one ready tin is exposed; when a card lands in it, the pack spend is recorded,
 *     the tin is retired and the next ready tin takes over (the extension wipes site storage)
 *   - with no ready tin left, ripping pauses until the next round funds one
 * Every signing request is re-checked here with the same guard before the tin signs.
 */
import { useSyncExternalStore } from "react";
import { parseAbiItem, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkRequest, type Policy } from "@foil/guard";
import {
  NO_READY_TIN, createChainClient, policyFor, readyTins, sendFromTin, type CcConfig, type TinRec, type Wallet,
} from "@foil/client";
import { usdgAbi } from "@foil/protocol";
import { publicEnv } from "@/env";
import { assertRipAllowed, logActivity } from "./foil-workspace";

const EXT_ID = publicEnv.NEXT_PUBLIC_FOIL_EXTENSION_ID;
/** The extension's Chrome Web Store page, once its ID is configured. */
export const EXTENSION_STORE_URL = EXT_ID ? `https://chromewebstore.google.com/detail/${EXT_ID}` : null;
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");

interface ChromePort {
  postMessage(m: unknown): void;
  onMessage: { addListener(fn: (m: Record<string, unknown>) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
  disconnect(): void;
}
type ChromeRuntime = { connect(id: string, info: { name: string }): ChromePort };

export interface RipState { available: boolean; connected: boolean; tin: TinRec | null; paused: string | null; error: string | null; version: number }
let state: RipState = { available: false, connected: false, tin: null, paused: null, error: null, version: 0 };
const listeners = new Set<() => void>();
const emit = (patch: Partial<RipState>) => {
  state = { ...state, ...patch, version: state.version + 1 };
  listeners.forEach((l) => l());
};
const server: RipState = { available: false, connected: false, tin: null, paused: null, error: null, version: 0 };

const runtime = (): ChromeRuntime | null => {
  const c = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome;
  return EXT_ID && c?.runtime?.connect ? c.runtime : null;
};

export function useRipping(): RipState {
  return useSyncExternalStore(
    (fn) => {
      if (!state.available && runtime()) emit({ available: true });
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => server,
  );
}

let port: ChromePort | null = null;
let wallet: Wallet | null = null;
let cc: CcConfig | null = null;
let policy: Policy | null = null;
let poller: ReturnType<typeof setInterval> | undefined;
let fromBlock = 0n;

async function holdings(w: Wallet, t: TinRec) {
  const chain = createChainClient(w.api);
  const usdg = (await chain.readContract({ address: cc!.usdg, abi: usdgAbi, functionName: "balanceOf", args: [t.address] })) as bigint;
  const logs = await chain.getLogs({ address: cc!.cards, event: TRANSFER, args: { to: t.address }, fromBlock: w.cfg.startBlock });
  const cards: bigint[] = [];
  for (const l of logs) {
    const id = l.args.tokenId!;
    const owner = await chain.readContract({
      address: cc!.cards, functionName: "ownerOf", args: [id],
      abi: [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "address" }] }],
    }).catch(() => null);
    if (owner?.toLowerCase() === t.address.toLowerCase()) cards.push(id);
  }
  return { usdg, cards };
}

const toWire = (p: Policy | null) => (p ? { ...p, usdgBalance: p.usdgBalance.toString(), cards_: p.cards_.map(String) } : null);

/** Hand the next ready tin to the extension, or pause. */
async function nextTin() {
  const w = wallet!;
  const t = readyTins(w.state.tins)[0];
  if (!t) {
    policy = null;
    port?.postMessage({ type: "session", policy: null, reason: NO_READY_TIN });
    emit({ tin: null, paused: NO_READY_TIN });
    return;
  }
  try {
    assertRipAllowed(Number(t.usdg ?? t.size) / 1e6); // a rip that would break a cap never gets a tin
  } catch (e) {
    policy = null;
    const reason = e instanceof Error ? e.message : "Ripping is paused.";
    port?.postMessage({ type: "session", policy: null, reason });
    emit({ tin: null, paused: reason });
    return;
  }
  policy = policyFor(t, cc!, await holdings(w, t));
  fromBlock = await createChainClient(w.api).getBlockNumber();
  port?.postMessage({ type: "session", policy: toWire(policy) });
  emit({ tin: t, paused: null });
}

/** When a card lands in the active tin: record the spend, retire the tin, rotate. */
async function watch() {
  const w = wallet;
  const t = state.tin;
  if (!w || !t || !cc) return;
  const logs = await createChainClient(w.api).getLogs({ address: cc.cards, event: TRANSFER, args: { to: t.address }, fromBlock });
  if (!logs.length) return;
  const now = await holdings(w, t);
  const spent = Number(BigInt(t.usdg ?? t.size) - now.usdg) / 1e6;
  logActivity("Pack ripped", `Tin ${t.index + 1} · card #${logs[0]!.args.tokenId}`, -Math.max(spent, 0), "pack-spend");
  w.markRipped(t.index);
  w.state = { ...w.state, tins: w.state.tins.map((x) => (x.index === t.index ? { ...x, usdg: now.usdg.toString(), cards: now.cards.map(String) } : x)) };
  await nextTin();
}

async function handle(msg: Record<string, unknown>) {
  const id = msg.id as number;
  const reply = (body: { result?: unknown; error?: string }) => port?.postMessage({ type: "reply", id, ...body });
  try {
    const w = wallet!;
    const chain = createChainClient(w.api);
    const method = msg.method as string;
    const params = (msg.params as unknown[]) ?? [];
    if (msg.type === "read") return reply({ result: await chain.request({ method, params } as never) });
    if (!policy || !state.tin) return reply({ error: "No active tin." });
    // Defense in depth: the same guard, again, with fresh holdings, before the tin signs.
    policy = { ...policy, ...(await holdings(w, state.tin).then((h) => ({ usdgBalance: h.usdg, cards_: h.cards }))) };
    const v = checkRequest(method, params, policy, msg.origin as string);
    if (!v.allow) return reply({ error: `Foil blocked this request: ${v.reason}` });
    const key = w.keys.tin(state.tin.index).privateKey;
    const tin = privateKeyToAccount(key);
    if (method === "eth_sendTransaction") {
      const tx = params[0] as { to: Hex; data: Hex };
      const { hash } = await sendFromTin(w.api, chain, key, { to: tx.to, data: tx.data });
      return reply({ result: hash });
    }
    if (method === "personal_sign") return reply({ result: await tin.signMessage({ message: { raw: params[0] as Hex } }) });
    if (method === "eth_signTypedData_v4") {
      const td = JSON.parse(params[1] as string) as Parameters<typeof tin.signTypedData>[0];
      return reply({ result: await tin.signTypedData(td) });
    }
    if (method === "wallet_switchEthereumChain") return reply({ result: null });
    return reply({ error: `${method} is not available` });
  } catch (e) {
    reply({ error: e instanceof Error ? e.message : "Request failed." });
  }
}

/** Connect to the extension and hand it the first ready tin. */
export async function startRipping(w: Wallet) {
  const rt = runtime();
  if (!rt) throw new Error("Install the Foil extension in this browser to rip.");
  const cfg = await w.api.config.query();
  if (!cfg.cc) throw new Error("Pack sites are not connected yet.");
  wallet = w;
  cc = { chainId: cfg.chainId, usdg: cfg.usdg as Address, vault: cfg.cc.vault as Address, cards: cfg.cc.cards as Address, shippingPayees: cfg.cc.shippingPayees as Address[] };
  port = connectPort(rt);
  emit({ connected: true, error: null });
  await nextTin();
  clearInterval(poller);
  poller = setInterval(() => {
    // Heartbeat: browsers stop an extension worker after ~30 s without messages, which drops
    // the pack page's connection mid-sign-in. Any message keeps it awake while ripping.
    try { port?.postMessage({ type: "ping" }); } catch { /* dropped: onDisconnect reconnects */ }
    void watch().catch((e) => emit({ error: e instanceof Error ? e.message : "Watch failed." }));
  }, 5_000);
}

let reconnectedAt = 0;
function connectPort(rt: ChromeRuntime): ChromePort {
  const p = rt.connect(EXT_ID!, { name: "foil-app" });
  p.onMessage.addListener((m) => void (m.type === "read" || m.type === "sign" ? handle(m) : undefined));
  p.onDisconnect.addListener(() => {
    if (port !== p) return;
    // The extension's worker restarted: reconnect once and hand it the same tin again. A
    // second drop within 5 s means the extension is gone (removed or disabled): stop.
    if (wallet && Date.now() - reconnectedAt > 5_000) {
      reconnectedAt = Date.now();
      port = connectPort(rt);
      if (policy) port.postMessage({ type: "session", policy: toWire(policy) });
    } else {
      port = null; // already disconnected: posting on it would throw
      stopRipping();
    }
  });
  return p;
}

export function stopRipping() {
  clearInterval(poller);
  port?.postMessage({ type: "session", policy: null, reason: "Ripping stopped in Foil." });
  port?.disconnect();
  port = null;
  policy = null;
  emit({ connected: false, tin: null, paused: null });
}

