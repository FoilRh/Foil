/**
 * Screening (Build §3.1, §3.3, §12) through the full stack, with two ppoi-nodes:
 *   clean deposit        → 2 signatures → admitted at once
 *   blocklisted origin   → no signatures, flagged on-chain, never a leaf, refundable
 *   send-back            → admitted at once only if every inbound to the tin was clean
 *   provider heartbeat   → fresh roots give the 15-minute standby
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createWalletClient, http, keccak256, parseEther, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { cancelHashOf, screeningGateAbi, stashPoolAbi, tinCommitOf, usdgAbi } from "@foil/protocol";
import { ANVIL_KEYS, hasFoundry, setTime } from "../scripts/devchain";
import { BLOCKED, startStack } from "./harness";

describe.skipIf(!hasFoundry())("screening with two ppoi-nodes", () => {
  let s: Awaited<ReturnType<typeof startStack>>;
  const user = privateKeyToAccount(ANVIL_KEYS[4]!);

  const write = async (account: PrivateKeyAccount, address: Address, abi: unknown, functionName: string, args: unknown[], value = 0n) => {
    const w = createWalletClient({ transport: http(s.chain.rpc), account });
    const r = await s.publicClient.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi, functionName, args, value, chain: null } as never) });
    if (r.status !== "success") throw new Error(`${functionName} reverted`);
  };
  const read = <T>(functionName: string, args: unknown[] = []) =>
    s.publicClient.readContract({ address: s.chain.deployment.pool, abi: stashPoolAbi, functionName, args } as never) as Promise<T>;
  const entryState = async (seq: bigint) => Number((await read<readonly unknown[]>("entries", [seq]))[2]);
  const deposit = async (who: PrivateKeyAccount, amount: bigint) => {
    await write(who, s.chain.deployment.usdg, usdgAbi, "mint", [who.address, amount]);
    await write(who, s.chain.deployment.usdg, usdgAbi, "approve", [s.chain.deployment.pool, amount]);
    const seq = await read<bigint>("nextSeq");
    await write(who, s.chain.deployment.pool, stashPoolAbi, "deposit", [amount, 7n, "0x", "0x"]);
    return seq;
  };

  beforeAll(async () => {
    s = await startStack({ port: 8614, mockVerifiers: true });
    await fetch(s.chain.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [BLOCKED.address, toHex(parseEther("1"))] }) });
  }, 120_000);
  afterAll(() => s?.chain.stop());

  test("heartbeat: both providers publish their blocklist root and become fresh", async () => {
    for (const n of s.nodes) await n.publishRoot();
    const [, root] = (await s.publicClient.readContract({ address: s.chain.deployment.gate, abi: screeningGateAbi, functionName: "providers", args: [s.nodes[0]!.address] })) as readonly [boolean, bigint, bigint];
    expect(root).toBe(await s.nodes[0]!.root());
    expect(await s.publicClient.readContract({ address: s.chain.deployment.gate, abi: screeningGateAbi, functionName: "standby" })).toBe(900n);
  });

  test("a clean deposit is admitted at once with two signatures", async () => {
    const seq = await deposit(user, 30_000_000n);
    const sigs = await s.api.attest.mutate({ seq: seq.toString() });
    expect(sigs).toHaveLength(2);
    await s.api.relay.mutate({ fn: "admitWithSignatures", args: [seq.toString(), sigs] });
    expect(await entryState(seq)).toBe(2); // Admitted, no waiting
  });

  test("a blocklisted origin gets no signatures, is flagged, never becomes a leaf, and can only go home", async () => {
    const leaves = await read<number>("nextIndex");
    const seq = await deposit(BLOCKED, 10_000_000n);
    expect(await s.api.attest.mutate({ seq: seq.toString() })).toEqual([]);
    expect(await s.nodes[0]!.flagBlocked()).toEqual([seq]);
    expect(await entryState(seq)).toBe(3); // Flagged
    const t = Number((await s.publicClient.getBlock()).timestamp);
    await setTime(s.chain.rpc, t + 7200);
    await expect(s.api.relay.mutate({ fn: "admitAfterStandby", args: [seq.toString()] })).rejects.toThrow(/BadEntryState/);
    expect(await read<number>("nextIndex")).toBe(leaves);

    const deadline = BigInt(t + 7200 + 3600);
    const digest = await read<Hex>("exitDigest", [seq, deadline]);
    await s.api.relay.mutate({ fn: "exitPending", args: [seq.toString(), deadline.toString(), await BLOCKED.sign({ hash: digest })] });
    expect(await s.publicClient.readContract({ address: s.chain.deployment.usdg, abi: usdgAbi, functionName: "balanceOf", args: [BLOCKED.address] })).toBe(10_000_000n);
  });

  test("send-backs covered by clean inbound are admitted at once; one that includes outside money is not", async () => {
    // Fund two tins through a round (mock verifiers stand in for the request proofs).
    const tins = [privateKeyToAccount(keccak256(toHex("ppoi-tin-a"))), privateKeyToAccount(keccak256(toHex("ppoi-tin-b")))];
    const salts = tins.map((_, i) => keccak256(toHex(`ppoi-salt-${i}`)));
    const roundId = await read<bigint>("currentRound");
    for (let i = 0; i < 2; i++) {
      await write(user, s.chain.deployment.pool, stashPoolAbi, "requestTin", [
        { a: [0n, 0n], b: [[0n, 0n], [0n, 0n]], c: [0n, 0n] },
        { root: await read<bigint>("lastRoot"), nullifiers: [BigInt(900 + 2 * i), BigInt(901 + 2 * i)], changeCommitment: BigInt(40 + i),
          size: 10_000_000n, fee: 0n, roundId, tinCommit: tinCommitOf(tins[i]!.address, salts[i]!, 10_000_000n, roundId),
          refundCommit: BigInt(60 + i), cancelHash: cancelHashOf(salts[i]!), relayer: "0x0000000000000000000000000000000000000000", encryptedChange: "0x" },
      ]);
      await s.operator.acceptReveal(roundId, { tin: tins[i]!.address, salt: salts[i]! });
    }
    const t = Number((await s.publicClient.getBlock()).timestamp);
    await setTime(s.chain.rpc, t + 31 * 60);
    await s.operator.tick();

    // Tin b also receives USDG straight from the user, then sends back more than the pool
    // ever paid it: part of that send-back is outside money.
    await write(user, s.chain.deployment.usdg, usdgAbi, "mint", [user.address, 1_000_000n]);
    await write(user, s.chain.deployment.usdg, usdgAbi, "transfer", [tins[1]!.address, 1_000_000n]);

    const seqs: bigint[] = [];
    const values = [5_000_000n, 11_000_000n];
    const fees = [0n, 2_500n]; // 0.25% of the 1 USDG above what tin b was funded with
    for (const [i, tin] of tins.entries()) {
      const npk = 11n;
      const nonce = await read<Hex>("sendBackNonce", [npk, fees[i]!, "0x", "0x"]);
      const validBefore = BigInt(Number((await s.publicClient.getBlock()).timestamp) + 3600);
      const sig = await tin.signTypedData({
        domain: { name: "Global Dollar", version: "1", chainId: 31337, verifyingContract: s.chain.deployment.usdg },
        types: { ReceiveWithAuthorization: [
          { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
        ] },
        primaryType: "ReceiveWithAuthorization",
        message: { from: tin.address, to: s.chain.deployment.pool, value: values[i]!, validAfter: 0n, validBefore, nonce },
      });
      seqs.push(await read<bigint>("nextSeq"));
      await s.api.relay.mutate({ fn: "returnToStash", args: [
        { from: tin.address, value: values[i]!.toString(), validAfter: "0", validBefore: validBefore.toString(), v: parseInt(sig.slice(130, 132), 16), r: `0x${sig.slice(2, 66)}`, s: `0x${sig.slice(66, 130)}` },
        fees[i]!.toString(), npk.toString(), "0x", "0x",
      ] });
    }
    expect(await s.api.attest.mutate({ seq: seqs[0]!.toString() })).toHaveLength(2);
    expect(await s.api.attest.mutate({ seq: seqs[1]!.toString() })).toEqual([]);
  }, 120_000);
});
