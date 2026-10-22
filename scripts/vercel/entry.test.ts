// POST /tick is bearer-protected per project: a missing or wrong token never runs the tick.
import { expect, test } from "bun:test";

const TOKEN = "t".repeat(40);
Object.assign(process.env, {
  SERVICE: "round-operator", TICK_TOKEN: TOKEN, VERCEL: "1",
  RPC_URL: "http://127.0.0.1:1", CHAIN_ID: "31337", POOL_ADDRESS: "0x0000000000000000000000000000000000000001",
  OPERATOR_PRIVATE_KEY: `0x${"22".repeat(32)}`, INTERNAL_TOKEN: "o".repeat(32), // same as round-operator/src/main.test.ts (one module cache)
});
const { app } = await import("./entry");
const tick = (auth?: string) => app.fetch(new Request("https://op/tick", { method: "POST", headers: auth ? { authorization: auth } : {} }));

test("/tick rejects a missing or wrong bearer token", async () => {
  expect((await tick()).status).toBe(401);
  expect((await tick(`Bearer ${"x".repeat(40)}`)).status).toBe(401);
  expect((await tick(`Bearer ${TOKEN}`)).status).toBe(200); // the tick itself logs its RPC failure
});
