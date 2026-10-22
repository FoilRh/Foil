/**
 * One-shot health check of a deployment. Exits 1 if anything needs attention, so it can run
 * on a schedule. Never prints secrets.
 *   bun scripts/testnet-status.ts                 (NETWORK=mainnet for mainnet)
 * Checks: service wallet ETH (operator: enough for 10 more tins), each service's /health,
 * the operator's and indexer's last heartbeat, pg_cron call results, indexer lag.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { createPublicClient, formatEther, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { stashPoolAbi } from "@foil/protocol";

const root = join(import.meta.dir, "..");
const NETWORK = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet";
const env = Object.fromEntries(readFileSync(join(root, "deploy", `${NETWORK}.env`), "utf8").split(/\r?\n/).flatMap((l) => {
  const m = /^([A-Z0-9_]+)=(.+)$/.exec(l.trim());
  return m ? [[m[1]!, m[2]!]] : [];
})) as Record<string, string>;
const urls = JSON.parse(readFileSync(join(root, "deploy", `${NETWORK}-urls.json`), "utf8")) as Record<string, string>;
const dep = JSON.parse(readFileSync(join(root, "contracts", "deployments", NETWORK === "mainnet" ? "4663.json" : "46630.json"), "utf8"));
const chain = createPublicClient({ transport: http(env.RPC_URL) });

const problems: string[] = [];
const line = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};

// Wallets
const ethPerTin = (await chain.readContract({ address: dep.pool, abi: stashPoolAbi, functionName: "ethPerTin" })) as bigint;
const wallets: [string, string, bigint][] = [
  ["deployer", "DEPLOYER", 50_000_000_000_000n],
  ["operator", "OPERATOR", ethPerTin * 10n],
  ["relayer", "RELAYER", 100_000_000_000_000n],
  ["ppoi-1", "PPOI1", 50_000_000_000_000n],
  ["ppoi-2", "PPOI2", 50_000_000_000_000n],
];
for (const [name, key, min] of wallets) {
  const a = privateKeyToAccount(env[`${key}_PRIVATE_KEY`] as `0x${string}`).address as Address;
  const bal = await chain.getBalance({ address: a });
  line(bal >= min, `${name.padEnd(9)} ${formatEther(bal)} ETH (min ${formatEther(min)}) ${a}`);
}

// Services
for (const name of ["relayer", "operator", "ppoi-1", "ppoi-2"]) {
  const r = await fetch(`${urls[name]}/health`, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
  line(!!r?.ok, `${name.padEnd(9)} /health ${r?.status ?? "unreachable"}`);
}
const keys = await fetch(`${urls.api}/ohttp-keys`, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
line(!!keys?.ok, `api       /ohttp-keys ${keys?.status ?? "unreachable"}`);
const web = await fetch(urls.web!, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
line(!!web?.ok, `web       ${web?.status ?? "unreachable"}`);

// Database: heartbeats, cron calls, indexer lag
const sql = postgres(env.DATABASE_URL!, { prepare: false, max: 1 });
{
  // The monitor runs every 10 minutes; a run with alerts is reported, not failed here (the
  // wallet and event checks above already show the same problems).
  const [m] = await sql`select ok, detail, extract(epoch from now() - ts)::int as age from status where component = 'monitor' order by ts desc limit 1`;
  line(!!m && m.age < 1500, `monitor        last run ${m ? `${m.age}s ago, ${m.ok ? "no alerts" : String(m.detail).slice(0, 160)}` : "never"}`);
}
for (const component of ["round-operator", "indexer"]) {
  const [s] = await sql`select ok, detail, extract(epoch from now() - ts)::int as age from status where component = ${component} order by ts desc limit 1`;
  line(!!s && s.ok && s.age < 300, `${component.padEnd(14)} last heartbeat ${s ? `${s.age}s ago, ${s.ok ? "ok" : `failed: ${s.detail}`}` : "never"}`);
}
const calls = await sql`select coalesce(status_code::text, 'error') as r, count(*)::int as n from net._http_response where created > now() - interval '1 hour' group by 1`;
const bad = calls.filter((c) => c.r !== "200");
line(calls.length > 0 && bad.length === 0, `cron ticks (1h): ${calls.map((c) => `${c.r}×${c.n}`).join(", ") || "none"}`);
const [snap] = await sql`select block::text as block, extract(epoch from now() - created_at)::int as age from snapshots order by block desc limit 1`;
line(!!snap && snap.age < 900, `indexer snapshot ${snap ? `block ${snap.block}, ${snap.age}s old` : "none"}`);
await sql.end();

if (problems.length) {
  console.log(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log("\nall good");
