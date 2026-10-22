// /reveal is bearer-protected: a missing or wrong token never reaches the operator.
import { expect, test } from "bun:test";

const TOKEN = "o".repeat(32);
Object.assign(process.env, {
  RPC_URL: "http://127.0.0.1:1", CHAIN_ID: "31337", POOL_ADDRESS: "0x0000000000000000000000000000000000000001",
  OPERATOR_PRIVATE_KEY: `0x${"22".repeat(32)}`, INTERNAL_TOKEN: TOKEN, VERCEL: "1",
});
const { app } = await import("./main");
const reveal = (auth?: string, body = "{}") =>
  app.fetch(new Request("http://op/reveal", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body }));

test("/reveal rejects a missing or wrong bearer token", async () => {
  expect((await reveal()).status).toBe(401);
  expect((await reveal(`Bearer ${"x".repeat(32)}`)).status).toBe(401);
  expect((await reveal(`Bearer ${TOKEN}`)).status).toBe(400); // past auth, body checked
});

test("/reveal hides RPC errors behind a fixed message", async () => {
  const body = JSON.stringify({ roundId: "1", tin: "0x0000000000000000000000000000000000000002", salt: `0x${"33".repeat(32)}` });
  const res = await reveal(`Bearer ${TOKEN}`, body);
  expect(res.status).toBe(500);
  const text = await res.text();
  expect(text).toContain("internal error");
  expect(text).not.toContain("127.0.0.1");
});
