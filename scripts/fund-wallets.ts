/**
 * Fund every service wallet from the deployer, so only one wallet needs outside ETH.
 *   NETWORK=mainnet bun scripts/fund-wallets.ts          plan only (balances and what would move)
 *   NETWORK=mainnet bun scripts/fund-wallets.ts --send   send the top-ups
 * Keys come from deploy/<network>.env (gitignored); never prints secrets. Each wallet is topped up
 * to its target; the deployer always keeps DEPLOY_RESERVE for the contract deploy (Deploy.s.sol
 * simulates at ~32M gas on mainnet).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, formatEther, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const NETWORK = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet";
const send = process.argv.includes("--send");
const env = Object.fromEntries(readFileSync(join(import.meta.dir, "..", "deploy", `${NETWORK}.env`), "utf8").split(/\r?\n/).flatMap((l) => {
  const m = /^([A-Z0-9_]+)=(.+)$/.exec(l.trim());
  return m ? [[m[1]!, m[2]!]] : [];
})) as Record<string, string>;

/**
 * Targets in ETH. Mainnet (0.02 gwei, ethPerTin 0.00005 after setParams):
 * operator fronts each tin's ETH and pays executeRound gas (≈100 tins); relayer pays gas for
 * users' spends (≈100 at ~2M gas); ppoi nodes post a root hourly and flag.
 */
const DEFAULTS = NETWORK === "mainnet"
  ? { DEPLOY_RESERVE: "0.0015", OPERATOR: "0.006", RELAYER: "0.005", PPOI1: "0.001", PPOI2: "0.001" }
  : { DEPLOY_RESERVE: "0.0003", OPERATOR: "0.0005", RELAYER: "0.0002", PPOI1: "0.0001", PPOI2: "0.0001" };
/** Any target can be overridden per run, e.g. FUND_OPERATOR=0.00575. */
const TARGETS = Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, process.env[`FUND_${k}`] ?? v])) as typeof DEFAULTS;

const rpc = env.RPC_URL ?? `https://rpc.${NETWORK}.chain.robinhood.com`;
const chain = { id: NETWORK === "mainnet" ? 4663 : 46630, name: `rhc-${NETWORK}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
const pub = createPublicClient({ chain, transport: http(rpc) });
const deployer = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY as Hex);
const wallet = createWalletClient({ chain, transport: http(rpc), account: deployer });

const rows = (["OPERATOR", "RELAYER", "PPOI1", "PPOI2"] as const).map((k) => ({
  name: k, address: privateKeyToAccount(env[`${k}_PRIVATE_KEY`] as Hex).address, target: parseEther(TARGETS[k]),
}));
const reserve = parseEther(TARGETS.DEPLOY_RESERVE);
let available = (await pub.getBalance({ address: deployer.address })) - reserve;
console.log(`${NETWORK}: deployer ${deployer.address} holds ${formatEther(available + reserve)} ETH (keeps ${TARGETS.DEPLOY_RESERVE} for the deploy)`);

let short = 0n;
for (const r of rows) {
  const bal = await pub.getBalance({ address: r.address });
  const need = bal >= r.target ? 0n : r.target - bal;
  console.log(`  ${r.name.padEnd(8)} ${r.address} has ${formatEther(bal)}, target ${formatEther(r.target)}${need ? `, needs ${formatEther(need)}` : ", ok"}`);
  if (!need) continue;
  if (need > available) {
    short += need - (available > 0n ? available : 0n);
    available = 0n; // what is left cannot cover this wallet; count the whole gap once
    continue;
  }
  if (send) {
    const hash = await wallet.sendTransaction({ to: r.address, value: need });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    console.log(`    sent ${formatEther(need)} ETH: ${rcpt.status} ${hash}`);
  }
  available -= need;
}
if (short > 0n) console.log(`deployer is short by ${formatEther(short)} ETH (plus a little gas): fund it and rerun`);
else console.log(send ? "done" : "plan only: rerun with --send to move it");
process.exit(short > 0n ? 1 : 0);
