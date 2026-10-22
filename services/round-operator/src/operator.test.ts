import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPublicClient, createWalletClient, http, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { cancelHashOf, stashPoolAbi, tinCommitOf, usdgAbi } from "@foil/protocol";
import { ANVIL_KEYS, hasFoundry, setTime, startDevchain } from "../../../scripts/devchain";
import { createOperator } from "./operator";
import { planExecution } from "./plan";
import { verifyReceipt } from "./receipt";
import { memoryRevealStore } from "./store";

test("plan sorts by tin, keeps repeats (two requests per tin) and drops settled requests", () => {
  const r = (tin: string, salt = "0x01") => ({ tin: tin as Address, salt: salt as Hex });
  const plan = planExecution([r("0x0000000000000000000000000000000000000003"), r("0x0000000000000000000000000000000000000001"),
    r("0x0000000000000000000000000000000000000003"), r("0x0000000000000000000000000000000000000002")],
  (x) => x.tin !== "0x0000000000000000000000000000000000000002");
  expect(plan.tins).toEqual(["0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000003",
    "0x0000000000000000000000000000000000000003"]);
});

describe.skipIf(!hasFoundry())("round operator on anvil", () => {
  const opAccount = privateKeyToAccount(ANVIL_KEYS[1]!);
  const user = privateKeyToAccount(ANVIL_KEYS[2]!);
  let chain: Awaited<ReturnType<typeof startDevchain>>;

  beforeAll(async () => {
    chain = await startDevchain({ port: 8611, mockVerifiers: true, operator: opAccount.address });
  }, 120_000);
  afterAll(() => chain?.stop());

  test("reveals get receipts; one tick closes and funds the round", async () => {
    const transport = http(chain.rpc);
    const pub = createPublicClient({ transport });
    const wallet = createWalletClient({ transport, account: user });
    const { pool, usdg, chainId } = chain.deployment;
    const write = async (address: Address, abi: unknown, functionName: string, args: unknown[]) => {
      const hash = await wallet.writeContract({ address, abi, functionName, args, chain: null } as never);
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error(`${functionName} reverted`);
    };
    const read = <T>(functionName: string, args: unknown[] = []) =>
      pub.readContract({ address: pool, abi: stashPoolAbi, functionName, args } as never) as Promise<T>;

    // Fund the shielded side (mock verifiers stand in for proofs here).
    await write(usdg, usdgAbi, "mint", [user.address, 10_000_000_000n]);
    await write(usdg, usdgAbi, "approve", [pool, 2n ** 255n]);
    await write(pool, stashPoolAbi, "deposit", [1_000_000_000n, 1n, "0x", "0x"]);
    const block = await pub.getBlock();
    await setTime(chain.rpc, Number(block.timestamp) + 3600);
    await write(pool, stashPoolAbi, "admitAfterStandby", [0n]);

    // Eight requests in round 1.
    const roundId = await read<bigint>("currentRound");
    const reveals: { tin: Address; salt: Hex }[] = [];
    for (let i = 0; i < 8; i++) {
      const tin = privateKeyToAccount(keccak256(toHex(`tin-${i}`))).address;
      const salt = keccak256(toHex(`salt-${i}`));
      reveals.push({ tin, salt });
      await write(pool, stashPoolAbi, "requestTin", [
        { a: [0n, 0n], b: [[0n, 0n], [0n, 0n]], c: [0n, 0n] },
        {
          root: await read<bigint>("lastRoot"), nullifiers: [BigInt(100 + 2 * i), BigInt(101 + 2 * i)], changeCommitment: BigInt(500 + i),
          size: 25_000_000n, fee: 0n, roundId, tinCommit: tinCommitOf(tin, salt, 25_000_000n, roundId),
          refundCommit: BigInt(900 + i), cancelHash: cancelHashOf(salt), relayer: "0x0000000000000000000000000000000000000000",
          encryptedChange: "0x",
        },
      ]);
    }

    const operator = createOperator({
      pool, chainId, account: opAccount, publicClient: pub as never,
      walletClient: createWalletClient({ transport, account: opAccount }), store: memoryRevealStore(),
    });

    for (const r of reveals) {
      const receipt = await operator.acceptReveal(roundId, r);
      expect(receipt.tinCommit).toBe(tinCommitOf(r.tin, r.salt, 25_000_000n, roundId));
      expect(await verifyReceipt(opAccount.address, chainId, pool, receipt)).toBe(true);
    }
    await expect(operator.acceptReveal(roundId, { tin: reveals[0]!.tin, salt: keccak256(toHex("wrong")) })).rejects.toThrow();

    const now = Number((await pub.getBlock()).timestamp);
    await setTime(chain.rpc, Math.floor(now / 600) * 600 + 600 + 5); // just after the next boundary
    await operator.tick();

    expect(await read<bigint>("currentRound")).toBe(roundId + 1n);
    for (const r of reveals) {
      expect(await pub.readContract({ address: usdg, abi: usdgAbi, functionName: "balanceOf", args: [r.tin] })).toBe(25_000_000n);
      expect(await pub.getBalance({ address: r.tin })).toBe(await read<bigint>("ethPerTin"));
    }
  }, 120_000);
});
