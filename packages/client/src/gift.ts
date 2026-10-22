/**
 * Gift links (Build §6): <origin>/gift/#v1.<base64url(tinKey ‖ note)>.
 * The tin's private key travels only in the URL fragment, which browsers never send to
 * any server (not in requests, not in Referer). Whoever holds the link can claim until
 * it is claimed: it is a bearer instrument, and the UI says so.
 */
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const MAX_NOTE_BYTES = 140;
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** Builds the gift link; the key and note (truncated to 140 bytes) go only in the fragment. */
export function encodeGiftLink(origin: string, tinKey: Hex, note = ""): string {
  const n = new TextEncoder().encode(note).slice(0, MAX_NOTE_BYTES);
  const k = hexToBytes(tinKey);
  if (k.length !== 32) throw new Error("bad tin key");
  const body = new Uint8Array(32 + n.length);
  body.set(k, 0);
  body.set(n, 32);
  return `${origin}/gift/#v1.${b64url(body)}`;
}

/** Parse location.hash ("#v1.…"). Returns null for anything else. */
export function decodeGiftFragment(hash: string): { key: Hex; address: Hex; note: string } | null {
  const m = /^#?v1\.([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  try {
    const b = unb64url(m[1]!);
    if (b.length < 32 || b.length > 32 + MAX_NOTE_BYTES) return null;
    const key = bytesToHex(b.slice(0, 32));
    return { key, address: privateKeyToAccount(key).address, note: new TextDecoder().decode(b.slice(32)) };
  } catch {
    return null;
  }
}
