/**
 * Public surface: two routes.
 *   GET  /ohttp-keys  application/ohttp-keys (RFC 9458 §3.2)
 *   POST /gateway     message/ohttp-req → inner tRPC app → message/ohttp-res
 * The tRPC router is never mounted publicly; only decapsulated requests reach it.
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import {
  concat, decapsulateRequest, decodeRequest, encodeKeyConfig, encodeResponse, type GatewayKey,
} from "@foil/ohttp";
import { appRouter, type Ctx } from "./router";

// Our byte arrays are always ArrayBuffer-backed; TS 5.9's BodyInit wants that spelled out.
const bytes = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

/** Largest sealed request (a 128 KiB backup plus framing fits) and largest tRPC batch. */
export const MAX_REQUEST_BYTES = 256 * 1024;
export const MAX_BATCH = 10;

// No per-procedure rate limit here: behind OHTTP every caller looks the same, so any cap
// would be one budget that a spammer could exhaust for everyone (and lock users out of
// exits). Per-client limits live in the OHTTP relay, which sees client IPs
// (services/ohttp-relay); this gateway caps body and batch size only.

/** tRPC-shaped error, so the client surfaces the message. */
const fail = (httpStatus: number, code: string, message: string) =>
  Response.json({ error: { message, code: -32600, data: { code, httpStatus } } }, { status: httpStatus });

/** The public Hono app: serves the key config and decapsulates /gateway requests into the private tRPC router. */
export function createApp(key: GatewayKey, ctx: Ctx) {
  const inner = (req: Request) => fetchRequestHandler({ endpoint: "/trpc", req, router: appRouter, createContext: () => ctx });

  const app = new Hono();
  app.get("/ohttp-keys", () => {
    const cfg = encodeKeyConfig(key);
    const body = concat(Uint8Array.of(cfg.length >> 8, cfg.length & 0xff), cfg);
    return new Response(bytes(body), { headers: { "content-type": "application/ohttp-keys", "cache-control": "public, max-age=3600" } });
  });

  app.post("/gateway", bodyLimit({ maxSize: MAX_REQUEST_BYTES, onError: (c) => c.text("payload too large", 413) }), async (c) => {
    if (c.req.header("content-type") !== "message/ohttp-req") return c.text("unsupported media type", 415);
    let gw;
    try {
      gw = await decapsulateRequest(key, new Uint8Array(await c.req.arrayBuffer()));
    } catch {
      return c.text("bad request", 400);
    }
    const r = decodeRequest(gw.request);
    const url = new URL(`https://foil.internal${r.path}`);
    const procs = decodeURIComponent(url.pathname.replace(/^\/trpc\//, "")).split(",");
    const res = procs.length > MAX_BATCH ? fail(400, "BAD_REQUEST", "batch too large")
      : await inner(
        new Request(url, {
          method: r.method,
          headers: r.headers,
          body: r.method === "GET" || r.method === "HEAD" ? undefined : bytes(r.body),
        }),
      );
    const sealed = await gw.sealResponse(
      encodeResponse({
        status: res.status,
        headers: [["content-type", res.headers.get("content-type") ?? "application/json"]],
        body: new Uint8Array(await res.arrayBuffer()),
      }),
    );
    return new Response(bytes(sealed), { headers: { "content-type": "message/ohttp-res", "cache-control": "no-store" } });
  });

  return app;
}
