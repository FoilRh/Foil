/**
 * Rip Rooms (Build §7). Seasons are calendar quarters (UTC); a season handle is a name
 * derived from that season's ed25519 public key, so handles never carry across seasons.
 * Copy uses "Hits", "Room", "Season" (copy lint blocks the rest).
 */
export const seasonOf = (d: Date = new Date()) => `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;

const ADJ = ["quiet", "amber", "lunar", "velvet", "silver", "mossy", "golden", "misty", "cobalt", "sunny", "hidden", "brisk", "gentle", "lucky", "polar", "rusty"];
const NOUN = ["otter", "heron", "lynx", "comet", "maple", "falcon", "pebble", "fern", "sparrow", "badger", "willow", "koi", "puffin", "ember", "marten", "orca"];

/** Deterministic handle name from a 32-byte public key (hex). */
export function handleName(pubHex: string): string {
  const h = pubHex.replace(/^0x/, "");
  const a = parseInt(h.slice(0, 2), 16) % ADJ.length;
  const n = parseInt(h.slice(2, 4), 16) % NOUN.length;
  const num = parseInt(h.slice(4, 8), 16) % 1000;
  return `${ADJ[a]}-${NOUN[n]}-${num.toString().padStart(3, "0")}`;
}

/** What both the tin (EIP-191) and the season handle (ed25519) sign to publish a hit. */
export const postMessage = (season: string, handle: string, tokenId: string, tin: string) =>
  `foil-post|${season}|${handle}|${tokenId}|${tin.toLowerCase()}`;

export interface RoomPost {
  postId: string;
  season: string;
  handle: string;
  tokenId: string;
  name: string | null;
  grade: string | null;
  image: string | null;
  insuredValue: string | null;
  at: string;
}
