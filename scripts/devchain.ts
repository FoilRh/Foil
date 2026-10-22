/**
 * Local chain for service and end-to-end tests: starts anvil and deploys the contracts
 * with contracts/script/Deploy.s.sol. Requires Foundry on PATH (or in ~/.foundry/bin).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Address, Hex } from "viem";

const contracts = join(import.meta.dir, "..", "contracts");
const foundryBin = join(homedir(), ".foundry", "bin");
export const bin = (name: string) => {
  const local = join(foundryBin, process.platform === "win32" ? `${name}.exe` : name);
  return existsSync(local) ? local : name;
};

/** Anvil's well-known dev accounts (mnemonic "test test … junk"). Never use elsewhere. */
export const ANVIL_KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
];

export function hasFoundry() {
  return Bun.spawnSync([bin("anvil"), "--version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

export interface Deployment { chainId: number; usdg: Address; gate: Address; pool: Address; startBlock: number }

export async function startDevchain(opts: { port: number; mockVerifiers?: boolean; operator?: Address; providers?: Address[] }) {
  const rpc = `http://127.0.0.1:${opts.port}`;
  const alive = () => fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })
    .then((r) => r.ok).catch(() => false);
  // A leftover chain on this port would silently give tests the wrong deployment.
  if (await alive()) throw new Error(`port ${opts.port} already has a chain running; stop it first`);
  const anvil = Bun.spawn([bin("anvil"), "--port", String(opts.port), "--silent"], { stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 100 && !(await alive()); i++) await Bun.sleep(100);
  const deploy = Bun.spawnSync(
    [bin("forge"), "script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast", "--private-key", ANVIL_KEYS[0]!, "--sender", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"],
    {
      cwd: contracts,
      env: {
        ...process.env,
        MOCK_VERIFIERS: opts.mockVerifiers ? "true" : "false",
        OPERATOR: opts.operator ?? "",
        PROVIDERS: (opts.providers ?? []).join(","),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (deploy.exitCode !== 0) {
    anvil.kill();
    throw new Error(`deploy failed:\n${deploy.stdout}${deploy.stderr}`);
  }
  const deployment = JSON.parse(readFileSync(join(contracts, "deployments", "31337.json"), "utf8")) as Deployment;
  return { rpc, deployment, stop: () => anvil.kill() };
}

/** anvil: move time forward to `ts` (seconds) and mine a block there. */
export async function setTime(rpc: string, ts: number) {
  const call = (method: string, params: unknown[]) =>
    fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  await call("evm_setNextBlockTimestamp", [ts]);
  await call("evm_mine", []);
}
