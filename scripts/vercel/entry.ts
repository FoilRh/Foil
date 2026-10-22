/**
 * One Vercel function for every Foil service; SERVICE picks which. Each service is its own
 * Vercel project, so each holds only its own key and token (as separate Fly apps would).
 * Long-lived loops become POST /tick (bearer TICK_TOKEN), called by Supabase pg_cron. Each project's
 * TICK_TOKEN is its own (deploy.ts derives one per project), so this accepts only its own scheduler.
 * Bundled by scripts/vercel/build.ts; deployed by scripts/vercel/deploy.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";

type Service = { fetch?: (req: Request) => Response | Promise<Response>; tick?: () => Promise<unknown> };
const services: Record<string, () => Promise<Service>> = {
  api: async () => ({ fetch: (await import("../../apps/api/src/index")).appFromEnv().fetch }),
  relayer: async () => ({ fetch: (await import("../../services/relayer/src/main")).app.fetch }),
  "round-operator": async () => {
    const m = await import("../../services/round-operator/src/main");
    return { fetch: m.app.fetch, tick: m.tick };
  },
  "ppoi-node": async () => {
    const m = await import("../../services/ppoi-node/src/main");
    return { fetch: m.app.fetch, tick: m.tick };
  },
  indexer: async () => ({ tick: (await import("../../services/indexer/src/main")).tick }),
  monitor: async () => ({ tick: (await import("../monitor")).tick }),
  "ohttp-relay": async () => ({ fetch: (await import("../../services/ohttp-relay/src/main")).handle }),
};

const svc = await services[process.env.SERVICE ?? ""]?.();
if (!svc) throw new Error(`SERVICE must be one of: ${Object.keys(services).join(", ")}`);

export const app = new Hono();
if (svc.tick) {
  const token = process.env.TICK_TOKEN ?? "";
  if (token.length < 32) throw new Error("TICK_TOKEN (>= 32 chars) is required");
  const tick = svc.tick;
  app.post("/tick", bearerAuth({ token }), async (c) => {
    await tick();
    return c.json({ data: { ok: true } });
  });
}
const fetch = svc.fetch;
if (fetch) app.all("*", (c) => fetch(c.req.raw));

/** Node (req, res) → web Request/Response. */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) for (const x of [v ?? []].flat()) headers.append(k, x);
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(await Array.fromAsync(req as AsyncIterable<Buffer>));
  const r = await app.fetch(new Request(`https://${req.headers.host}${req.url}`, { method: req.method, headers, body }));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}
