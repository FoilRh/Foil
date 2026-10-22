/**
 * Encrypted local store. The vault (recovery phrase + wallet records) is sealed with
 * AES-256-GCM under a key from PBKDF2-SHA256(passphrase, 600k). Only ciphertext is
 * persisted (IndexedDB in browsers). Never plain localStorage for keys (handoff rule).
 */
export interface KV {
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array): Promise<void>;
  del(key: string): Promise<void>;
}

const ITERATIONS = 600_000;
const te = new TextEncoder();
const td = new TextDecoder();
const b = (x: Uint8Array) => x as Uint8Array<ArrayBuffer>;

async function aesKey(passphrase: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", te.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: b(salt), iterations: ITERATIONS },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

/** Encrypts JSON `value`; returns salt(16) ‖ iv(12) ‖ ciphertext. */
export async function seal(passphrase: string, value: unknown): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(passphrase, salt), te.encode(JSON.stringify(value))));
  const out = new Uint8Array(28 + ct.length);
  out.set(salt, 0);
  out.set(iv, 16);
  out.set(ct, 28);
  return out;
}

/** Decrypts a sealed vault; throws "wrong passphrase or damaged vault" on any failure. */
export async function open<T>(passphrase: string, sealed: Uint8Array): Promise<T> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b(sealed.slice(16, 28)) }, await aesKey(passphrase, sealed.slice(0, 16)), b(sealed.slice(28)),
    );
    return JSON.parse(td.decode(pt)) as T;
  } catch {
    throw new Error("wrong passphrase or damaged vault");
  }
}

/** In-memory KV for tests and non-browser runs. */
export function memoryKV(): KV {
  const m = new Map<string, Uint8Array>();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), del: async (k) => void m.delete(k) };
}

/** Browser IndexedDB key-value store (one object store). */
export function indexedDbKV(dbName = "foil", store = "vault"): KV {
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest) =>
    db.then((d) => new Promise<T>((resolve, reject) => {
      const r = f(d.transaction(store, mode).objectStore(store));
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => reject(r.error);
    }));
  return {
    get: (k) => run<Uint8Array | undefined>("readonly", (s) => s.get(k)),
    set: (k, v) => run<void>("readwrite", (s) => s.put(v, k)),
    del: (k) => run<void>("readwrite", (s) => s.delete(k)),
  };
}
