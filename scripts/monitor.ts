/**
 * Read-only alert pass over a deployment (contracts/deployments/<chainId>.json). No keys needed.
 *   bun scripts/monitor.ts                       (NETWORK=mainnet for mainnet)
 * Also runs as the `monitor` Vercel service (scripts/vercel/entry.ts): pg_cron calls POST /tick
 * every 10 minutes; each run writes a `monitor` row to the status table (read by
 * scripts/testnet-status.ts) and posts alerts to ALERT_WEBHOOK_URL when set.
 * Alerts on, within the last LOOKBACK_MINUTES (default 60; the service uses 11):
 *   - admin/role events: ownership, operator, guardian, pause, fee router, caps, params, bonds,
 *     timelock schedules/executions/role changes and Safe owner/threshold changes and executions
 *     (StashPool); providers and clean-inbound (ScreeningGate); recipients (FeeRouter);
 *     attestors, treasury, slashes (Bonds); ownership and loss cover (FoilStaking)
 *   - pool withdrawals above WITHDRAW_ALERT_USDG (default 10000)
 * and on operator / relayer / ppoi wallets below their ETH floor (addresses from each
 * service's public /health).
 * Env: NETWORK, RPC_URL (default: public RHC endpoint), LOOKBACK_MINUTES, WITHDRAW_ALERT_USDG,
 * ALERT_WEBHOOK_URL, DATABASE_URL (status rows), DEPLOYMENT_JSON and SERVICE_URLS_JSON
 * (the manifest and service URLs as JSON; default: read from contracts/deployments and
 * deploy/<network>-urls.json).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, formatEther, formatUnits, http, parseAbi, parseUnits, type Address } from "viem";
import { stashPoolAbi, USDG } from "@foil/protocol";

// Bun-only import.meta.dir; on Vercel (Node) the manifest and URLs come from env instead.
const root = () => join(import.meta.dir ?? ".", "..");
const NETWORK = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet";
const CHAIN_ID = NETWORK === "mainnet" ? 4663 : 46630;
const RPC_URL = process.env.RPC_URL ?? `https://rpc.${NETWORK}.chain.robinhood.com`;
const WITHDRAW_ALERT = parseUnits(process.env.WITHDRAW_ALERT_USDG ?? "10000", USDG.decimals);

// Every one of these is an admin action or a slash: any occurrence is worth a look.
const events = parseAbi([
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "event OperatorSet(address operator, bool allowed)",
  "event GuardianSet(address guardian)",
  "event Paused(bool deposits, bool requests)",
  "event FeeRouterSet(address router)",
  "event CapsSet(uint256 maxDeposit, uint256 maxTotal)",
  "event ParamsSet(uint256 gasFeeUsdg, uint256 ethPerTin)",
  "event BondsSet(address bonds)",
  "event ProviderSet(address indexed provider, bool active)",
  "event CleanInbound(address indexed source, bool allowed)",
  "event RecipientsSet(address work, address treasury, address staking, address burnSink)",
  "event AttestorsSet(address[] attestors)",
  "event TreasurySet(address treasury)",
  "event SlashProposed(uint256 indexed id, address indexed who, uint8 role, uint8 cause, uint256 amount, bytes32 evidence)",
  "event Slashed(uint256 indexed id, address indexed who, uint256 amount)",
  "event LossCovered(address indexed to, uint256 foil, bytes32 reason)",
  "event Withdrawal(address indexed recipient, uint256 amount, uint256 protocolFee)",
  // TimelockController: anything scheduled gives 24h to react before it can execute.
  "event CallScheduled(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data, bytes32 predecessor, uint256 delay)",
  "event CallExecuted(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data)",
  "event Cancelled(bytes32 indexed id)",
  "event MinDelayChange(uint256 oldDuration, uint256 newDuration)",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
  // Safe (1.4.1): owner set, threshold, and every executed transaction.
  "event AddedOwner(address indexed owner)",
  "event RemovedOwner(address indexed owner)",
  "event ChangedThreshold(uint256 threshold)",
  "event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)",
  "event ExecutionFailure(bytes32 indexed txHash, uint256 payment)",
]);

function json(envVar: string, file: () => string): Record<string, string> {
  if (process.env[envVar]) return JSON.parse(process.env[envVar]!);
  return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {};
}

/** One read-only pass; returns the alerts (empty when all is well). */
export async function check(lookbackMinutes = Number(process.env.LOOKBACK_MINUTES ?? 60)): Promise<string[]> {
  const dep = json("DEPLOYMENT_JSON", () => join(root(), "contracts", "deployments", `${CHAIN_ID}.json`));
  const urls = json("SERVICE_URLS_JSON", () => join(root(), "deploy", `${NETWORK}-urls.json`));
  if (!dep.pool) throw new Error("no deployment manifest (DEPLOYMENT_JSON or contracts/deployments)");
  const chain = createPublicClient({ transport: http(RPC_URL) });
  const alerts: string[] = [];
  const alert = (what: string) => {
    console.log(`ALERT ${what}`);
    alerts.push(what);
  };

  const watched = ["pool", "gate", "feeRouter", "bonds", "staking", "timelock", "safe"].filter((k) => dep[k] && dep[k] !== dep.deployer);
  const nameOf = new Map(watched.map((k) => [dep[k]!.toLowerCase(), k]));
  // One call for the head: a load-balanced RPC can report a block number another node lacks.
  const b = await chain.getBlock({ blockTag: "latest" });
  const latest = b.number;
  const probe = latest > 10_000n ? 10_000n : latest;
  const a = await chain.getBlock({ blockNumber: latest - probe });
  const secPerBlock = probe > 0n ? Number(b.timestamp - a.timestamp) / Number(probe) : 1;
  const span = BigInt(Math.ceil((lookbackMinutes * 60) / Math.max(secPerBlock, 0.01)));
  const from = latest > span ? latest - span : 0n;
  console.log(`${NETWORK} ${CHAIN_ID}: blocks ${from}..${latest} (~${lookbackMinutes} min)`);

  const CHUNK = 50_000n;
  for (let lo = from; lo <= latest; lo += CHUNK) {
    const hi = lo + CHUNK - 1n < latest ? lo + CHUNK - 1n : latest;
    const logs = await chain.getLogs({ address: watched.map((k) => dep[k] as Address), events, fromBlock: lo, toBlock: hi });
    for (const l of logs) {
      const where = `${nameOf.get(l.address.toLowerCase())}.${l.eventName} block ${l.blockNumber} tx ${l.transactionHash}`;
      if (l.eventName === "Withdrawal") {
        const { amount, recipient } = l.args as { amount: bigint; recipient: Address };
        if (amount >= WITHDRAW_ALERT) alert(`large withdrawal ${formatUnits(amount, USDG.decimals)} USDG to ${recipient} (${where})`);
        continue;
      }
      const args = Object.entries(l.args ?? {}).map(([k, v]) => `${k}=${String(v)}`).join(" ");
      alert(`${where} ${args}`);
    }
  }

  // Wallets. Floors match scripts/testnet-status.ts.
  const ethPerTin = (await chain.readContract({ address: dep.pool as Address, abi: stashPoolAbi, functionName: "ethPerTin" })) as bigint;
  const wallets: [string, string, bigint][] = [
    ["operator", "operator", ethPerTin * 10n],
    ["relayer", "relayer", 100_000_000_000_000n],
    ["ppoi-1", "provider", 50_000_000_000_000n],
    ["ppoi-2", "provider", 50_000_000_000_000n],
  ];
  for (const [name, field, min] of wallets) {
    if (!urls[name]) {
      alert(`${name}: no service URL, wallet not checked`);
      continue;
    }
    const h = await fetch(`${urls[name]}/health`, { signal: AbortSignal.timeout(60_000) }).then((r) => r.json()).catch(() => null);
    const addr = h?.data?.[field] as Address | undefined;
    if (!addr) {
      alert(`${name}: /health unreachable, wallet not checked`);
      continue;
    }
    const bal = await chain.getBalance({ address: addr });
    if (bal < min) alert(`${name} ${addr} low: ${formatEther(bal)} ETH (min ${formatEther(min)})`);
    else console.log(`ok    ${name.padEnd(8)} ${formatEther(bal)} ETH ${addr}`);
  }
  return alerts;
}

/** Posts alerts to ALERT_WEBHOOK_URL (Slack/Discord-style `{ text, content }`); returns the HTTP status. */
export async function notify(alerts: string[]): Promise<number | null> {
  if (!alerts.length || !process.env.ALERT_WEBHOOK_URL) return null;
  const text = `Foil ${NETWORK} monitor: ${alerts.length} alert(s)\n${alerts.join("\n")}`;
  const r = await fetch(process.env.ALERT_WEBHOOK_URL, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text.slice(0, 2000) }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return r?.status ?? 0;
}

/** Scheduled run (POST /tick): check, notify, and record a `monitor` status row. Never throws. */
export async function tick() {
  let ok = false;
  let detail: string;
  try {
    const alerts = await check(Number(process.env.LOOKBACK_MINUTES ?? 11));
    const hook = await notify(alerts);
    ok = alerts.length === 0;
    detail = ok ? "no alerts" : `${alerts.length} alert(s)${hook === null ? "" : `, webhook ${hook}`}: ${alerts.join(" | ")}`;
  } catch (e) {
    detail = `monitor failed: ${(e as Error).message}`;
  }
  if (process.env.DATABASE_URL) {
    const { createDb, schema } = await import("@foil/db");
    const { db, sql } = createDb(process.env.DATABASE_URL);
    await db.insert(schema.status).values({ component: "monitor", ok, detail: detail.slice(0, 500) }).catch(() => {});
    await sql.end();
  }
  console.log(`[monitor] ${detail}`);
}

if (import.meta.main) {
  const alerts = await check();
  const hook = await notify(alerts);
  if (hook !== null) console.log(`webhook ${hook || "failed"}`);
  console.log(alerts.length ? `\n${alerts.length} alert(s)` : "\nno alerts");
  process.exit(alerts.length ? 1 : 0);
}
