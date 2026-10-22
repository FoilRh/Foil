// flagBlocked applies the same screening rule as attest: blocklisted origins AND send-backs
// not covered by what the tin got from clean sources (else admitAfterStandby admits them).
// Dust from an outsider does not taint a tin's own funds.
import { expect, test } from "bun:test";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Rejected, createNode } from "./node";

const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const POOL = a(1), GATE = a(2), USDG = a(3), VAULT = a(4);
const BAD = a(0xbad), OUTSIDER = a(0x0757), CLEAN_TIN = a(0x71), DIRTY_TIN = a(0x72), DUSTED_TIN = a(0x73), USER = a(0x55);
const DEPOSIT = 0, SEND_BACK = 1, PENDING = 1, ADMITTED = 2;
const entries: [Address, number, number][] = [
  [USER, DEPOSIT, PENDING],
  [CLEAN_TIN, SEND_BACK, PENDING],
  [DIRTY_TIN, SEND_BACK, PENDING],
  [BAD, DEPOSIT, PENDING],
  [DIRTY_TIN, SEND_BACK, ADMITTED],
  [DUSTED_TIN, SEND_BACK, PENDING],
];
const inbound: Record<string, [Address, bigint][]> = {
  [CLEAN_TIN]: [[POOL, 25n], [VAULT, 5n]],
  [DIRTY_TIN]: [[VAULT, 10n], [OUTSIDER, 100n]],
  [DUSTED_TIN]: [[POOL, 25n], [OUTSIDER, 1n]],
};
const sentBack: Record<string, bigint> = { [CLEAN_TIN]: 20n, [DIRTY_TIN]: 50n, [DUSTED_TIN]: 25n };

const flagged: bigint[] = [];
const publicClient = {
  readContract: async ({ functionName, args }: { functionName: string; args: unknown[] }) => {
    if (functionName === "nextSeq") return BigInt(entries.length);
    if (functionName === "entries") { const [o, k, s] = entries[Number(args[0])]!; return [o, k, s, 0n, 0n, 0n, 0n]; }
    if (functionName === "cleanInbound") return [POOL, VAULT].includes(args[0] as Address);
    if (functionName === "admitDigest") return `0x${"ab".repeat(32)}`;
    if (functionName === "tinSentBack") return sentBack[args[0] as string] ?? 0n;
    throw new Error(functionName);
  },
  getLogs: async ({ args }: { args: { to: Address } }) => (inbound[args.to] ?? []).map(([from, value]) => ({ args: { from, value } })),
  waitForTransactionReceipt: async () => ({}),
};
const walletClient = { writeContract: async ({ args }: { args: [bigint] }) => { flagged.push(args[0]); return "0x01"; } };
const node = createNode({
  pool: POOL, gate: GATE, usdg: USDG, startBlock: 0n, account: privateKeyToAccount(`0x${"33".repeat(32)}`),
  publicClient: publicClient as never, walletClient: walletClient as never, blocklist: [BAD], poseidon: (x) => x,
});

test("flagBlocked flags blocklisted origins and send-backs with unclean inbound", async () => {
  expect(await node.flagBlocked()).toEqual([2n, 3n]);
  expect(flagged).toEqual([2n, 3n]);
});

test("attest agrees: it signs only what flagBlocked leaves alone", async () => {
  expect(await node.attest(0n)).toMatch(/^0x/);
  expect(await node.attest(1n)).toMatch(/^0x/);
  await expect(node.attest(2n)).rejects.toThrow(Rejected);
  await expect(node.attest(2n)).rejects.toThrow(/exceeds what the tin received from clean sources/);
  expect(await node.attest(5n)).toMatch(/^0x/); // dusted by an outsider, still clean
  await expect(node.attest(3n)).rejects.toThrow(/blocklisted/);
});
