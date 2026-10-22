/**
 * Full request path, in process: client → OHTTP → relay → gateway → tRPC → relayer /
 * round-operator → anvil. Proves the transport, the gateway, the router allowlists and
 * the service hand-offs fit together. (Real proofs: see e2e/smoke.test.ts.)
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decapsulateRequest, encodeKeyConfig, generateGatewayKey, hex } from "@foil/ohttp";
import { stashPoolAbi, toJson, usdgAbi } from "@foil/protocol";
import { createApi, createChainClient } from "@foil/client";
import { createApp } from "../apps/api/src/app";
import { memoryStores } from "../apps/api/src/stores";
import { createRelay } from "../services/ohttp-relay/src/relay";
import { createRelayer } from "../services/relayer/src/relayer";
import { createOperator } from "../services/round-operator/src/operator";
import { memoryRevealStore } from "../services/round-operator/src/store";
import { ANVIL_KEYS, hasFoundry, setTime, startDevchain } from "../scripts/devchain";

describe.skipIf(!hasFoundry())("stack over OHTTP", () => {
  const relayerAcct = privateKeyToAccount(ANVIL_KEYS[3]!);
  const operatorAcct = privateKeyToAccount(ANVIL_KEYS[1]!);
  const user = privateKeyToAccount(ANVIL_KEYS[2]!);
  let chain: Awaited<ReturnType<typeof startDevchain>>;
  let api: ReturnType<typeof createApi>;
  const seen: { relayHeaders: string[]; gatewayBodies: number; lastBody?: Uint8Array } = { relayHeaders: [], gatewayBodies: 0 };

  beforeAll(async () => {
    chain = await startDevchain({ port: 8612, mockVerifiers: true, operator: operatorAcct.address });
    const { pool, usdg, gate, chainId } = chain.deployment;
    const transport = http(chain.rpc);
    const publicClient = createPublicClient({ transport });
    const relayer = createRelayer({ pool, account: relayerAcct, publicClient: publicClient as never, walletClient: createWalletClient({ transport, account: relayerAcct }) });
    const operator = createOperator({
      pool, chainId, account: operatorAcct, publicClient: publicClient as never,
      walletClient: createWalletClient({ transport, account: operatorAcct }), store: memoryRevealStore(),
    });
    const gatewayKey = await generateGatewayKey(3);
    const stores = memoryStores();
    const gateway = createApp(gatewayKey, {
      chain: publicClient as never, pool, usdg, gate, chainId, startBlock: 0n,
      relayer: { address: relayerAcct.address, feeFloor: "250000" },
    stores,
    attest: async () => [],
      internal: async (service, _path, body) => {
        if (service === "relayer") {
          const b = body as { fn: string; args: unknown[] };
          return relayer.relay(b.fn, b.args);
        }
        const b = body as { roundId: string; tin: Address; salt: `0x${string}` };
        return toJson(await operator.acceptReveal(BigInt(b.roundId), { tin: b.tin, salt: b.salt }));
      },
    });
    const relay = createRelay({
      gatewayUrl: "https://api.test/gateway", allowedOrigins: [],
      upstream: async (url, init) => {
        if (String(url).endsWith("/gateway")) {
          seen.gatewayBodies++;
          seen.lastBody = new Uint8Array((init as RequestInit).body as Uint8Array);
        }
        return gateway.fetch(new Request(String(url), init as RequestInit));
      },
    });
    api = createApi({
      relayUrl: "https://relay.test",
      keyConfig: hex(encodeKeyConfig(gatewayKey)),
      fetchImpl: async (url, init) => {
        const req = new Request(String(url), init as RequestInit);
        seen.relayHeaders.push(...[...req.headers.keys()]);
        return relay(req);
      },
    });

    // A pending deposit for the relay test.
    const w = createWalletClient({ transport, account: user });
    const send = async (address: Address, abi: unknown, functionName: string, args: unknown[]) =>
      publicClient.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi, functionName, args, chain: null } as never) });
    await send(usdg, usdgAbi, "mint", [user.address, 100_000_000n]);
    await send(usdg, usdgAbi, "approve", [pool, 100_000_000n]);
    await send(pool, stashPoolAbi, "deposit", [30_000_000n, 5n, "0x", "0x"]);
  }, 120_000);
  afterAll(() => chain?.stop());

  test("config and status come back through the gateway", async () => {
    const cfg = await api.config.query();
    expect(cfg.pool).toBe(chain.deployment.pool);
    expect(cfg.relayer).toBe(relayerAcct.address);
    const s = await api.status.query();
    expect(s.health.conservation).toBe("verified");
    expect(s.round.roundId).toBe("1");
  });

  test("a relay with its own key cannot open what clients send (pinned key)", async () => {
    const relayKey = await generateGatewayKey(3);
    await expect(decapsulateRequest(relayKey, seen.lastBody!)).rejects.toThrow();
  });

  test("the relay only ever sees ciphertext and two headers", async () => {
    expect(new Set(seen.relayHeaders)).toEqual(new Set(["content-type"]));
    expect(seen.gatewayBodies).toBeGreaterThan(0);
  });

  test("rpc proxy works and enforces its allowlist", async () => {
    const chainClient = createChainClient(api);
    expect(await chainClient.getChainId()).toBe(31337);
    expect(await chainClient.readContract({ address: chain.deployment.pool, abi: stashPoolAbi, functionName: "currentRound" })).toBe(1n);
    await expect(api.rpc.mutate({ method: "eth_sendRawTransaction", params: ["0x"] })).rejects.toThrow(/not allowed/);
    await expect(api.rpc.mutate({ method: "eth_call", params: [{ to: user.address, data: "0x" }, "latest"] })).rejects.toThrow(/not allowed/);
    await expect(api.rpc.mutate({ method: "eth_getLogs", params: [{ address: chain.deployment.usdg }] })).rejects.toThrow(/only for the pool/);
  });

  test("relay submits allowed calls and refuses the rest", async () => {
    await expect(api.relay.mutate({ fn: "admitAfterStandby", args: ["0"] })).rejects.toThrow(/StandbyActive/);
    const block = await createPublicClient({ transport: http(chain.rpc) }).getBlock();
    await setTime(chain.rpc, Number(block.timestamp) + 3600);
    const r = (await api.relay.mutate({ fn: "admitAfterStandby", args: ["0"] })) as { txHash: string };
    expect(r.txHash).toMatch(/^0x/);
    await expect(api.relay.mutate({ fn: "setOperator", args: [user.address, true] })).rejects.toThrow(/not relayable/);
    await expect(api.relay.mutate({ fn: "transact", args: [
      { a: ["0", "0"], b: [["0", "0"], ["0", "0"]], c: ["0", "0"] }, "1", ["1", "2"], ["3", "4"],
      { recipient: user.address, extAmount: "0", relayer: user.address, fee: "250000", encryptedOutput1: "0x", encryptedOutput2: "0x" },
    ] })).rejects.toThrow(/paid to this relayer/);
  });

  test("encrypted backups round-trip by locator; machines and snapshot are public reads", async () => {
    const locator = `0x${"ab".repeat(32)}`;
    expect(await api.backup.get.mutate({ locator })).toBeNull();
    await api.backup.put.mutate({ locator, blob: "c2VjcmV0" });
    expect(await api.backup.get.mutate({ locator })).toBe("c2VjcmV0");
    await expect(api.backup.put.mutate({ locator: "0x12", blob: "x" })).rejects.toThrow();
    expect(await api.machines.query()).toEqual([]);
    expect(await api.snapshot.query()).toBeNull();
  });

  test("a reveal for an unknown request is rejected by the operator", async () => {
    await expect(api.reveal.mutate({ roundId: "1", tin: user.address, salt: `0x${"11".repeat(32)}` })).rejects.toThrow();
  });
});
