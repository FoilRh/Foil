/**
 * Collector Crypt cards on Solana, for Rip Rooms. A tin funds a Collector Crypt account through
 * Relay (public: Relay's requests list the tin and its Solana recipient). Collector Crypt delivers
 * each pulled card to that account as a Metaplex Core asset in its collection. A pull is a Core
 * transfer of a Collector Crypt asset to an account the tin funded; it stays a pull after a
 * buyback, so a hit can still be posted.
 *
 * A Relay deposit names any recipient, so funding alone proves nothing: anyone could bridge cents
 * to someone else's account and claim its pulls. An account counts for a tin only if that tin's
 * Relay delivery is the account's FIRST transaction (each tin signs in to a fresh account, which
 * its own bridge opens). Its keys sit with Collector Crypt's login provider, so it cannot sign.
 */
import type { CardMeta } from "./stores";

export const CORE_PROGRAM = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
/** Collector Crypt's card collection (read from a live pack delivery, 2026-11-05). */
export const CC_COLLECTION = "CCryptUfeFSZ3Fgc9FLeKrhLVAP67FSqi1GuVoj9CRac";
const SOLANA_CHAIN = 792703809;
/** Core TransferV1 accounts: asset, collection, payer, authority, new owner, ... */
const NEW_OWNER = 4;

export interface SolanaPull { id: string; held: boolean; meta: CardMeta }
export interface SolanaCards { pulls(tin: string): Promise<SolanaPull[]> }

type Rpc = (method: string, params: unknown[]) => Promise<any>;
type Relay = (path: string) => Promise<unknown>;
type FetchJson = (url: string) => Promise<any>;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b) break; s = "1" + s; }
  return s;
}

/** Metaplex Core AssetV1: key(1), owner(32), update authority (1 + 32 unless None), name, uri. */
export function parseCoreAsset(data: Uint8Array): { owner: string; name: string; uri: string } {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 1;
  const owner = base58(data.subarray(o, o + 32)); o += 32;
  o += data[o] === 0 ? 1 : 33;
  const nl = v.getUint32(o, true); o += 4;
  const name = new TextDecoder().decode(data.subarray(o, o + nl)); o += nl;
  const ul = v.getUint32(o, true); o += 4;
  const uri = new TextDecoder().decode(data.subarray(o, o + ul));
  return { owner, name, uri };
}

/** Card metadata from the asset's JSON (Collector Crypt's attributes); insured value in USDG base units. */
export function cardMetaFrom(name: string, json: any): CardMeta {
  const attr = (k: string) => (json?.attributes ?? []).find((a: { trait_type?: string }) => a.trait_type === k)?.value;
  const insured = Number(attr("Insured Value"));
  return {
    name: String(json?.name ?? name).slice(0, 120) || null,
    grade: attr("The Grade") ? String(attr("The Grade")).slice(0, 40) : null,
    image: typeof json?.image === "string" && json.image.startsWith("https://") ? json.image : null,
    insuredValue: Number.isFinite(insured) && insured > 0 ? String(Math.round(insured * 1e6)) : null,
  };
}

export function solanaCards(deps: { rpc: Rpc; relay: Relay; fetchJson: FetchJson }): SolanaCards {
  const { rpc, relay, fetchJson } = deps;

  /** Solana accounts this tin funded through Relay (completed requests), with the delivering tx hashes. */
  async function fundedAccounts(tin: string): Promise<Map<string, Set<string>>> {
    const r = (await relay(`/requests/v2?user=${tin}&limit=50`)) as { requests?: any[] };
    const out = new Map<string, Set<string>>();
    for (const q of r.requests ?? []) {
      if (q.status !== "success" || typeof q.recipient !== "string") continue;
      for (const t of (q.data?.outTxs ?? []) as { chainId?: number; hash?: string }[]) {
        if (t.chainId !== SOLANA_CHAIN || typeof t.hash !== "string") continue;
        if (!out.has(q.recipient)) out.set(q.recipient, new Set());
        out.get(q.recipient)!.add(t.hash);
      }
    }
    return out;
  }

  /** The account's whole history, newest first (capped: these accounts are single-use). */
  async function history(account: string): Promise<{ signature: string; err: unknown }[]> {
    const all: { signature: string; err: unknown }[] = [];
    for (let page = 0; page < 10; page++) {
      const before = all.at(-1)?.signature;
      const sigs: { signature: string; err: unknown }[] = await rpc("getSignaturesForAddress", [account, { limit: 1000, ...(before ? { before } : {}) }]);
      all.push(...sigs);
      if (sigs.length < 1000) return all;
    }
    return []; // too long a history for a fresh per-tin account: not counted
  }

  /** Collector Crypt assets delivered to `account` in `sigs`. */
  async function delivered(account: string, sigs: { signature: string; err: unknown }[]): Promise<string[]> {
    const assets = new Set<string>();
    for (const s of sigs) {
      if (s.err) continue;
      const tx = await rpc("getTransaction", [s.signature, { encoding: "json", maxSupportedTransactionVersion: 0 }]);
      if (!tx) continue;
      const keys: string[] = [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
      for (const ix of tx.transaction.message.instructions as { programIdIndex: number; accounts: number[] }[]) {
        if (keys[ix.programIdIndex] !== CORE_PROGRAM) continue;
        const a = ix.accounts.map((i) => keys[i]);
        if (a[1] === CC_COLLECTION && a[NEW_OWNER] === account && a[0]) assets.add(a[0]);
      }
    }
    return [...assets];
  }

  return {
    // ponytail: scans each account's history per call; an indexer cache replaces it at scale.
    async pulls(tin) {
      const out: SolanaPull[] = [];
      for (const [account, deliveries] of await fundedAccounts(tin)) {
        const sigs = await history(account);
        // Only an account this tin's bridge opened: its first transaction is one of the tin's deliveries.
        if (!sigs.length || !deliveries.has(sigs.at(-1)!.signature)) continue;
        for (const asset of await delivered(account, sigs)) {
          const info = await rpc("getAccountInfo", [asset, { encoding: "base64" }]);
          if (!info?.value || info.value.owner !== CORE_PROGRAM) continue;
          const a = parseCoreAsset(Uint8Array.from(atob(info.value.data[0]), (c) => c.charCodeAt(0)));
          const json = a.uri.startsWith("https://") ? await fetchJson(a.uri).catch(() => null) : null;
          out.push({ id: `sol:${asset}`, held: a.owner === account, meta: cardMetaFrom(a.name, json) });
        }
      }
      return out;
    },
  };
}

/** Plain Solana JSON-RPC, retried (the public endpoint rate-limits). */
export function solanaRpc(url: string): Rpc {
  return async (method, params) => {
    for (let i = 0; ; i++) {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = (await res.json().catch(() => null)) as { result?: unknown; error?: unknown } | null;
      if (j && !j.error && res.ok) return j.result;
      if (i >= 4) throw new Error(`solana ${method} failed`);
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  };
}
