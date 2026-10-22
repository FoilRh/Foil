"use client";
/**
 * Live Foil wallet session for the dashboard. Active only when
 * NEXT_PUBLIC_OHTTP_RELAY_URL is set; otherwise the dashboard keeps its local
 * example workspace. Keys live in an encrypted IndexedDB vault and in memory while
 * unlocked; every network call goes through @foil/client's OHTTP transport.
 */
import { useSyncExternalStore } from "react";
import { createPublicClient, createWalletClient, custom, type Address, type EIP1193Provider, type Hex } from "viem";
import {
  Wallet, createApi, createChainClient, emptyState, encodeGiftLink, generateMnemonic, indexedDbKV, isValidMnemonic,
  keysFromMnemonic, loadBackup, loadCrypto, open, saveBackup, seal, type Prover, type TinRec, type TinSnapshot, type WalletState,
} from "@foil/client";
import { applyPrefs, currentPrefs } from "./foil-workspace";
import { applySnapshotDiff, stashPoolAbi, usdgAbi, type TinSetSnapshot, type TinSize } from "@foil/protocol";
import { publicEnv } from "@/env";

export type LivePhase = "off" | "loading" | "new" | "locked" | "unlocked";
export interface LiveState { phase: LivePhase; wallet?: Wallet; syncing: boolean; error?: string; version: number }

const relayUrl = publicEnv.NEXT_PUBLIC_OHTTP_RELAY_URL;
const keyConfig = publicEnv.NEXT_PUBLIC_OHTTP_KEY_CONFIG;
/** Live mode needs both the relay and the pinned gateway key. */
export const liveConfigured = Boolean(relayUrl && keyConfig);

const VAULT_KEY = "vault-v1";
interface VaultContents { mnemonic: string; wallet: WalletState | null }

let state: LiveState = { phase: liveConfigured ? "loading" : "off", syncing: false, version: 0 };
const listeners = new Set<() => void>();
const emit = (patch: Partial<LiveState>) => {
  state = { ...state, ...patch, version: state.version + 1 };
  listeners.forEach((l) => l());
};
const offState: LiveState = { phase: "off", syncing: false, version: 0 };

let passphrase: string | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let started = false;
const kv = () => indexedDbKV();

function start() {
  if (started || !liveConfigured || typeof window === "undefined") return;
  started = true;
  kv().get(VAULT_KEY).then((v) => emit({ phase: v ? "locked" : "new" }), () => emit({ phase: "new" }));
}

export function useLive(): LiveState {
  return useSyncExternalStore(
    (fn) => {
      start();
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => offState,
  );
}

// ---------------------------------------------------------------- prover (Web Worker)

let worker: Worker | undefined;
let jobId = 0;
const jobs = new Map<number, { resolve: (p: never) => void; reject: (e: Error) => void }>();
const workerProver: Prover = (name, input) => {
  worker ??= (() => {
    const w = new Worker(new URL("../workers/prover.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; proof?: never; error?: string }>) => {
      const j = jobs.get(e.data.id);
      if (!j) return;
      jobs.delete(e.data.id);
      if (e.data.error) j.reject(new Error(e.data.error));
      else j.resolve(e.data.proof!);
    };
    return w;
  })();
  const id = ++jobId;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    worker!.postMessage({ id, name, input });
  });
};

// ---------------------------------------------------------------- vault

async function persist(mnemonic: string, w: WalletState) {
  if (!passphrase) return;
  await kv().set(VAULT_KEY, await seal(passphrase, { mnemonic, wallet: w } satisfies VaultContents));
}

async function openWallet(mnemonic: string, saved: WalletState | null) {
  const api = createApi({ relayUrl: relayUrl!, keyConfig: keyConfig! });
  const cfg = await api.config.query();
  // The API must serve the chain this build expects (mainnet), never another.
  if (cfg.chainId !== publicEnv.NEXT_PUBLIC_CHAIN_ID && process.env.NODE_ENV === "production") throw new Error("Unexpected network.");
  const c = await loadCrypto();
  const startBlock = BigInt(cfg.startBlock);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const wallet = new Wallet(
    c, keysFromMnemonic(c, mnemonic), api, createChainClient(api) as never,
    { chainId: cfg.chainId, pool: cfg.pool as Address, usdg: cfg.usdg as Address, poolId: BigInt(cfg.poolId), relayer: cfg.relayer as Address, relayerFee: BigInt(cfg.relayerFeeFloor), startBlock },
    workerProver,
    saved ?? emptyState(startBlock),
    (s) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void persist(mnemonic, s), 300);
      emit({});
    },
  );
  emit({ phase: "unlocked", wallet, error: undefined });
  // Restore limits, cool-off and tin records from the encrypted backup (Build §9).
  try {
    const b = await loadBackup(api, wallet.keys);
    if (b) {
      applyPrefs(b);
      if (!wallet.state.tins.length && b.tins.length) wallet.state = { ...wallet.state, tins: b.tins, nextTin: Math.max(wallet.state.nextTin, b.nextTin) };
    }
  } catch {
    // A missing or unreadable backup must not block the wallet.
  }
  await refresh();
  clearInterval(timer);
  timer = setInterval(() => void refresh(), 30_000);
}

/** New vault: returns the recovery phrase for the user to write down. */
export async function createVault(pass: string): Promise<string> {
  if (pass.length < 10) throw new Error("Use a passphrase of at least 10 characters.");
  const mnemonic = generateMnemonic();
  passphrase = pass;
  await persist(mnemonic, emptyState(0n));
  await openWallet(mnemonic, null);
  return mnemonic;
}

export async function importVault(mnemonic: string, pass: string) {
  if (!isValidMnemonic(mnemonic)) throw new Error("That recovery phrase is not valid.");
  if (pass.length < 10) throw new Error("Use a passphrase of at least 10 characters.");
  passphrase = pass;
  await persist(mnemonic.trim().toLowerCase(), emptyState(0n));
  await openWallet(mnemonic.trim().toLowerCase(), null);
}

export async function unlock(pass: string) {
  const sealed = await kv().get(VAULT_KEY);
  if (!sealed) throw new Error("No wallet on this device.");
  const v = await open<VaultContents>(pass, sealed);
  passphrase = pass;
  await openWallet(v.mnemonic, v.wallet);
}

export function lock() {
  clearInterval(timer);
  passphrase = undefined;
  emit({ phase: "locked", wallet: undefined });
}

/** Sync public pool events, then admit our entries whose standby has ended. */
export async function refresh() {
  const w = state.wallet;
  if (!w || state.syncing) return;
  emit({ syncing: true });
  try {
    await w.sync();
    if (await w.admitReady()) await w.sync();
    // Public tin set: refresh tin balances/cards and recover tins after a restore.
    // After the first download only the changed tins are fetched.
    const d = lastSnapshot ? await w.api.snapshotDiff.query({ since: lastSnapshot.block }) : null;
    const snap = d ? applySnapshotDiff(lastSnapshot, d) : ((await w.api.snapshot.query()) as TinSnapshot | null);
    if (snap) {
      lastSnapshot = snap;
      w.discover(snap as TinSnapshot);
    }
    await backupIfChanged(w);
    emit({ syncing: false, error: undefined });
  } catch (e) {
    emit({ syncing: false, error: e instanceof Error ? e.message : "Sync failed." });
  }
}

let lastBackup = "";
let lastSnapshot: TinSetSnapshot | null = null;
async function backupIfChanged(w: NonNullable<LiveState["wallet"]>) {
  const prefs = currentPrefs();
  const body = JSON.stringify({ prefs, tins: w.state.tins, nextTin: w.state.nextTin });
  if (body === lastBackup) return;
  await saveBackup(w.api, w.keys, { v: 1, updatedAt: new Date().toISOString(), ...prefs, tins: w.state.tins, nextTin: w.state.nextTin });
  lastBackup = body;
}

const need = () => {
  if (!state.wallet) throw new Error("Unlock your Foil wallet first.");
  return state.wallet;
};
const micros = (usdg: number) => {
  if (!Number.isFinite(usdg) || usdg <= 0) throw new Error("Enter an amount greater than zero.");
  return BigInt(Math.round(usdg * 1e6));
};

// ---------------------------------------------------------------- actions

/** Deposit from the user's ordinary browser wallet (a public transaction by design). */
export async function liveDeposit(amountUsdg: number) {
  const w = need();
  const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) throw new Error("No browser wallet was found to send the deposit from.");
  const client = createWalletClient({ transport: custom(provider) });
  // The user's own wallet and its RPC: this deposit is a public transaction by design.
  const reader = createPublicClient({ transport: custom(provider) });
  const [account] = await client.requestAddresses();
  if (!account) throw new Error("The wallet did not return an account.");
  if ((await client.getChainId()) !== w.cfg.chainId) {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${w.cfg.chainId.toString(16)}` }] });
  }
  const d = w.depositArgs(micros(amountUsdg));
  // Launch-period caps (StashPool.setCaps): say so here rather than let the wallet revert.
  const [maxDeposit, maxTotal, held] = (await Promise.all([
    reader.readContract({ address: w.cfg.pool, abi: stashPoolAbi, functionName: "maxDeposit" }),
    reader.readContract({ address: w.cfg.pool, abi: stashPoolAbi, functionName: "maxTotal" }),
    reader.readContract({ address: w.cfg.usdg, abi: usdgAbi, functionName: "balanceOf", args: [w.cfg.pool] }),
  ])) as bigint[];
  if (maxDeposit && d.amount > maxDeposit) throw new Error(`During launch, each deposit is limited to ${(Number(maxDeposit) / 1e6).toLocaleString("en-US")} USDG.`);
  if (maxTotal && held! + d.amount > maxTotal) throw new Error("Foil is at its launch-period limit. Try a smaller amount or come back later.");
  const send = async (address: Address, abi: unknown, functionName: string, args: unknown[]) => {
    const hash = (await client.writeContract({ account, address, abi, functionName, args, chain: null } as never)) as Hex;
    const r = await reader.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${functionName} failed`);
  };
  await send(w.cfg.usdg, usdgAbi, "approve", [w.cfg.pool, d.amount]);
  await send(w.cfg.pool, stashPoolAbi, "deposit", [d.amount, d.npk, d.ciphertext, d.epk]);
  setTimeout(() => void refresh(), 8_000);
}

export async function liveWithdraw(amountUsdg: number, recipient: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) throw new Error("Enter a valid destination address.");
  await need().withdraw(micros(amountUsdg), recipient as Address);
  await refresh();
}

export async function liveRequestTin(size: TinSize): Promise<TinRec> {
  const t = await need().requestTin(size);
  await refresh();
  return t;
}

export async function liveCancelTin(t: TinRec) {
  await need().cancelTin(t);
  await refresh();
}

/** Return everything a funded tin holds to the Stash (free up to its funded amount). */
export async function liveSendBack(t: TinRec, amountUsdg: number) {
  await need().sendBack(t, micros(amountUsdg));
  await refresh();
}

export const liveTinKey = (t: TinRec) => need().exportTinKey(t);

/** Rip Rooms (Build §7): opt-in post of one hit under this season's handle. */
export async function livePostHit(t: TinRec, tokenId: bigint) {
  const post = await need().postHit(t, tokenId);
  emit({});
  return post;
}

// ---------------------------------------------------------------- gifts (Build §6)

/** Fund a fresh tin as a gift. The link is available once its round executes. */
export async function liveCreateGift(size: TinSize, note: string): Promise<TinRec> {
  const w = need();
  const t = await w.requestTin(size);
  w.markGift(t.index, note.slice(0, 140));
  await refresh();
  return t;
}

/** The bearer link: the gift tin's key lives only in the fragment. */
export const liveGiftLink = (t: TinRec) => encodeGiftLink(location.origin, need().keys.tin(t.index).privateKey, t.gift?.note ?? "");

/** Take an unclaimed gift back into the giver's own Stash. */
export async function liveTakeBackGift(t: TinRec) {
  const w = need();
  await w.sendBack(t, BigInt(t.usdg ?? t.size));
  w.markGiftTakenBack(t.index);
  await refresh();
}

/** Look up a gift tin in the public snapshot (no per-address query). Works while locked. */
export async function lookupGiftTin(address: string): Promise<{ usdg: bigint; funded: bigint } | null> {
  const api = state.wallet?.api ?? createApi({ relayUrl: relayUrl!, keyConfig: keyConfig! });
  const snap = lastSnapshot ?? ((await api.snapshot.query()) as TinSetSnapshot | null);
  const t = snap?.tins.find((x) => x.tin.toLowerCase() === address.toLowerCase());
  return t ? { usdg: BigInt(t.usdg), funded: BigInt(t.funded) } : null;
}

export async function liveClaimGift(key: Hex, amount: bigint) {
  await need().claimGift(key, amount);
  await refresh();
}
export const findTin = (id: string) => state.wallet?.state.tins.find((t) => `tin-live-${t.index}` === id);
