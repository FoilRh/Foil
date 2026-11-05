// Per-client rate limit at the relay: one IP over its cap gets 429, others are unaffected.
import { expect, test } from "bun:test";
import { createRelay, platformIp } from "./relay";

const relay = createRelay({
  gatewayUrl: "http://gateway/gateway", allowedOrigins: [], perIpPerMinute: 2,
  upstream: async () => new Response("ok"),
});
const send = (ip: string) =>
  relay(new Request("http://relay/gateway", { method: "POST", headers: { "content-type": "message/ohttp-req", "x-real-ip": ip }, body: "x" }));

test("an IP over its per-minute cap gets 429; another IP does not", async () => {
  expect((await send("1.1.1.1")).status).toBe(200);
  expect((await send("1.1.1.1")).status).toBe(200);
  expect((await send("1.1.1.1")).status).toBe(429);
  expect((await send("2.2.2.2")).status).toBe(200);
});

test("the relay sends the gateway token upstream", async () => {
  let seen = null as string | null;
  const r = createRelay({
    gatewayUrl: "http://gateway/gateway", allowedOrigins: [], gatewayToken: "t".repeat(40),
    upstream: async (_u, init) => { seen = new Headers(init?.headers).get("x-foil-relay"); return new Response("ok"); },
  });
  await r(new Request("http://relay/gateway", { method: "POST", headers: { "content-type": "message/ohttp-req", "x-real-ip": "3.3.3.3" }, body: "x" }));
  expect(seen).toBe("t".repeat(40));
});

test("the client IP comes only from the header the host sets: a spoofed Fly-Client-IP on Vercel is ignored", () => {
  const req = new Request("http://relay/gateway", { headers: { "x-real-ip": "4.4.4.4", "fly-client-ip": "9.9.9.9", "x-forwarded-for": "8.8.8.8" } });
  expect(platformIp({})(req)).toBe("4.4.4.4");
  expect(platformIp({ FLY_APP_NAME: "relay" })(req)).toBe("9.9.9.9");
});
