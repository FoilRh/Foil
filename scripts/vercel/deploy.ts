/**
 * Deploys Foil's stack to Vercel from deploy/<network>.env (secrets) and
 * contracts/deployments/<chainId>.json. NETWORK=testnet (default, 46630) or mainnet (4663).
 * Never prints secrets.
 *   bun scripts/vercel/deploy.ts services   relayer, operator, ppoi ×2, indexer, api, relay
 *   bun scripts/vercel/deploy.ts web        builds apps/web against the relay, deploys it
 *   bun scripts/vercel/deploy.ts cron       Supabase pg_cron → each service's /tick
 * Public URLs go to deploy/<network>-urls.json. Run `bun scripts/vercel/build.ts` first.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import postgres from "postgres";
import { privateKeyToAccount } from "viem/accounts";
import { CC_PINNED } from "@foil/protocol";

const NETWORK = process.env.NETWORK ?? "testnet";
if (NETWORK !== "testnet" && NETWORK !== "mainnet") throw new Error("NETWORK must be testnet or mainnet");
const CHAIN_ID = NETWORK === "mainnet" ? 4663 : 46630;
const PREFIX = `foil-${NETWORK}`;
const BLOCKLIST_URL = "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.json";
const root = join(import.meta.dir, "..", "..");
const buildDir = join(root, ".vercel-build");
const urlsFile = join(root, "deploy", `${NETWORK}-urls.json`);

const env = Object.fromEntries(
  readFileSync(join(root, "deploy", `${NETWORK}.env`), "utf8").split(/\r?\n/).flatMap((l) => {
    const m = /^([A-Z0-9_]+)=(.+)$/.exec(l.trim());
    return m ? [[m[1]!, m[2]!]] : [];
  }),
) as Record<string, string>;
/** Vercel team slug, from deploy/<network>.env (VERCEL_SCOPE) or the environment. */
const TEAM = process.env.VERCEL_SCOPE ?? env.VERCEL_SCOPE;
if (!TEAM) throw new Error("set VERCEL_SCOPE (the Vercel team slug) in deploy/<network>.env");
/**
 * Each ticked project gets its own /tick bearer, derived from the master TICK_TOKEN (which stays in
 * deploy/<network>.env and is never deployed), so one leaked project token cannot tick the others.
 */
const tickToken = (name: string) => {
  if ((env.TICK_TOKEN ?? "").length < 32) throw new Error("TICK_TOKEN (>= 32 chars) missing from deploy env");
  return createHmac("sha256", env.TICK_TOKEN!).update(`foil-tick:${NETWORK}:${name}`).digest("hex");
};
const depFile = join(root, "contracts", "deployments", `${CHAIN_ID}.json`);
/** The contract manifest; empty before the network's contracts are deployed (only `web` works then). */
const dep: Record<string, string> = existsSync(depFile) ? JSON.parse(readFileSync(depFile, "utf8")) : {};
const urls: Record<string, string> = existsSync(urlsFile) ? JSON.parse(readFileSync(urlsFile, "utf8")) : {};
const saveUrls = () => writeFileSync(urlsFile, JSON.stringify(urls, null, 2) + "\n");

const vercelBin = Bun.which("vercel") ?? "vercel";
function vercel(args: string[], o: { cwd?: string; stdin?: string } = {}) {
  const r = Bun.spawnSync([vercelBin, ...args, "--scope", TEAM, "--non-interactive"], {
    cwd: o.cwd ?? root, stdin: o.stdin === undefined ? "ignore" : new Blob([o.stdin]), stdout: "pipe", stderr: "pipe",
  });
  return { ok: r.exitCode === 0, out: r.stdout.toString(), err: r.stderr.toString() };
}
const must = (r: ReturnType<typeof vercel>, what: string) => {
  if (!r.ok) throw new Error(`${what} failed:\n${r.err.slice(-1500)}`);
  return r;
};

const secret = (k: string) => /KEY|TOKEN|DATABASE|WEBHOOK/.test(k);
function setEnv(project: string, vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    must(vercel(["env", "add", k, "production", "--project", project, "--force", "--yes", secret(k) ? "--sensitive" : "--no-sensitive"], { stdin: v }), `env ${project} ${k}`);
  }
}

/** Deploys the prebuilt output in `dir` to `project` in production; returns its stable URL. */
function deployOnly(project: string, dir: string): string {
  must(vercel(["link", "--yes", "--project", project], { cwd: dir }), `link ${project}`);
  let d = vercel(["deploy", "--prebuilt", "--prod", "--yes"], { cwd: dir });
  for (let i = 0; !d.ok && i < 2; i++) d = vercel(["deploy", "--prebuilt", "--prod", "--yes"], { cwd: dir }); // Vercel upload hiccups
  must(d, `deploy ${project}`);
  const url = /https:\/\/\S+\.vercel\.app/.exec(d.out + d.err)?.[0];
  if (!url) throw new Error(`deploy ${project}: no URL in output`);
  const inspect = vercel(["inspect", url]);
  const aliases = [...(inspect.out + inspect.err).matchAll(/https:\/\/[a-z0-9-]+\.vercel\.app/g)].map((m) => m[0]);
  const stable = aliases.filter((a) => a.startsWith(`https://${project}`)).sort((a, b) => a.length - b.length)[0];
  if (!stable) throw new Error(`deploy ${project}: no production alias`);
  console.log(`${project}: ${stable}`);
  return stable;
}

function ensureProject(project: string) {
  const r = vercel(["project", "add", project]);
  if (!r.ok && !/already exists/i.test(r.err)) throw new Error(`project add ${project} failed:\n${r.err.slice(-800)}`);
}

const chain = { RPC_URL: env.RPC_URL!, CHAIN_ID: String(CHAIN_ID), POOL_ADDRESS: dep.pool, USDG_ADDRESS: dep.usdg, GATE_ADDRESS: dep.gate, START_BLOCK: String(dep.startBlock) };
const svc = (SERVICE: string, vars: Record<string, string>) => ({ SERVICE, ...vars });
/**
 * Collector Crypt for browser mode. Mainnet: the pinned contracts, once SHIPPING_PAYEES (CC's
 * shipping payee addresses) is in deploy/mainnet.env. Testnet: the stand-in from
 * contracts/script/DeployMockCC.s.sol, when deployed.
 */
const cc: Record<string, string> = NETWORK === "mainnet"
  ? (env.SHIPPING_PAYEES ? { CC_VAULT_ADDRESS: CC_PINNED.gachaVault, CARD_NFT_ADDRESS: CC_PINNED.cardNft, SHIPPING_PAYEES: env.SHIPPING_PAYEES } : {})
  : dep.ccVault
    ? { CC_VAULT_ADDRESS: dep.ccVault, CARD_NFT_ADDRESS: dep.cardNft, SHIPPING_PAYEES: privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY as `0x${string}`).address }
    : {};

async function services() {
  if (!existsSync(join(buildDir, ".vercel", "output", "config.json"))) throw new Error("run bun scripts/vercel/build.ts first");
  if (!dep.pool) throw new Error(`no contracts/deployments/${CHAIN_ID}.json: deploy the contracts first`);
  const plan: [string, Record<string, string>][] = [
    ["relayer", svc("relayer", { RPC_URL: chain.RPC_URL, POOL_ADDRESS: chain.POOL_ADDRESS, RELAYER_PRIVATE_KEY: env.RELAYER_PRIVATE_KEY!, INTERNAL_TOKEN: env.RELAYER_TOKEN! })],
    ["operator", svc("round-operator", { RPC_URL: chain.RPC_URL, CHAIN_ID: chain.CHAIN_ID, POOL_ADDRESS: chain.POOL_ADDRESS, OPERATOR_PRIVATE_KEY: env.OPERATOR_PRIVATE_KEY!, DATABASE_URL: env.DATABASE_URL!, INTERNAL_TOKEN: env.OPERATOR_TOKEN!, TICK_TOKEN: tickToken("operator") })],
    ...(["1", "2"] as const).map((n): [string, Record<string, string>] => [`ppoi-${n}`, svc("ppoi-node", { RPC_URL: chain.RPC_URL, POOL_ADDRESS: chain.POOL_ADDRESS, GATE_ADDRESS: chain.GATE_ADDRESS, USDG_ADDRESS: chain.USDG_ADDRESS, START_BLOCK: chain.START_BLOCK, PPOI_PRIVATE_KEY: env[`PPOI${n}_PRIVATE_KEY`]!, BLOCKLIST_URL, INTERNAL_TOKEN: env[`PPOI${n}_TOKEN`]!, TICK_TOKEN: tickToken(`ppoi-${n}`) })]),
    ["indexer", svc("indexer", { RPC_URL: chain.RPC_URL, POOL_ADDRESS: chain.POOL_ADDRESS, USDG_ADDRESS: chain.USDG_ADDRESS, START_BLOCK: chain.START_BLOCK, DATABASE_URL: env.DATABASE_URL!, TICK_TOKEN: tickToken("indexer"), SNAPSHOT_MS: "60000", ...(cc.CARD_NFT_ADDRESS ? { CARD_NFT_ADDRESS: cc.CARD_NFT_ADDRESS } : {}) })],
  ];
  for (const [name, vars] of plan) {
    const project = `${PREFIX}-${name}`;
    ensureProject(project);
    setEnv(project, vars);
    urls[name] = deployOnly(project, buildDir);
    saveUrls();
  }
  const api = `${PREFIX}-api`;
  ensureProject(api);
  setEnv(api, svc("api", {
    ...chain,
    OHTTP_KEY_ID: env.OHTTP_KEY_ID!, OHTTP_PRIVATE_KEY: env.OHTTP_PRIVATE_KEY!, OHTTP_PUBLIC_KEY: env.OHTTP_PUBLIC_KEY!,
    RELAYER_URL: urls.relayer!, RELAYER_ADDRESS: privateKeyToAccount(env.RELAYER_PRIVATE_KEY as `0x${string}`).address, RELAYER_TOKEN: env.RELAYER_TOKEN!,
    OPERATOR_URL: urls.operator!, OPERATOR_TOKEN: env.OPERATOR_TOKEN!,
    PPOI_URLS: `${urls["ppoi-1"]},${urls["ppoi-2"]}`, PPOI_TOKENS: `${env.PPOI1_TOKEN},${env.PPOI2_TOKEN}`,
    DATABASE_URL: env.DATABASE_URL!,
    ...cc,
  }));
  urls.api = deployOnly(api, buildDir);
  saveUrls();
  relay();
  monitor();
}

/** Read-only monitor (scripts/monitor.ts): pg_cron runs it every 10 minutes (see cron()). */
function monitor() {
  const project = `${PREFIX}-monitor`;
  ensureProject(project);
  const watched = Object.fromEntries(["operator", "relayer", "ppoi-1", "ppoi-2"].map((k) => [k, urls[k]!]));
  setEnv(project, svc("monitor", {
    NETWORK, RPC_URL: chain.RPC_URL, DATABASE_URL: env.DATABASE_URL!, TICK_TOKEN: tickToken("monitor"), LOOKBACK_MINUTES: "11",
    DEPLOYMENT_JSON: JSON.stringify(dep), SERVICE_URLS_JSON: JSON.stringify(watched),
    ...(env.ALERT_WEBHOOK_URL ? { ALERT_WEBHOOK_URL: env.ALERT_WEBHOOK_URL } : {}),
  }));
  urls.monitor = deployOnly(project, buildDir);
  saveUrls();
}

/** Web project and custom domain, from deploy/<network>.env (WEB_PROJECT, WEB_DOMAIN). */
const WEB_PROJECT = env.WEB_PROJECT ?? PREFIX;
const WEB_DOMAIN = env.WEB_DOMAIN;
/** Every origin the web app is served from: the custom domain (and www) and the Vercel alias. */
const webOrigins = () => [
  ...(WEB_DOMAIN ? [`https://${WEB_DOMAIN}`, `https://www.${WEB_DOMAIN}`] : []),
  urls.web ?? `https://${WEB_PROJECT}.vercel.app`,
];

/** The relay only forwards to the API's gateway, and only for the web app's origins. */
function relay() {
  const project = `${PREFIX}-relay`;
  ensureProject(project);
  if (!urls.api) throw new Error("deploy the API first (deploy.ts services)");
  // Only the mainnet relay serves the public website; testnet's accepts local development only.
  const origins = NETWORK === "mainnet" ? [...new Set(webOrigins())] : ["http://localhost:3000"];
  setEnv(project, svc("ohttp-relay", { GATEWAY_URL: `${urls.api}/gateway`, ALLOWED_ORIGINS: origins.join(",") }));
  urls.relay = deployOnly(project, buildDir);
  saveUrls();
}

/**
 * The public website is mainnet-only (WEB_PROJECT / WEB_DOMAIN in deploy/mainnet.env). Until the
 * mainnet relay is deployed it is built with no backend, so the dashboard runs in its local
 * example mode; once `deploy.ts services` has run on mainnet it is built against that relay.
 */
function web() {
  if (NETWORK !== "mainnet") throw new Error("the website is mainnet-only: run NETWORK=mainnet bun scripts/vercel/deploy.ts web");
  const project = WEB_PROJECT;
  ensureProject(project);
  const site = WEB_DOMAIN ? `https://${WEB_DOMAIN}` : urls.web ?? `https://${project}.vercel.app`;
  const live = Boolean(urls.relay && env.OHTTP_KEY_CONFIG);
  const webDir = join(root, "apps", "web");
  const b = Bun.spawnSync(["bun", "run", "build"], {
    cwd: webDir, stdout: "inherit", stderr: "inherit",
    env: {
      ...process.env, NEXT_PUBLIC_CHAIN_ID: String(CHAIN_ID), NEXT_PUBLIC_SITE_URL: site,
      NEXT_PUBLIC_OHTTP_RELAY_URL: live ? urls.relay! : "", NEXT_PUBLIC_OHTTP_KEY_CONFIG: live ? env.OHTTP_KEY_CONFIG! : "",
    },
  });
  if (b.exitCode !== 0) throw new Error("web build failed");
  console.log(live ? `web: live against ${urls.relay}` : "web: no mainnet backend yet, built in example mode");
  const dir = join(root, ".vercel-build-web");
  const out = join(dir, ".vercel", "output");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(webDir, "out"), join(out, "static"), { recursive: true });
  writeFileSync(join(out, "config.json"), JSON.stringify({
    version: 3,
    routes: [
      { src: "^/((?:[^/]+/)*[^/.]+)$", status: 308, headers: { Location: "/$1/" } }, // trailingSlash: true
      { handle: "filesystem" },
      { src: "/(.*)", status: 404, dest: "/404.html" },
    ],
  }));
  urls.web = deployOnly(project, dir);
  saveUrls();
  if (WEB_DOMAIN) {
    // Apex and www on this project; "already" errors mean it is attached.
    for (const d of [WEB_DOMAIN, `www.${WEB_DOMAIN}`]) {
      const r = vercel(["domains", "add", d, project]);
      if (!r.ok && !/already|in use by this project/i.test(r.out + r.err)) throw new Error(`domains add ${d}: ${(r.out + r.err).slice(-400)}`);
    }
  }
  if (live) relay(); // the mainnet relay must accept the site's origins
}

/** Supabase pg_cron + pg_net call each service's /tick. The token is stored in cron.job (server-only DB). */
async function cron() {
  const sql = postgres(env.DATABASE_URL!, { prepare: false, max: 1 });
  const jobs: [string, string, string][] = [
    ["foil-operator-tick", "* * * * *", "operator"],
    ["foil-indexer-tick", "* * * * *", "indexer"],
    ["foil-ppoi-1-tick", "7 * * * *", "ppoi-1"],
    ["foil-ppoi-2-tick", "37 * * * *", "ppoi-2"],
    ["foil-monitor-tick", "*/10 * * * *", "monitor"],
  ];
  for (const [name, schedule, svcName] of jobs) {
    const base = urls[svcName];
    if (!base) throw new Error(`no URL for ${name}; deploy services first`);
    const cmd = `select net.http_post(url := '${base}/tick', headers := jsonb_build_object('Authorization', 'Bearer ${tickToken(svcName)}', 'Content-Type', 'application/json'), body := '{}'::jsonb, timeout_milliseconds := 120000)`;
    await sql`select cron.schedule(${name}, ${schedule}, ${cmd})`;
    console.log(`cron ${name} ${schedule} → ${base}/tick`);
  }
  await sql.end();
}

const step = process.argv[2];
if (step === "services") await services();
else if (step === "web") web();
else if (step === "cron") await cron();
else if (step === "monitor") monitor();
else if (step === "relay") relay();
else throw new Error("usage: deploy.ts services|web|cron|monitor|relay");
