/**
 * Prepares deploy/<network>.env (gitignored): `bun scripts/testnet-env.ts [testnet|mainnet]`.
 * Values already in the file are kept: put your own keys there first if you have them.
 * Anything missing is generated:
 *   DEPLOYER/OPERATOR/RELAYER/PPOI1/PPOI2_PRIVATE_KEY   fresh wallets
 *   CC_QUOTE_PRIVATE_KEY (testnet)                      signs sell-back quotes for the mock CC vault
 *   OHTTP_KEY_ID/OHTTP_PRIVATE_KEY/OHTTP_PUBLIC_KEY     the API gateway's OHTTP key
 *   RELAYER/OPERATOR/PPOI1/PPOI2_TOKEN                  one distinct secret per service
 *   TICK_TOKEN                                          lets the scheduler call /tick
 * DATABASE_URL must be added by hand (Supabase → Connect → Transaction pooler); on mainnet
 * also replace RPC_URL with a paid endpoint and add SHIPPING_PAYEES (Collector Crypt's).
 * Prints addresses to fund; never prints secrets.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bytesToHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeKeyConfig, generateGatewayKey, hex } from "@foil/ohttp";

const network = process.argv[2] ?? "testnet";
if (network !== "testnet" && network !== "mainnet") throw new Error("network must be testnet or mainnet");
const mainnet = network === "mainnet";
const dir = join(import.meta.dir, "..", "deploy");
const file = join(dir, `${network}.env`);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const env = new Map<string, string>();
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && m[2]) env.set(m[1]!, m[2]);
  }
}
const put = (k: string, v: () => string) => { if (!env.get(k)) env.set(k, v()); };

for (const k of ["DEPLOYER", "OPERATOR", "RELAYER", "PPOI1", "PPOI2", ...(mainnet ? [] : ["CC_QUOTE"])]) put(`${k}_PRIVATE_KEY`, () => generatePrivateKey());
if (!env.get("OHTTP_PRIVATE_KEY")) {
  const g = await generateGatewayKey(1);
  env.set("OHTTP_KEY_ID", "1");
  env.set("OHTTP_PRIVATE_KEY", hex(g.privateKey));
  env.set("OHTTP_PUBLIC_KEY", hex(g.publicKey));
  env.set("OHTTP_KEY_CONFIG", hex(encodeKeyConfig(g))); // public: the web build pins this
}
for (const k of ["RELAYER", "OPERATOR", "PPOI1", "PPOI2", "TICK"]) put(`${k}_TOKEN`, () => bytesToHex(crypto.getRandomValues(new Uint8Array(32))).slice(2));
put("RPC_URL", () => (mainnet ? "https://rpc.mainnet.chain.robinhood.com" : "https://rpc.testnet.chain.robinhood.com"));
put("CHAIN_ID", () => (mainnet ? "4663" : "46630"));
put("DATABASE_URL", () => "");

writeFileSync(file, `# Foil ${network} deployment. SECRET: never commit (deploy/*.env is gitignored).\n${[...env].map(([k, v]) => `${k}=${v}`).join("\n")}\n`, { mode: 0o600 });
chmodSync(file, 0o600); // owner-only, also when the file already existed
console.log(`wrote ${file}\nFund these with Robinhood Chain ${network} ETH:`);
for (const k of ["DEPLOYER", "OPERATOR", "RELAYER", "PPOI1", "PPOI2"]) {
  console.log(`  ${k.padEnd(9)} ${privateKeyToAccount(env.get(`${k}_PRIVATE_KEY`) as `0x${string}`).address}`);
}
if (!env.get("DATABASE_URL")) console.log("Still needed: DATABASE_URL (Supabase → Connect → Transaction pooler, port 6543).");
if (mainnet && env.get("RPC_URL")!.includes("rpc.mainnet.chain.robinhood.com")) console.log("Replace RPC_URL with a paid endpoint (the public one is rate-limited).");
if (mainnet && !env.get("SHIPPING_PAYEES")) console.log("Browser mode needs SHIPPING_PAYEES (Collector Crypt's shipping payee addresses, comma-separated).");
