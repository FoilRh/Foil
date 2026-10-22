// admitDue: the operator admits every entry whose standby ended, in seq order, so users'
// clients never have to (audit timing-linkage-admit).
import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { createOperator } from "./operator";
import { memoryRevealStore } from "./store";

const PENDING = 1, FLAGGED = 3;
const entries: [number, bigint][] = [[PENDING, 100n], [FLAGGED, 100n], [PENDING, 999n], [PENDING, 150n]];
const sent: bigint[] = [];
const publicClient = {
  readContract: async ({ functionName, args }: { functionName: string; args: unknown[] }) => {
    if (functionName === "nextSeq") return BigInt(entries.length);
    if (functionName === "entries") { const [st, end] = entries[Number(args[0])]!; return ["0x0", 0, st, end]; }
    if (functionName === "currentRound") return 1n;
    if (functionName === "canClose") return false;
    throw new Error(functionName);
  },
  getBlock: async () => ({ timestamp: 200n }),
  waitForTransactionReceipt: async () => ({ status: "success" }),
};
const walletClient = {
  writeContract: async ({ functionName, args }: { functionName: string; args: [bigint] }) => {
    if (functionName === "admitAfterStandby") { sent.push(args[0]); entries[Number(args[0])]![0] = 2; }
    return "0x01";
  },
};
const op = createOperator({
  pool: "0x0000000000000000000000000000000000000001", chainId: 1, account: privateKeyToAccount(`0x${"44".repeat(32)}`),
  publicClient: publicClient as never, walletClient: walletClient as never, store: memoryRevealStore(),
});

test("admits due entries in seq order, skips flagged and not-yet-due ones", async () => {
  expect(await op.admitDue()).toBe(2);
  expect(sent).toEqual([0n, 3n]);
  expect(await op.admitDue()).toBe(0); // #2 is still in standby
});
