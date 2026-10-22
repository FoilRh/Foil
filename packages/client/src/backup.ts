/**
 * Encrypted backup (Build §9): spend limits, cool-off and tin records survive a seed
 * restore on a new device. AES-256-GCM under a seed-derived key, stored at a
 * seed-derived locator, fetched and written through OHTTP. Foil cannot read it.
 */
import { gcm } from "@noble/ciphers/aes.js";
import type { Keys } from "./keys";
import type { Api } from "./transport/api";
import type { TinRec } from "./wallet";

export interface BackupData {
  v: 1;
  updatedAt: string;
  limits: { dailyLimit: number; weeklyLimit: number; pendingLimits: { daily: number; weekly: number; at: string } | null; coolOffUntil: string | null };
  region: string | null;
  /** Confirmed pack spends (for rolling caps across devices). */
  spends: { at: string; amount: number }[];
  tins: TinRec[];
  nextTin: number;
}

const te = new TextEncoder();
const td = new TextDecoder();
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** AES-256-GCM-encrypts the backup; returns base64(nonce(12) ‖ ciphertext). */
export function sealBackup(key: Uint8Array, data: BackupData): string {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = gcm(key, nonce).encrypt(te.encode(JSON.stringify(data)));
  const out = new Uint8Array(12 + ct.length);
  out.set(nonce, 0);
  out.set(ct, 12);
  return b64(out);
}

/** Inverse of sealBackup; throws if the key is wrong or the blob was tampered with. */
export function openBackup(key: Uint8Array, blob: string): BackupData {
  const b = unb64(blob);
  return JSON.parse(td.decode(gcm(key, b.slice(0, 12)).decrypt(b.slice(12)))) as BackupData;
}

/** Seals and uploads the backup at the seed-derived locator. */
export async function saveBackup(api: Api, keys: Keys, data: BackupData) {
  await api.backup.put.mutate({ locator: keys.backupLocator, blob: sealBackup(keys.backupKey, data) });
}

/** Fetches and opens the backup; null if none was ever saved. */
export async function loadBackup(api: Api, keys: Keys): Promise<BackupData | null> {
  const blob = await api.backup.get.mutate({ locator: keys.backupLocator });
  return blob ? openBackup(keys.backupKey, blob) : null;
}

/**
 * Merge rule: the stricter limits win, so restoring an old backup can never loosen a
 * cap or end a cool-off early (Build §9: raises wait 24h, cool-off can't be undone).
 */
export function mergeLimits(a: BackupData["limits"], b: BackupData["limits"]): BackupData["limits"] {
  const later = (x: string | null, y: string | null) => (!x ? y : !y ? x : x > y ? x : y);
  return {
    dailyLimit: Math.min(a.dailyLimit, b.dailyLimit),
    weeklyLimit: Math.min(a.weeklyLimit, b.weeklyLimit),
    pendingLimits: a.pendingLimits && b.pendingLimits ? (a.pendingLimits.at > b.pendingLimits.at ? a.pendingLimits : b.pendingLimits) : a.pendingLimits ?? b.pendingLimits,
    coolOffUntil: later(a.coolOffUntil, b.coolOffUntil),
  };
}
