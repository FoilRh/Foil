/** In-process Foil stack on anvil: OHTTP relay → gateway/tRPC → relayer + operator. */
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeKeyConfig, generateGatewayKey, hex } from "@foil/ohttp";
import { toJson } from "@foil/protocol";
import { createApi, createChainClient } from "@foil/client";
import { createApp } from "../apps/api/src/app";
import { memoryStores } from "../apps/api/src/stores";
import { createRelay } from "../services/ohttp-relay/src/relay";
import { createRelayer } from "../services/relayer/src/relayer";
import { createOperator } from "../services/round-operator/src/operator";
import { memoryRevealStore } from "../services/round-operator/src/store";
import { ANVIL_KEYS, bin as foundryBin, startDevchain } from "../scripts/devchain";
import { createNode } from "../services/ppoi-node/src/node";
import { buildPoseidon } from "circomlibjs";
import { keccak256, toHex } from "viem";

/** A test origin both ppoi-nodes treat as sanctioned. */
export const BLOCKED = privateKeyToAccount(keccak256(toHex("foil-test-blocked-origin")));

/** Deploys a test mock from contracts/out (MockCards, MockGachaVault). */
async function deployMock(rpc: string, name: string, args: unknown[] = []) {
  const { existsSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const contracts = join(import.meta.dir, "..", "contracts");
  const file = join(contracts, "out", `${name}.sol`, `${name}.json`);
  // forge script only compiles what Deploy.s.sol imports; a fresh clone has no mock artifacts.
  if (!existsSync(file)) {
    const b = Bun.spawnSync([foundryBin("forge"), "build", `test/mocks/${name}.sol`], { cwd: contracts, stdout: "ignore", stderr: "pipe" });
    if (b.exitCode !== 0) throw new Error(`forge build ${name} failed: ${b.stderr.toString()}`);
  }
  const art = JSON.parse(readFileSync(file, "utf8"));
  const deployer = privateKeyToAccount(ANVIL_KEYS[0]!);
  const w = createWalletClient({ transport: http(rpc), account: deployer });
  const pub = createPublicClient({ transport: http(rpc) });
  const hash = await w.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args, chain: null } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  return { address: r.contractAddress! as Address, abi: art.abi as unknown };
}
const deployMockCards = (rpc: string) => deployMock(rpc, "MockCards");

export async function startStack(opts: { port: number; mockVerifiers: boolean; cards?: boolean; cc?: boolean }) {
  const relayerAcct = privateKeyToAccount(ANVIL_KEYS[3]!);
  const operatorAcct = privateKeyToAccount(ANVIL_KEYS[1]!);
  const ppoiAccts = [privateKeyToAccount(ANVIL_KEYS[5]!), privateKeyToAccount(ANVIL_KEYS[6]!)];
  const chain = await startDevchain({
    port: opts.port, mockVerifiers: opts.mockVerifiers, operator: operatorAcct.address, providers: ppoiAccts.map((a) => a.address),
  });
  const { pool, usdg, gate, chainId } = chain.deployment;
  const cards = opts.cards || opts.cc ? await deployMockCards(chain.rpc) : undefined;
  // CC stand-in: the vault mints pulls and buys back against quotes signed by anvil key 0.
  const vault = opts.cc ? await deployMock(chain.rpc, "MockGachaVault", [usdg, cards!.address, privateKeyToAccount(ANVIL_KEYS[0]!).address]) : undefined;
  const transport = http(chain.rpc);
  const publicClient = createPublicClient({ transport });
  const relayer = createRelayer({
    pool, account: relayerAcct, publicClient: publicClient as never, walletClient: createWalletClient({ transport, account: relayerAcct }),
  });
  const operator = createOperator({
    pool, chainId, account: operatorAcct, publicClient: publicClient as never,
    walletClient: createWalletClient({ transport, account: operatorAcct }), store: memoryRevealStore(),
  });
  const poseidon = await buildPoseidon();
  const nodes = ppoiAccts.map((account) => createNode({
    pool, gate, usdg, startBlock: 0n, account, publicClient: publicClient as never,
    walletClient: createWalletClient({ transport, account }), blocklist: [BLOCKED.address],
    poseidon: (x) => poseidon.F.toObject(poseidon([x])),
  }));
  const gatewayKey = await generateGatewayKey(3);
  const stores = memoryStores();
  const gateway = createApp(gatewayKey, {
    chain: publicClient as never, pool, usdg, gate, chainId, startBlock: 0n, cardNft: cards?.address, vault: vault?.address,
    relayer: { address: relayerAcct.address, feeFloor: "250000" },
    stores,
    attest: async (seq) => (await Promise.allSettled(nodes.map((n) => n.attest(seq)))).flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
    internal: async (service, _path, body) => {
      if (service === "relayer") {
        const b = body as { fn: string; args: unknown[] };
        return relayer.relay(b.fn, b.args);
      }
      const b = body as { roundId: string; tin: Address; salt: `0x${string}` };
      return toJson(await operator.acceptReveal(BigInt(b.roundId), { tin: b.tin, salt: b.salt }));
    },
  });
  const seen = { relayHeaders: new Set<string>(), gatewayCalls: 0 };
  const relay = createRelay({
    gatewayUrl: "https://api.test/gateway", allowedOrigins: [],
    upstream: async (url, init) => {
      if (String(url).endsWith("/gateway")) seen.gatewayCalls++;
      return gateway.fetch(new Request(String(url), init as RequestInit));
    },
  });
  const api = createApi({
    relayUrl: "https://relay.test",
      keyConfig: hex(encodeKeyConfig(gatewayKey)),
    fetchImpl: async (url, init) => {
      const req = new Request(String(url), init as RequestInit);
      for (const k of req.headers.keys()) seen.relayHeaders.add(k);
      return relay(req);
    },
  });
  return { chain, publicClient, api, stores, nodes, cards, vault, chainClient: createChainClient(api), operator, relayerAcct, operatorAcct, seen };
}
