// /relay is bearer-protected: a missing or wrong token never reaches the relayer.
import { expect, test } from "bun:test";

const TOKEN = "r".repeat(32);
Object.assign(process.env, {
  RPC_URL: "http://127.0.0.1:1", POOL_ADDRESS: "0x0000000000000000000000000000000000000001",
  RELAYER_PRIVATE_KEY: `0x${"11".repeat(32)}`, INTERNAL_TOKEN: TOKEN,
});
const { app } = await import("./main");
const relay = (auth?: string) =>
  app.fetch(new Request("http://relayer/relay", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: "{}" }));

test("/relay rejects a missing or wrong bearer token", async () => {
  expect((await relay()).status).toBe(401);
  expect((await relay(`Bearer ${"x".repeat(32)}`)).status).toBe(401);
  expect((await relay(`Bearer ${TOKEN}`)).status).toBe(400); // past auth, body checked
});
