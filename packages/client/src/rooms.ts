/** Rip Rooms on the client (Build §7): season handles and dual-signed posts. */
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { handleName, postMessage, seasonOf } from "@foil/protocol";
import type { Keys } from "./keys";

/** This season's handle: seed-derived ed25519 key, its public name, and a signer. Unlinkable across seasons. */
export function seasonHandle(keys: Keys, season = seasonOf()) {
  const sk = keys.handleKey(season);
  const pub = bytesToHex(ed25519.getPublicKey(sk));
  return { season, pub, name: handleName(pub), sign: (msg: string) => bytesToHex(ed25519.sign(new TextEncoder().encode(msg), sk)) };
}

/** Both signatures for posting `tokenId` held by the tin with this key. */
export async function signPost(keys: Keys, tinKey: Hex, tokenId: bigint, season = seasonOf()) {
  const h = seasonHandle(keys, season);
  const tin = privateKeyToAccount(tinKey);
  const msg = postMessage(season, h.name, tokenId.toString(), tin.address);
  return {
    season, handle: h.name, handlePub: h.pub, tokenId: tokenId.toString(), tin: tin.address,
    sigTin: await tin.signMessage({ message: msg }), sigHandle: h.sign(msg),
  };
}
