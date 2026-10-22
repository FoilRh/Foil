/**
 * Binary HTTP (RFC 9292), known-length form only. Decoding accepts truncated
 * trailing sections (RFC 9292 §3.8), as in the RFC 9458 test vector.
 */
export interface BRequest { method: string; scheme: string; authority: string; path: string; headers: [string, string][]; body: Uint8Array }
export interface BResponse { status: number; headers: [string, string][]; body: Uint8Array }

const enc = new TextEncoder();
const dec = new TextDecoder();

/** QUIC variable-length integer (RFC 9000 §16), 1/2/4-byte forms; throws at ≥ 2^30. */
export function varint(n: number): Uint8Array {
  if (n < 0x40) return Uint8Array.of(n);
  if (n < 0x4000) return Uint8Array.of(0x40 | (n >> 8), n & 0xff);
  if (n < 0x40000000) return Uint8Array.of(0x80 | (n >>> 24), (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  throw new Error("varint too large");
}

/** Concatenates byte arrays into a new one. */
export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const lenPrefixed = (b: Uint8Array) => concat(varint(b.length), b);
const str = (s: string) => lenPrefixed(enc.encode(s));
const fields = (h: [string, string][]) => lenPrefixed(concat(...h.flatMap(([k, v]) => [str(k.toLowerCase()), str(v)])));

/** Known-length BHTTP request; header names are lowercased, no trailers. */
export function encodeRequest(r: BRequest): Uint8Array {
  return concat(varint(0), str(r.method), str(r.scheme), str(r.authority), str(r.path), fields(r.headers), lenPrefixed(r.body), varint(0));
}

/** Known-length BHTTP response; header names are lowercased, no trailers. */
export function encodeResponse(r: BResponse): Uint8Array {
  return concat(varint(1), varint(r.status), fields(r.headers), lenPrefixed(r.body), varint(0));
}

class Reader {
  o = 0;
  constructor(private b: Uint8Array) {}
  get done() {
    return this.o >= this.b.length;
  }
  varint(): number {
    const first = this.b[this.o];
    if (first === undefined) throw new Error("truncated varint");
    const len = 1 << (first >> 6);
    let v = first & 0x3f;
    for (let i = 1; i < len; i++) v = v * 256 + this.b[this.o + i]!;
    this.o += len;
    return v;
  }
  bytes(): Uint8Array {
    const n = this.varint();
    if (this.o + n > this.b.length) throw new Error("truncated field");
    const out = this.b.slice(this.o, this.o + n);
    this.o += n;
    return out;
  }
  str() {
    return dec.decode(this.bytes());
  }
  fields(): [string, string][] {
    if (this.done) return [];
    const section = new Reader(this.bytes());
    const out: [string, string][] = [];
    while (!section.done) out.push([section.str(), section.str()]);
    return out;
  }
  body() {
    return this.done ? new Uint8Array() : this.bytes();
  }
}

/** Parses a known-length BHTTP request; throws on any other framing. */
export function decodeRequest(b: Uint8Array): BRequest {
  const r = new Reader(b);
  if (r.varint() !== 0) throw new Error("not a known-length request");
  return { method: r.str(), scheme: r.str(), authority: r.str(), path: r.str(), headers: r.fields(), body: r.body() };
}

/** Parses a known-length BHTTP response, skipping 1xx informational responses. */
export function decodeResponse(b: Uint8Array): BResponse {
  const r = new Reader(b);
  if (r.varint() !== 1) throw new Error("not a known-length response");
  let status = r.varint();
  // Skip informational (1xx) responses.
  while (status >= 100 && status < 200) {
    r.fields();
    status = r.varint();
  }
  return { status, headers: r.fields(), body: r.body() };
}
