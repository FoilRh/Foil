/**
 * OHTTP relay (RFC 9458 §6.2). It sees the client's IP but only ciphertext; the
 * gateway sees plaintext but only this relay's IP. It forwards no client headers,
 * keeps no logs and no state. Build §1 requires ≥ 2 independent operators: run this
 * one and contract a second (another company) before launch.
 */
export interface RelayOptions {
  gatewayUrl: string; // https://api…/gateway
  allowedOrigins: string[];
  maxBody?: number;
  /** Sealed requests per client IP per minute (default 300). The relay is the only hop that
   * sees the caller, so per-client limits belong here, not at the gateway. */
  perIpPerMinute?: number;
  /** The client IP; default: the platform header (Fly-Client-IP, X-Real-IP, X-Forwarded-For). */
  ipOf?: (req: Request) => string;
  upstream?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/**
 * Builds the relay's fetch handler: `/health`, and `POST /gateway`, which forwards only the
 * `message/ohttp-req` body to the gateway (per-IP rate limit, size cap, CORS allowlist).
 */
export function createRelay(o: RelayOptions) {
  const up = o.upstream ?? fetch;
  const max = o.maxBody ?? 256 * 1024;
  const cap = o.perIpPerMinute ?? 300;
  const ipOf = o.ipOf ?? ((r: Request) =>
    r.headers.get("fly-client-ip") ?? r.headers.get("x-real-ip") ?? r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown");
  // ponytail: in-memory fixed window per instance, cleared each minute (IPs are never kept
  // longer or logged). Move to a shared store if the relay scales out.
  let windowStart = 0;
  const hits = new Map<string, number>();
  const allow = (ip: string) => {
    const now = Date.now();
    if (now - windowStart >= 60_000) { windowStart = now; hits.clear(); }
    const n = (hits.get(ip) ?? 0) + 1;
    hits.set(ip, n);
    return n <= cap;
  };

  const cors = (origin: string | null): Record<string, string> =>
    origin && o.allowedOrigins.includes(origin)
      ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type", vary: "origin" }
      : {};

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const h = cors(req.headers.get("origin"));
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (req.method === "GET" && url.pathname === "/health") return Response.json({ ok: true });

    // No /keys route: clients pin the gateway key config at build time, so a relay can
    // never substitute its own key.

    if (req.method === "POST" && url.pathname === "/gateway") {
      if (req.headers.get("content-type") !== "message/ohttp-req") return new Response("unsupported media type", { status: 415, headers: h });
      if (!allow(ipOf(req))) return new Response("too many requests", { status: 429, headers: { ...h, "retry-after": "60" } });
      const body = new Uint8Array(await req.arrayBuffer());
      if (body.length > max) return new Response("too large", { status: 413, headers: h });
      // Only the ciphertext and its media type go upstream: no client headers, no IP.
      const r = await up(o.gatewayUrl, { method: "POST", headers: { "content-type": "message/ohttp-req" }, body });
      return new Response(r.body, { status: r.status, headers: { ...h, "content-type": "message/ohttp-res", "cache-control": "no-store" } });
    }

    return new Response("not found", { status: 404, headers: h });
  };
}
