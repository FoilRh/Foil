import { expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, padHex, type Abi, type Address, type Log } from "viem";
import { stashPoolAbi } from "@foil/protocol";
import { createIndexer } from "./indexer";
import { TinSet } from "./state";

const pool = "0x00000000000000000000000000000000000000a1" as Address;
const usdg = "0x00000000000000000000000000000000000000a2" as Address;
const cardNft = "0x00000000000000000000000000000000000000a3" as Address;
const vault = "0x00000000000000000000000000000000000000a4" as Address;
const tin = "0x00000000000000000000000000000000000000b1" as Address;
const transferAbi = [{ type: "event", name: "Transfer", inputs: [
  { name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256", indexed: false },
] }] as const;
const nftAbi = [{ type: "event", name: "Transfer", inputs: [
  { name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "tokenId", type: "uint256", indexed: true },
] }] as const;

let n = 0;
function log(address: Address, abi: Abi, eventName: string, args: Record<string, unknown>, block: bigint): Log {
  const item = getAbiItem({ abi, name: eventName }) as unknown as { inputs: { name: string; type: string; indexed?: boolean }[] };
  const data = item.inputs.filter((i) => !i.indexed);
  return {
    address, blockNumber: block, logIndex: n++, transactionHash: padHex("0x1", { size: 32 }),
    topics: encodeEventTopics({ abi, eventName, args } as never),
    data: encodeAbiParameters(data, data.map((i) => args[i.name])),
  } as unknown as Log;
}

test("a tin set resumed from a snapshot continues exactly like a full replay", () => {
  const before = [
    log(pool, stashPoolAbi, "TinFunded", { roundId: 1n, reqIdx: 0n, tin, size: 25_000_000n, how: 1 }, 10n),
    log(usdg, transferAbi, "Transfer", { from: pool, to: tin, value: 25_000_000n }, 10n),
    log(cardNft, nftAbi, "Transfer", { from: vault, to: tin, tokenId: 7n }, 11n),
  ];
  const after = [
    log(usdg, transferAbi, "Transfer", { from: tin, to: vault, value: 5_000_000n }, 12n),
    log(cardNft, nftAbi, "Transfer", { from: tin, to: vault, tokenId: 7n }, 13n),
  ];
  const full = new TinSet({ pool, usdg, cardNft });
  full.apply(before);
  const snap = JSON.parse(JSON.stringify(full.snapshot()));
  full.apply(after);

  const resumed = new TinSet({ pool, usdg, cardNft });
  resumed.load(snap, new Map([[tin.toLowerCase(), { sentBack: 0n, sendBacks: 0 }]]));
  resumed.apply(after);

  const at = new Date(0);
  expect(resumed.snapshot(at)).toEqual(full.snapshot(at));
  expect(resumed.snapshot(at).tins[0]).toMatchObject({ usdg: "20000000", cards: [] });
});

test("the indexer resumes only from a snapshot of its own pool", () => {
  const set = new TinSet({ pool, usdg, cardNft });
  set.apply([log(pool, stashPoolAbi, "TinFunded", { roundId: 1n, reqIdx: 0n, tin, size: 25_000_000n, how: 1 }, 10n)]);
  const snap = JSON.parse(JSON.stringify(set.snapshot()));
  const cfg = { pool, usdg, startBlock: 5n };
  const other = createIndexer({} as never, { ...cfg, pool: "0x00000000000000000000000000000000000000ff" as Address });
  other.resume(20n, snap, new Map());
  expect(other.nextBlock).toBe(5n); // a redeployed pool starts over from its own start block
  const same = createIndexer({} as never, cfg);
  same.resume(20n, snap, new Map());
  expect(same.nextBlock).toBe(21n);
  expect(same.set.tins.size).toBe(1);
});
