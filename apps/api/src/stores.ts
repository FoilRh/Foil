import { and, desc, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@foil/db";
import type { MachineQuote, RoomPost, TinSetSnapshot } from "@foil/protocol";

export interface NewPost { season: string; handle: string; handlePub: string; tokenId: string; tin: string }
export interface CardMeta { name: string | null; grade: string | null; image: string | null; insuredValue: string | null }
export interface Standing { handle: string; hits: number; insuredTotal: string }

/** Public, non-linking data the API reads or writes. Postgres in production. */
export interface Stores {
  getBackup(locator: string): Promise<string | null>;
  putBackup(locator: string, blob: string): Promise<void>;
  machines(): Promise<MachineQuote[]>;
  snapshot(): Promise<TinSetSnapshot | null>;
  /** A retained snapshot at exactly this block (snapshots are kept for a day). */
  snapshotAt(block: bigint): Promise<TinSetSnapshot | null>;
  /**
   * Rip Rooms. A season handle name is bound to the first key that uses it; addPost returns
   * "taken" if another key holds the name, null if this card was already posted this season.
   */
  addPost(p: NewPost, meta: CardMeta): Promise<RoomPost | null | "taken">;
  listPosts(season: string, limit: number): Promise<RoomPost[]>;
  leaderboard(season: string, limit: number): Promise<Standing[]>;
  cardMeta(tokenId: string): Promise<CardMeta>;
}

const toPost = (r: typeof schema.posts.$inferSelect): RoomPost => ({
  postId: r.postId, season: r.season, handle: r.handle, tokenId: r.tokenId, name: r.name, grade: r.grade,
  image: r.image, insuredValue: r.insuredValue, at: r.ts.toISOString(),
});

/** Postgres-backed Stores (production). */
export function pgStores(db: Db): Stores {
  return {
    async getBackup(locator) {
      const [row] = await db.select({ blob: schema.backups.blob }).from(schema.backups).where(eq(schema.backups.locator, locator));
      return row?.blob ?? null;
    },
    async putBackup(locator, blob) {
      await db.insert(schema.backups).values({ locator, blob, updatedAt: new Date() })
        .onConflictDoUpdate({ target: schema.backups.locator, set: { blob, updatedAt: new Date() } });
    },
    async machines() {
      const rows = await db.select().from(schema.machines);
      return rows.map((m) => ({
        machineId: m.machineId, chainId: 4663, mode: m.adopted ? "key" : "browser", name: m.name,
        category: m.category as MachineQuote["category"], priceMicros: m.price, expectedValueMicros: m.ev ?? "0",
        evLowMicros: m.evLow ?? "0", buybackBps: m.buybackBps ?? 0, partnerFeeBps: m.partnerFeeBps,
        odds: m.odds ? (JSON.parse(m.odds) as MachineQuote["odds"]) : [], adopted: m.adopted, available: m.available,
        quotedAt: m.quotedAt.toISOString(), expiresAt: new Date(m.quotedAt.getTime() + 10 * 60_000).toISOString(),
      }));
    },
    async snapshot() {
      const [row] = await db.select().from(schema.snapshots).orderBy(desc(schema.snapshots.block)).limit(1);
      return row ? (JSON.parse(row.body) as TinSetSnapshot) : null;
    },
    async snapshotAt(block) {
      const [row] = await db.select().from(schema.snapshots).where(eq(schema.snapshots.block, block));
      return row ? (JSON.parse(row.body) as TinSetSnapshot) : null;
    },
    async addPost(p, meta) {
      await db.insert(schema.handles).values({ season: p.season, handle: p.handle, handlePub: p.handlePub }).onConflictDoNothing();
      const [bound] = await db.select({ pub: schema.handles.handlePub }).from(schema.handles)
        .where(and(eq(schema.handles.season, p.season), eq(schema.handles.handle, p.handle)));
      if (bound?.pub !== p.handlePub) return "taken";
      const [row] = await db.insert(schema.posts)
        .values({ postId: crypto.randomUUID(), ...p, ...meta })
        .onConflictDoNothing()
        .returning();
      return row ? toPost(row) : null;
    },
    async listPosts(season, limit) {
      const rows = await db.select().from(schema.posts).where(eq(schema.posts.season, season)).orderBy(desc(schema.posts.ts)).limit(limit);
      return rows.map(toPost);
    },
    async leaderboard(season, limit) {
      // Grouped by key, not name: names are bound first-come, keys are the identity.
      const rows = await db.select({
        handle: sql<string>`min(${schema.posts.handle})`,
        hits: sql<number>`count(*)::int`,
        insuredTotal: sql<string>`coalesce(sum(${schema.posts.insuredValue}), 0)::text`,
      }).from(schema.posts).where(eq(schema.posts.season, season)).groupBy(schema.posts.handlePub)
        .orderBy(sql`coalesce(sum(${schema.posts.insuredValue}), 0) desc`).limit(limit);
      return rows;
    },
    async cardMeta(tokenId) {
      const [c] = await db.select().from(schema.cards).where(and(eq(schema.cards.tokenId, tokenId)));
      return { name: c?.name ?? null, grade: c?.grade ?? null, image: c?.image ?? null, insuredValue: c?.insuredValue ?? null };
    },
  };
}

/** In-memory Stores for tests, with setters to seed the snapshot and card metadata. */
export function memoryStores(): Stores & { setSnapshot(s: TinSetSnapshot): void; setCardMeta(id: string, m: CardMeta): void } {
  const backups = new Map<string, string>();
  const posts: (RoomPost & { tin: string; handlePub: string })[] = [];
  const bound = new Map<string, string>();
  const meta = new Map<string, CardMeta>();
  const snaps = new Map<string, TinSetSnapshot>();
  let snap: TinSetSnapshot | null = null;
  return {
    getBackup: async (l) => backups.get(l) ?? null,
    putBackup: async (l, b) => void backups.set(l, b),
    machines: async () => [],
    snapshot: async () => snap,
    snapshotAt: async (b) => snaps.get(b.toString()) ?? null,
    addPost: async (p, m) => {
      const k = `${p.season}|${p.handle}`;
      if (!bound.has(k)) bound.set(k, p.handlePub);
      if (bound.get(k) !== p.handlePub) return "taken";
      if (posts.some((x) => x.season === p.season && x.tokenId === p.tokenId)) return null;
      const post = { postId: crypto.randomUUID(), season: p.season, handle: p.handle, handlePub: p.handlePub, tokenId: p.tokenId, tin: p.tin, ...m, at: new Date().toISOString() };
      posts.push(post);
      const { tin: _tin, handlePub: _hp, ...pub } = post;
      return pub;
    },
    listPosts: async (season, limit) => posts.filter((p) => p.season === season).reverse().slice(0, limit).map(({ tin: _t, handlePub: _h, ...p }) => p),
    leaderboard: async (season, limit) => {
      const by = new Map<string, { handle: string; hits: number; total: bigint }>();
      for (const p of posts.filter((x) => x.season === season)) {
        const s = by.get(p.handlePub) ?? { handle: p.handle, hits: 0, total: 0n };
        by.set(p.handlePub, { handle: s.handle, hits: s.hits + 1, total: s.total + BigInt(p.insuredValue ?? "0") });
      }
      return [...by.values()].map((s) => ({ handle: s.handle, hits: s.hits, insuredTotal: s.total.toString() }))
        .sort((a, b) => (BigInt(b.insuredTotal) > BigInt(a.insuredTotal) ? 1 : -1)).slice(0, limit);
    },
    cardMeta: async (id) => meta.get(id) ?? { name: null, grade: null, image: null, insuredValue: null },
    setCardMeta: (id, m) => void meta.set(id, m),
    setSnapshot: (s) => {
      snap = s;
      snaps.set(s.block, s);
    },
  };
}
