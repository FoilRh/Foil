// /attest is bearer-protected: a missing or wrong token never reaches the node.
import { expect, test } from "bun:test";

const TOKEN = "p".repeat(32);
const list = Bun.serve({ port: 0, fetch: () => Response.json([]) });
Object.assign(process.env, {
  VERCEL: "1", // no heartbeat loop in tests
  RPC_URL: "http://127.0.0.1:1", POOL_ADDRESS: "0x0000000000000000000000000000000000000001",
  GATE_ADDRESS: "0x0000000000000000000000000000000000000002", USDG_ADDRESS: "0x0000000000000000000000000000000000000003",
  START_BLOCK: "0", PPOI_PRIVATE_KEY: `0x${"22".repeat(32)}`, BLOCKLIST_URL: `http://127.0.0.1:${list.port}/list.json`, INTERNAL_TOKEN: TOKEN,
});
const { app } = await import("./main");
list.stop(true);
const attest = (auth?: string) =>
  app.fetch(new Request("http://ppoi/attest", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: "{}" }));

test("/attest rejects a missing or wrong bearer token", async () => {
  expect((await attest()).status).toBe(401);
  expect((await attest(`Bearer ${"x".repeat(32)}`)).status).toBe(401);
  expect((await attest(`Bearer ${TOKEN}`)).status).toBe(400); // past auth, body checked
});
