/**
 * tRPC v11 router. Reached only through the OHTTP gateway, so no procedure ever sees
 * a client IP. Amounts are base-unit strings. There are no accounts and no per-user
 * state: every procedure is either public chain data or a pass-through to a service.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  hexToBytes, isAddress, isHex, parseAbiItem, parseTransaction, recoverMessageAddress, recoverTransactionAddress,
  type Address, type PublicClient, type TransactionSerialized,
} from "viem";
import { checkTransaction, tokenIdsIn } from "@foil/guard";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  diffSnapshots, handleName, postMessage, seasonOf, stashPoolAbi, usdgAbi, type ProtocolHealth, type RoundSnapshot,
} from "@foil/protocol";
import type { Stores } from "./stores";

export interface Ctx {
  chain: PublicClient;
  pool: Address;
  usdg: Address;
  gate: Address;
  chainId: number;
  /** Block the pool was deployed in: clients sync events from here. */
  startBlock: bigint;
  /** POSTs JSON to an internal service (relayer / round-operator) with the shared token. */
  internal(service: "relayer" | "operator", path: string, body: unknown): Promise<unknown>;
  relayer: { address: Address; feeFloor: string };
  stores: Stores;
  /** Collector Crypt card NFT (pinned). Rip Rooms posts are off when unset. */
  cardNft?: Address;
  /** Collector Crypt gacha vault (pinned). Browser-mode broadcasts are off when unset. */
  vault?: Address;
  /** CC shipping fee payees (signed allowlist). */
  shippingPayees?: Address[];
  /** Signatures from the ppoi-nodes that judge this entry clean (each node screens independently). */
  attest(seq: bigint): Promise<string[]>;
}

/** Backup blobs: 32-byte seed-derived locator; opaque ciphertext, capped in size. */
const Locator = z.string().regex(/^0x[0-9a-f]{64}$/);
const MAX_BACKUP_CHARS = 128 * 1024;

const t = initTRPC.context<Ctx>().create({
  // Only deliberate errors reach clients: TRPCErrors, and errors marked `expose` (the relayer's own
  // reasons). Anything else (a viem error quotes the RPC URL and its key) becomes a fixed message.
  // Stacks never leave.
  errorFormatter: ({ shape, error }) => {
    const { stack: _, ...data } = shape.data;
    const hide = error.code === "INTERNAL_SERVER_ERROR" && (error.cause as { expose?: unknown } | undefined)?.expose !== true;
    return { ...shape, data, message: hide ? "internal error" : shape.message };
  },
});

/** JSON-RPC methods the client may proxy (through OHTTP) to the chain. */
const RPC_METHODS = new Set([
  "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_call", "eth_getLogs", "eth_getTransactionReceipt", "eth_gasPrice",
  // What a tin needs to send its own transactions in browser mode (Build §5A):
  "eth_getBalance", "eth_getTransactionCount", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_feeHistory",
  "eth_getTransactionByHash", "eth_getCode",
]);

export const appRouter = t.router({
  config: t.procedure.query(async ({ ctx }) => {
    const poolId = (await ctx.chain.readContract({ address: ctx.pool, abi: stashPoolAbi, functionName: "POOL_ID" })) as bigint;
    return {
      chainId: ctx.chainId, pool: ctx.pool, usdg: ctx.usdg, gate: ctx.gate, poolId: poolId.toString(),
      startBlock: ctx.startBlock.toString(),
      relayer: ctx.relayer.address, relayerFeeFloor: ctx.relayer.feeFloor,
      /** Pinned CC contracts for browser mode (null until configured). */
      cc: ctx.vault && ctx.cardNft ? { vault: ctx.vault, cards: ctx.cardNft, shippingPayees: ctx.shippingPayees ?? [] } : null,
    };
  }),

  status: t.procedure.query(async ({ ctx }) => {
    const read = <T>(functionName: string, args: unknown[] = []) =>
      ctx.chain.readContract({ address: ctx.pool, abi: stashPoolAbi, functionName, args } as never) as Promise<T>;
    const [depositsPaused, requestsPaused, totalIn, totalOut, balance, current, gasFee, ethPerTin, block] = await Promise.all([
      read<boolean>("depositsPaused"), read<boolean>("requestsPaused"), read<bigint>("totalIn"), read<bigint>("totalOut"),
      ctx.chain.readContract({ address: ctx.usdg, abi: usdgAbi, functionName: "balanceOf", args: [ctx.pool] }) as Promise<bigint>,
      read<bigint>("currentRound"), read<bigint>("gasFeeUsdg"), read<bigint>("ethPerTin"), ctx.chain.getBlock(),
    ]);
    const [openedAt, , , count] = await read<readonly [bigint, bigint, bigint, number]>("rounds", [current]);
    const canClose = await read<boolean>("canClose", [current]);
    const health: ProtocolHealth = {
      chainId: ctx.chainId as ProtocolHealth["chainId"], depositsPaused, newRequestsPaused: requestsPaused,
      conservation: balance >= totalIn - totalOut ? "verified" : "mismatch", asOf: new Date(Number(block.timestamp) * 1000).toISOString(),
    };
    // The open round closes at the next boundary with ≥ 8 requests, else 30 min after its first request.
    const closesAt = count === 0 ? null : new Date(Number(openedAt + 1800n) * 1000).toISOString();
    const round: RoundSnapshot = {
      roundId: current.toString(), requestCount: Number(count), closesAt: closesAt ?? "", state: canClose ? "Closed" : "Open",
      receiptAvailable: false, canCancel: true, canSelfExecute: false,
    };
    return { health, round, quotes: { gasFeeUsdg: gasFee.toString(), ethPerTin: ethPerTin.toString() } };
  }),

  rpc: t.procedure
    .input(z.object({ method: z.string(), params: z.array(z.unknown()).default([]) }))
    .mutation(async ({ ctx, input }) => {
      if (!RPC_METHODS.has(input.method)) throw new TRPCError({ code: "FORBIDDEN", message: `${input.method} not allowed` });
      const target = (input.params[0] ?? {}) as { to?: string; address?: string };
      const allowed = [ctx.pool, ctx.usdg, ctx.gate, ctx.vault, ctx.cardNft].filter(Boolean).map((a) => a!.toLowerCase());
      if ((input.method === "eth_call" || input.method === "eth_estimateGas") && !allowed.includes(String(target.to).toLowerCase())) {
        throw new TRPCError({ code: "FORBIDDEN", message: "eth_call target not allowed" });
      }
      // ponytail: getLogs is pool-wide (everyone downloads everything); the M8 snapshot replaces it at scale.
      const logSources = [ctx.pool, ctx.cardNft].filter(Boolean).map((a) => a!.toLowerCase());
      if (input.method === "eth_getLogs" && !logSources.includes(String(target.address).toLowerCase())) {
        throw new TRPCError({ code: "FORBIDDEN", message: "logs only for the pool" });
      }
      if (input.method === "eth_getBlockByNumber" && input.params[1] !== false) {
        throw new TRPCError({ code: "FORBIDDEN", message: "no full blocks" });
      }
      return ctx.chain.request({ method: input.method, params: input.params } as never);
    }),

  relay: t.procedure
    .input(z.object({ fn: z.string(), args: z.array(z.unknown()) }))
    .mutation(({ ctx, input }) => ctx.internal("relayer", "/relay", input)),

  backup: t.router({
    get: t.procedure.input(z.object({ locator: Locator })).mutation(({ ctx, input }) => ctx.stores.getBackup(input.locator)),
    put: t.procedure
      .input(z.object({ locator: Locator, blob: z.string().max(MAX_BACKUP_CHARS).regex(/^[A-Za-z0-9+/=]+$/) }))
      .mutation(async ({ ctx, input }) => {
        await ctx.stores.putBackup(input.locator, input.blob);
        return { ok: true };
      }),
  }),

  /** Machine disclosures (Build §5.3): price, EV, evLow, odds, buyback, fee. Empty until a source is live. */
  machines: t.procedure.query(({ ctx }) => ctx.stores.machines()),

  /** Latest public tin-set snapshot; clients match their own tins locally. */
  snapshot: t.procedure.query(({ ctx }) => ctx.stores.snapshot()),

  /** Only the tins changed since the client's snapshot block (full set if that base aged out). */
  snapshotDiff: t.procedure.input(z.object({ since: z.string().regex(/^\d+$/) })).query(async ({ ctx, input }) => {
    const latest = await ctx.stores.snapshot();
    if (!latest) return null;
    return diffSnapshots(await ctx.stores.snapshotAt(BigInt(input.since)), latest);
  }),

  attest: t.procedure
    .input(z.object({ seq: z.string().regex(/^\d+$/) }))
    .mutation(({ ctx, input }) => ctx.attest(BigInt(input.seq))),

  rooms: t.router({
    /**
     * Publish a hit (Build §7): signed by the tin (EIP-191) AND the season handle (ed25519),
     * and the tin must hold or have minted the card on-chain. Stores the post only.
     */
    post: t.procedure
      .input(z.object({
        season: z.string().regex(/^\d{4}-Q[1-4]$/), handle: z.string().max(40), handlePub: z.string().regex(/^0x[0-9a-f]{64}$/),
        tokenId: z.string().regex(/^\d{1,78}$/), tin: z.string().refine(isAddress),
        sigTin: z.string().refine(isHex), sigHandle: z.string().regex(/^0x[0-9a-f]{128}$/),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.cardNft) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "rooms are not open yet" });
        if (input.season !== seasonOf()) throw new TRPCError({ code: "BAD_REQUEST", message: "posts go to the current season" });
        if (input.handle !== handleName(input.handlePub)) throw new TRPCError({ code: "BAD_REQUEST", message: "handle does not match its key" });
        const msg = postMessage(input.season, input.handle, input.tokenId, input.tin);
        const signer = await recoverMessageAddress({ message: msg, signature: input.sigTin as `0x${string}` });
        if (signer.toLowerCase() !== input.tin.toLowerCase()) throw new TRPCError({ code: "UNAUTHORIZED", message: "tin signature invalid" });
        if (!ed25519.verify(hexToBytes(input.sigHandle as `0x${string}`), new TextEncoder().encode(msg), hexToBytes(input.handlePub as `0x${string}`))) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "handle signature invalid" });
        }
        if (!(await holdsOrMinted(ctx.chain, ctx.cardNft, input.tin as Address, BigInt(input.tokenId)))) {
          throw new TRPCError({ code: "FORBIDDEN", message: "this tin does not hold that card" });
        }
        const post = await ctx.stores.addPost(
          { season: input.season, handle: input.handle, handlePub: input.handlePub, tokenId: input.tokenId, tin: input.tin },
          await ctx.stores.cardMeta(input.tokenId),
        );
        if (post === "taken") throw new TRPCError({ code: "CONFLICT", message: "that handle belongs to another key this season" });
        if (!post) throw new TRPCError({ code: "CONFLICT", message: "this hit is already posted this season" });
        return post;
      }),
    list: t.procedure
      .input(z.object({ season: z.string().optional(), limit: z.number().int().min(1).max(100).default(50) }))
      .query(({ ctx, input }) => ctx.stores.listPosts(input.season ?? seasonOf(), input.limit)),
    leaderboard: t.procedure
      .input(z.object({ season: z.string().optional(), limit: z.number().int().min(1).max(100).default(25) }))
      .query(({ ctx, input }) => ctx.stores.leaderboard(input.season ?? seasonOf(), input.limit)),
  }),

  /**
   * Browser mode (Build §5A): a tin's own signed transaction to a pinned CC contract or USDG.
   * The guard runs again here, against on-chain holdings, so the API never relays anything
   * outside the allowlist even if a client is compromised. The sender's IP never reaches
   * the chain's RPC: requests arrive through OHTTP.
   */
  broadcast: t.procedure
    .input(z.object({ raw: z.string().regex(/^0x[0-9a-fA-F]+$/).max(20_000) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.vault || !ctx.cardNft) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "browser mode is not open yet" });
      const raw = input.raw as TransactionSerialized;
      let tx;
      try { tx = parseTransaction(raw); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "not a signed transaction" }); }
      if (tx.chainId !== ctx.chainId) throw new TRPCError({ code: "FORBIDDEN", message: "wrong network" });
      const from = await recoverTransactionAddress({ serializedTransaction: raw });
      const ids = tokenIdsIn({ to: tx.to ?? undefined, data: tx.data }, { vault: ctx.vault, cards: ctx.cardNft });
      const owners = await Promise.all(ids.map((id) => ctx.chain.readContract({
        address: ctx.cardNft!, abi: [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "address" }] }],
        functionName: "ownerOf", args: [id],
      }).catch(() => null)));
      const usdgBalance = (await ctx.chain.readContract({ address: ctx.usdg, abi: usdgAbi, functionName: "balanceOf", args: [from] })) as bigint;
      const verdict = checkTransaction(
        { from, to: tx.to ?? undefined, value: tx.value ?? 0n, data: tx.data, chainId: tx.chainId },
        {
          chainId: ctx.chainId, tin: from, usdg: ctx.usdg, vault: ctx.vault, cards: ctx.cardNft, shippingPayees: ctx.shippingPayees ?? [],
          domains: [], usdgBalance, cards_: ids.filter((_, i) => owners[i]?.toLowerCase() === from.toLowerCase()),
        },
      );
      if (!verdict.allow) throw new TRPCError({ code: "FORBIDDEN", message: verdict.reason });
      const hash = (await ctx.chain.request({ method: "eth_sendRawTransaction", params: [raw] } as never)) as string;
      return { hash, summary: verdict.summary };
    }),

  reveal: t.procedure
    .input(z.object({ roundId: z.string().regex(/^\d+$/), tin: z.string().refine(isAddress), salt: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }))
    .mutation(({ ctx, input }) => ctx.internal("operator", "/reveal", input)),
});

export type AppRouter = typeof appRouter;

const erc721Transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
const ownerOfAbi = [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "address" }] }] as const;

/** "T holds (or minted) tokenId" (Build §7). */
async function holdsOrMinted(chain: PublicClient, nft: Address, tin: Address, tokenId: bigint) {
  const owner = await chain.readContract({ address: nft, abi: ownerOfAbi, functionName: "ownerOf", args: [tokenId] }).catch(() => null);
  if (owner && owner.toLowerCase() === tin.toLowerCase()) return true;
  const minted = await chain.getLogs({
    address: nft, event: erc721Transfer, fromBlock: 0n,
    args: { from: "0x0000000000000000000000000000000000000000", to: tin, tokenId },
  });
  return minted.length > 0;
}
