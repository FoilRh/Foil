/**
 * Rip Rooms (Build §7) through the full OHTTP stack:
 *   a post needs the tin's signature, the season handle's signature, and the tin must
 *   hold (or have minted) the card; handles differ by season; posts are per card per
 *   season; the leaderboard ranks handles by insured value of posted hits.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createWalletClient, http, keccak256, toHex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { seasonOf } from "@foil/protocol";
import { keysFromMnemonic, loadCrypto, seasonHandle, signPost, type Keys } from "@foil/client";
import { ANVIL_KEYS, hasFoundry } from "../scripts/devchain";
import { startStack } from "./harness";

describe.skipIf(!hasFoundry())("Rip Rooms", () => {
  let s: Awaited<ReturnType<typeof startStack>>;
  let keys: Keys;
  let other: Keys;
  const tinKey = keccak256(toHex("rooms-tin"));
  const tin = privateKeyToAccount(tinKey);

  const mint = async (to: Address, id: bigint) => {
    const w = createWalletClient({ transport: http(s.chain.rpc), account: privateKeyToAccount(ANVIL_KEYS[0]!) });
    await s.publicClient.waitForTransactionReceipt({
      hash: await w.writeContract({ address: s.cards!.address, abi: s.cards!.abi as never, functionName: "mint", args: [to, id], chain: null } as never),
    });
  };

  beforeAll(async () => {
    s = await startStack({ port: 8616, mockVerifiers: true, cards: true });
    const c = await loadCrypto();
    keys = keysFromMnemonic(c, "test test test test test test test test test test test junk");
    other = keysFromMnemonic(c, "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
    await mint(tin.address, 7n);
    await mint(tin.address, 8n);
    s.stores.setCardMeta("7", { name: "Rayquaza VMAX", grade: "PSA 10", image: null, insuredValue: "420000000" });
    s.stores.setCardMeta("8", { name: "Kaido & Linlin", grade: "PSA 9", image: null, insuredValue: "90000000" });
  }, 120_000);
  afterAll(() => s?.chain.stop());

  test("season handles are deterministic per season and unlinkable across seasons", () => {
    expect(seasonHandle(keys, "2026-Q4").name).toBe(seasonHandle(keys, "2026-Q4").name);
    expect(seasonHandle(keys, "2026-Q4").pub).not.toBe(seasonHandle(keys, "2027-Q1").pub);
    expect(seasonHandle(keys).season).toBe(seasonOf());
  });

  test("a valid hit is published; the post shows the card, not the tin", async () => {
    const post = await s.api.rooms.post.mutate(await signPost(keys, tinKey, 7n));
    expect(post.handle).toBe(seasonHandle(keys).name);
    expect(post.name).toBe("Rayquaza VMAX");
    expect(JSON.stringify(post)).not.toContain(tin.address.slice(2).toLowerCase());
    await expect(s.api.rooms.post.mutate(await signPost(keys, tinKey, 7n))).rejects.toThrow(/already posted/);
  });

  test("rejects a forged tin signature, a forged handle, and a card the tin never held", async () => {
    const good = await signPost(keys, tinKey, 8n);
    const forgedTin = await signPost(keys, keccak256(toHex("someone-else")), 8n);
    await expect(s.api.rooms.post.mutate({ ...good, sigTin: forgedTin.sigTin })).rejects.toThrow(/tin signature/);
    const otherHandle = seasonHandle(other);
    await expect(s.api.rooms.post.mutate({ ...good, handle: otherHandle.name, handlePub: otherHandle.pub })).rejects.toThrow();
    await expect(s.api.rooms.post.mutate({ ...good, sigHandle: otherHandle.sign("x") as `0x${string}` })).rejects.toThrow(/handle signature/);
    await expect(s.api.rooms.post.mutate(await signPost(keys, tinKey, 999n))).rejects.toThrow(/does not hold/);
    await expect(s.api.rooms.post.mutate({ ...good, season: "2020-Q1" })).rejects.toThrow(/current season/);
  });

  test("a ground key with the same handle name cannot post under it (first-come binding)", async () => {
    const victim = seasonHandle(keys);
    const { ed25519 } = await import("@noble/curves/ed25519.js");
    const { bytesToHex } = await import("viem");
    const { handleName, postMessage } = await import("@foil/protocol");
    // Grind keys until one maps to the victim's handle name (names are short by design).
    let sk: Uint8Array | undefined;
    for (let i = 0; i < 2_000_000 && !sk; i++) {
      const cand = ed25519.utils.randomSecretKey();
      if (handleName(bytesToHex(ed25519.getPublicKey(cand))) === victim.name) sk = cand;
    }
    expect(sk).toBeDefined(); // ~1 in 2,500 runs could miss within the budget
    if (!sk) return;
    const pub = bytesToHex(ed25519.getPublicKey(sk));
    const tinKey3 = keccak256(toHex("rooms-tin-3"));
    const tin3 = privateKeyToAccount(tinKey3);
    await mint(tin3.address, 10n);
    const msg = postMessage(seasonOf(), victim.name, "10", tin3.address);
    await expect(s.api.rooms.post.mutate({
      season: seasonOf(), handle: victim.name, handlePub: pub, tokenId: "10", tin: tin3.address,
      sigTin: await tin3.signMessage({ message: msg }), sigHandle: bytesToHex(ed25519.sign(new TextEncoder().encode(msg), sk)),
    })).rejects.toThrow(/belongs to another key/);
  }, 120_000);

  test("feed and leaderboard rank handles by insured value of posted hits", async () => {
    // Another collector posts a smaller hit from their own tin.
    const tin2Key = keccak256(toHex("rooms-tin-2"));
    await mint(privateKeyToAccount(tin2Key).address, 9n);
    s.stores.setCardMeta("9", { name: "Luffy", grade: "PSA 8", image: null, insuredValue: "15000000" });
    await s.api.rooms.post.mutate(await signPost(other, tin2Key, 9n));
    await s.api.rooms.post.mutate(await signPost(keys, tinKey, 8n));

    const feed = await s.api.rooms.list.query({});
    expect(feed.map((p) => p.tokenId)).toEqual(["8", "9", "7"]);
    const board = await s.api.rooms.leaderboard.query({});
    expect(board[0]).toEqual({ handle: seasonHandle(keys).name, hits: 2, insuredTotal: "510000000" });
    expect(board[1]!.handle).toBe(seasonHandle(other).name);
  });
});
