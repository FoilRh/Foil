import { expect, test } from "bun:test";
import { appFromEnv } from "./index";

const t = (c: string) => c.repeat(32);
const base = {
  RPC_URL: "http://127.0.0.1:8545", CHAIN_ID: "46630",
  POOL_ADDRESS: "0x0000000000000000000000000000000000000001", USDG_ADDRESS: "0x0000000000000000000000000000000000000002",
  GATE_ADDRESS: "0x0000000000000000000000000000000000000003", OHTTP_KEY_ID: "1",
  OHTTP_PRIVATE_KEY: "11".repeat(32), OHTTP_PUBLIC_KEY: "22".repeat(32),
  RELAYER_URL: "http://relayer.internal", RELAYER_ADDRESS: "0x0000000000000000000000000000000000000004",
  OPERATOR_URL: "http://operator.internal", DATABASE_URL: "postgres://u:p@127.0.0.1:6543/db",
  RELAYER_TOKEN: t("r"), OPERATOR_TOKEN: t("o"),
  PPOI_URLS: "http://ppoi-1.internal,http://ppoi-2.internal", PPOI_TOKENS: `${t("a")},${t("b")}`,
};

test("each internal service has its own token", () => {
  expect(() => appFromEnv(base)).not.toThrow();
  // A ppoi-node (independent operator) must never hold the relayer's or operator's token.
  expect(() => appFromEnv({ ...base, PPOI_TOKENS: `${t("r")},${t("b")}` })).toThrow(/distinct token/);
  expect(() => appFromEnv({ ...base, OPERATOR_TOKEN: t("r") })).toThrow(/distinct token/);
  expect(() => appFromEnv({ ...base, PPOI_TOKENS: t("a") })).toThrow(/one token/);
});
