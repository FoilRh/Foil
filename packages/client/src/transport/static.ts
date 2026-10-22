/**
 * Same-origin static assets that are identical for every user (circuit wasm and
 * proving keys). Fetching them reveals only that someone uses Foil, so they skip OHTTP.
 * Cached in Cache Storage so the ~15 MB per circuit downloads once.
 */
const CACHE = "foil-circuits-v1";

/** Fetches a same-origin path via Cache Storage, evicting older content-addressed versions of it. */
export async function fetchStatic(path: string): Promise<Uint8Array> {
  if (!path.startsWith("/")) throw new Error("same-origin paths only");
  const cache = typeof caches !== "undefined" ? await caches.open(CACHE) : undefined;
  let res = await cache?.match(path);
  if (!res) {
    res = await fetch(path, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) throw new Error(`could not load ${path}`);
    await cache?.put(path, res.clone());
    // Drop older versions of this file (<name>.<hash>.<ext>, same name and ext): files are
    // content-addressed, so anything else cached under that name is stale.
    const [stem, ext] = versionOf(path);
    for (const req of (await cache?.keys()) ?? []) {
      const p = new URL(req.url).pathname;
      const [s, e] = versionOf(p);
      if (p !== path && s === stem && e === ext) await cache?.delete(req);
    }
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** "/circuits/tin_request.ab12.zkey" → ["/circuits/tin_request", "zkey"]. */
function versionOf(path: string): [string, string] {
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  const parts = path.slice(dir.length).split(".");
  return [dir + parts[0], parts[parts.length - 1]!];
}

/**
 * A circuit's wasm and proving key. /circuits/circuits.json (written at build time, never
 * cached) names the current content-addressed files, so new keys are picked up at once.
 */
export async function loadCircuit(name: "joinsplit" | "tin_request"): Promise<{ wasm: Uint8Array; zkey: Uint8Array }> {
  const res = await fetch("/circuits/circuits.json", { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error("could not load the circuit list");
  const files = (await res.json()) as Record<string, string>;
  const [wasm, zkey] = await Promise.all([fetchStatic(`/circuits/${files[`${name}.wasm`]}`), fetchStatic(`/circuits/${files[`${name}.zkey`]}`)]);
  return { wasm, zkey };
}
