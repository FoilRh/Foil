/**
 * The client's only network path to Foil (Build §1, §11): a fetch() that encapsulates
 * every request with OHTTP and sends it to the relay. scripts/privacy-lint.ts fails CI
 * if client code calls fetch anywhere else.
 *
 * The gateway key config is PINNED in the client build. It is never taken from the
 * relay: a relay that could swap the key would act as the gateway itself, seeing both
 * the request and the client's IP, which is exactly what OHTTP exists to prevent.
 */
import { decodeKeyConfig, decodeResponse, encapsulateRequest, encodeRequest, unhex, type KeyConfig } from "@foil/ohttp";

export interface OhttpFetchOptions {
  /** e.g. https://relay.foil.example (serves /gateway). */
  relayUrl: string;
  /** Hex of the gateway's key config (apps/api GET /ohttp-keys without its 2-byte length prefix). */
  keyConfig: string;
  /** Injected for tests; defaults to the platform fetch. */
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export type OhttpFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * fetch() replacement: encodes the request as BHTTP (content-type is the only header kept),
 * seals it to the pinned key config and POSTs it to the relay. Throws on a non-2xx relay reply.
 */
export function createOhttpFetch(o: OhttpFetchOptions): OhttpFetch {
  const f = o.fetchImpl ?? fetch;
  const config: KeyConfig = decodeKeyConfig(unhex(o.keyConfig));

  return async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const headers: [string, string][] = [];
    const ct = req.headers.get("content-type");
    if (ct) headers.push(["content-type", ct]); // nothing else: no cookies, no user agent
    const body = req.method === "GET" || req.method === "HEAD" ? new Uint8Array() : new Uint8Array(await req.arrayBuffer());
    const ctx = await encapsulateRequest(config, encodeRequest({
      method: req.method, scheme: url.protocol.replace(":", ""), authority: url.host, path: url.pathname + url.search, headers, body,
    }));
    const res = await f(`${o.relayUrl}/gateway`, {
      method: "POST",
      headers: { "content-type": "message/ohttp-req" },
      body: ctx.request as Uint8Array<ArrayBuffer>,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) throw new Error(`relay error ${res.status}`);
    const inner = decodeResponse(await ctx.openResponse(new Uint8Array(await res.arrayBuffer())));
    return new Response(inner.body as Uint8Array<ArrayBuffer>, { status: inner.status, headers: inner.headers });
  };
}
