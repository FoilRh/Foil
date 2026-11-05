// Rip Rooms on Solana: a pull is a Collector Crypt card delivered to an account the tin funded.
import { expect, test } from "bun:test";
import { CC_COLLECTION, CORE_PROGRAM, cardMetaFrom, parseCoreAsset, solanaCards } from "./solana-cards";

const ACCOUNT = "EYz4UX5fPmQ8MjzjfDw1yrYvmKT5aksQftKWoP6idALF";
const ASSET = "HVeJ7A7fwseBG7uhKNUmhWYHm381sGC7UhaUo4JXJUMH";
const FAKE = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const decode58 = (s: string) => {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { out[i] = Number(n & 255n); n >>= 8n; }
  return out;
};
/** A Core AssetV1 account: key, owner, update authority (collection), name, uri. */
function assetData(owner: string, name: string, uri: string) {
  const enc = new TextEncoder();
  const n = enc.encode(name), u = enc.encode(uri);
  const b = new Uint8Array(1 + 32 + 33 + 4 + n.length + 4 + u.length);
  const v = new DataView(b.buffer);
  b[0] = 1; b.set(decode58(owner), 1); b[33] = 2; b.set(decode58(CC_COLLECTION), 34);
  let o = 66; v.setUint32(o, n.length, true); b.set(n, o + 4); o += 4 + n.length;
  v.setUint32(o, u.length, true); b.set(u, o + 4);
  return btoa(String.fromCharCode(...b));
}
const META = { name: "2025 #065 Ivysaur PSA 9 Japanese", image: "https://nft.collectorcrypt.com/front/1", attributes: [{ trait_type: "Insured Value", value: "22" }, { trait_type: "The Grade", value: "MINT 9" }] };

test("parseCoreAsset reads owner, name and uri", () => {
  const a = parseCoreAsset(Uint8Array.from(atob(assetData(ACCOUNT, "Ivysaur", "https://arweave.net/x")), (c) => c.charCodeAt(0)));
  expect(a).toEqual({ owner: ACCOUNT, name: "Ivysaur", uri: "https://arweave.net/x" });
});

test("card metadata: insured value in USDG base units, grade, https images only", () => {
  expect(cardMetaFrom("x", META)).toEqual({ name: META.name, grade: "MINT 9", image: META.image, insuredValue: "22000000" });
  expect(cardMetaFrom("x", { ...META, image: "http://tracker.example/p.gif" }).image).toBeNull();
});

test("pulls: genuine Collector Crypt deliveries to funded accounts only, held or sold back", async () => {
  // Three Core transfers to the account: a real CC card, a lookalike from another collection, and one to someone else.
  const tx = (asset: string, collection: string, newOwner: string) => ({
    transaction: { message: { accountKeys: [asset, collection, "payer", "auth", newOwner, CORE_PROGRAM], instructions: [{ programIdIndex: 5, accounts: [0, 1, 2, 3, 4, 5] }] } },
    meta: {},
  });
  const txs: Record<string, unknown> = { s1: tx(ASSET, CC_COLLECTION, ACCOUNT), s2: tx(FAKE, FAKE, ACCOUNT), s3: tx(FAKE, CC_COLLECTION, FAKE) };
  let owner = "Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu"; // bought back
  const sc = solanaCards({
    relay: async () => ({ requests: [
      { status: "success", recipient: ACCOUNT, data: { outTxs: [{ chainId: 792703809 }] } },
      { status: "failure", recipient: FAKE, data: { outTxs: [{ chainId: 792703809 }] } },
    ] }),
    rpc: async (method, params) => {
      if (method === "getSignaturesForAddress") return params[0] === ACCOUNT ? Object.keys(txs).map((signature) => ({ signature, err: null })) : [];
      if (method === "getTransaction") return txs[params[0] as string];
      if (method === "getAccountInfo") return { value: { owner: CORE_PROGRAM, data: [assetData(owner, "Ivysaur", "https://arweave.net/x")] } };
      throw new Error(method);
    },
    fetchJson: async () => META,
  });
  expect(await sc.pulls("0x914d972f0ff23340bc998f3fa03b07f5660d33ed")).toEqual([{ id: `sol:${ASSET}`, held: false, meta: cardMetaFrom("x", META) }]);
  owner = ACCOUNT;
  expect((await sc.pulls("0x914d972f0ff23340bc998f3fa03b07f5660d33ed"))[0]!.held).toBe(true);
});
