/**
 * Oblivious HTTP (RFC 9458) with DHKEM(X25519, HKDF-SHA256) / HKDF-SHA256 / AES-128-GCM.
 * The client encapsulates requests to the gateway's key; the relay forwards bytes it
 * cannot read; the gateway (apps/api) learns the request, never the client's IP.
 */
import { Aes128Gcm, CipherSuite, HkdfSha256, type SenderContext } from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";
import { gcm } from "@noble/ciphers/aes.js";
import { expand, extract } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concat } from "./bhttp";

export const KEM_ID = 0x0020;
export const KDF_ID = 0x0001;
export const AEAD_ID = 0x0001;
const NK = 16; // AES-128-GCM key length
const NN = 12; // nonce length
const RESPONSE_NONCE_LEN = Math.max(NK, NN);
const te = new TextEncoder();

const suite = () => new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() });
const u16 = (n: number) => Uint8Array.of(n >> 8, n & 0xff);
const buf = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;

export interface KeyConfig { keyId: number; publicKey: Uint8Array }

/** RFC 9458 §3: key_id | kem_id | public key | cipher-suite list. */
export function encodeKeyConfig(c: KeyConfig): Uint8Array {
  return concat(Uint8Array.of(c.keyId), u16(KEM_ID), c.publicKey, u16(4), u16(KDF_ID), u16(AEAD_ID));
}

/** Parses one key config; throws unless it is X25519 and lists HKDF-SHA256 / AES-128-GCM. */
export function decodeKeyConfig(b: Uint8Array): KeyConfig {
  const kem = (b[1]! << 8) | b[2]!;
  if (kem !== KEM_ID) throw new Error("unsupported KEM");
  const publicKey = b.slice(3, 35);
  const n = (b[35]! << 8) | b[36]!;
  let ok = false;
  for (let i = 37; i < 37 + n; i += 4) {
    if (((b[i]! << 8) | b[i + 1]!) === KDF_ID && ((b[i + 2]! << 8) | b[i + 3]!) === AEAD_ID) ok = true;
  }
  if (!ok) throw new Error("no supported cipher suite");
  return { keyId: b[0]!, publicKey };
}

const header = (keyId: number) => concat(Uint8Array.of(keyId), u16(KEM_ID), u16(KDF_ID), u16(AEAD_ID));
const requestInfo = (hdr: Uint8Array) => concat(te.encode("message/bhttp request"), Uint8Array.of(0), hdr);

function responseKeys(secret: Uint8Array, enc: Uint8Array, nonce: Uint8Array) {
  const prk = extract(sha256, secret, concat(enc, nonce));
  return { key: expand(sha256, prk, te.encode("key"), NK), iv: expand(sha256, prk, te.encode("nonce"), NN) };
}

export interface ClientContext {
  /** The encapsulated request to POST as message/ohttp-req. */
  request: Uint8Array;
  /** Decrypts the gateway's message/ohttp-res body. */
  openResponse(res: Uint8Array): Promise<Uint8Array>;
}

/** Client side. `testEphemeral` is only for the RFC test vector. */
export async function encapsulateRequest(cfg: KeyConfig, bhttpRequest: Uint8Array, testEphemeral?: CryptoKeyPair): Promise<ClientContext> {
  const s = suite();
  const hdr = header(cfg.keyId);
  const recipientPublicKey = await s.kem.importKey("raw", buf(cfg.publicKey), true);
  const ctx: SenderContext = await s.createSenderContext({ recipientPublicKey, info: buf(requestInfo(hdr)), ...(testEphemeral ? { ekm: testEphemeral } : {}) });
  const enc = new Uint8Array(ctx.enc);
  const ct = new Uint8Array(await ctx.seal(buf(bhttpRequest)));
  return {
    request: concat(hdr, enc, ct),
    async openResponse(res) {
      const secret = new Uint8Array(await ctx.export(buf(te.encode("message/bhttp response")), RESPONSE_NONCE_LEN));
      const nonce = res.slice(0, RESPONSE_NONCE_LEN);
      const { key, iv } = responseKeys(secret, enc, nonce);
      return gcm(key, iv).decrypt(res.slice(RESPONSE_NONCE_LEN));
    },
  };
}

export interface GatewayKey { keyId: number; privateKey: Uint8Array; publicKey: Uint8Array }

/** Fresh X25519 gateway key pair (raw bytes) for the given key id. */
export async function generateGatewayKey(keyId = 1): Promise<GatewayKey> {
  const s = suite();
  const kp = await s.kem.generateKeyPair();
  return {
    keyId,
    privateKey: new Uint8Array(await s.kem.serializePrivateKey(kp.privateKey)),
    publicKey: new Uint8Array(await s.kem.serializePublicKey(kp.publicKey)),
  };
}

export interface GatewayRequest {
  /** Decrypted Binary HTTP request. */
  request: Uint8Array;
  /** Encrypts the Binary HTTP response for this request's client. */
  sealResponse(bhttpResponse: Uint8Array, testNonce?: Uint8Array): Promise<Uint8Array>;
}

/** Gateway side (apps/api). */
export async function decapsulateRequest(key: GatewayKey, msg: Uint8Array): Promise<GatewayRequest> {
  const hdr = msg.slice(0, 7);
  if (hdr[0] !== key.keyId) throw new Error("unknown key id");
  if (((hdr[1]! << 8) | hdr[2]!) !== KEM_ID || ((hdr[3]! << 8) | hdr[4]!) !== KDF_ID || ((hdr[5]! << 8) | hdr[6]!) !== AEAD_ID) {
    throw new Error("unsupported suite");
  }
  const enc = msg.slice(7, 39);
  const s = suite();
  const recipientKey = {
    privateKey: await s.kem.importKey("raw", buf(key.privateKey), false),
    publicKey: await s.kem.importKey("raw", buf(key.publicKey), true),
  };
  const ctx = await s.createRecipientContext({ recipientKey, enc: buf(enc), info: buf(requestInfo(hdr)) });
  const request = new Uint8Array(await ctx.open(buf(msg.slice(39))));
  return {
    request,
    async sealResponse(bhttpResponse, testNonce) {
      const secret = new Uint8Array(await ctx.export(buf(te.encode("message/bhttp response")), RESPONSE_NONCE_LEN));
      const nonce = testNonce ?? crypto.getRandomValues(new Uint8Array(RESPONSE_NONCE_LEN));
      const { key: k, iv } = responseKeys(secret, enc, nonce);
      return concat(nonce, gcm(k, iv).encrypt(bhttpResponse));
    },
  };
}

/** Bytes → lowercase hex, no 0x prefix. */
export const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
/** Hex (optional 0x prefix) → bytes. */
export const unhex = (h: string) => Uint8Array.from(h.replace(/^0x/, "").match(/../g) ?? [], (x) => parseInt(x, 16));
