/**
 * Build §11: public data only. No table may link two tins, a tin to a note, or a
 * tin to an IP (Rip Rooms posts excepted, by design). schema.test.ts enforces it.
 * Naming rule the test relies on: a tin address column is called `tin`.
 * USDG amounts are numeric(78,0) base units.
 */
import { bigint, boolean, index, integer, numeric, pgTable, primaryKey, smallint, text, timestamp } from "drizzle-orm/pg-core";

const usdg = (name: string) => numeric(name, { precision: 78, scale: 0 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Public chain events from StashPool (indexer). */
export const poolEvents = pgTable("pool_events", {
  tx: text("tx").notNull(),
  logIndex: integer("log_index").notNull(),
  block: bigint("block", { mode: "bigint" }).notNull(),
  kind: text("kind").notNull(), // deposit | admitted | flagged | refunded | withdraw | request | executed | cancelled | self_executed | send_back
  size: usdg("size"),
  ts: ts("ts").notNull(),
}, (t) => [primaryKey({ columns: [t.tx, t.logIndex] }), index().on(t.kind, t.ts)]);

export const rounds = pgTable("rounds", {
  roundId: bigint("round_id", { mode: "bigint" }).primaryKey(),
  openedAt: ts("opened_at").notNull(),
  closedAt: ts("closed_at"),
  executedAt: ts("executed_at"),
  nRequests: integer("n_requests").notNull().default(0),
  nTins: integer("n_tins"),
  operator: text("operator"),
  state: text("state").notNull().default("Open"), // Open | Closed | Executed | Delayed
});

/** Per-request settlement state, as emitted on-chain. No commitments stored. */
export const roundRequests = pgTable("round_requests", {
  roundId: bigint("round_id", { mode: "bigint" }).notNull(),
  reqIdx: integer("req_idx").notNull(),
  state: text("state").notNull().default("Pending"), // Pending | Executed | SelfExecuted | Cancelled
}, (t) => [primaryKey({ columns: [t.roundId, t.reqIdx] })]);

/**
 * Operator-private: (tin, salt) reveals received over OHTTP, held only until the
 * round executes, then deleted. Never exposed by the API.
 */
export const pendingReveals = pgTable("pending_reveals", {
  roundId: bigint("round_id", { mode: "bigint" }).notNull(),
  tin: text("tin").notNull(),
  salt: text("salt").notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.roundId, t.tin, t.salt] })]); // one tin may open two requests

export const tinsPub = pgTable("tins_pub", {
  tin: text("tin").primaryKey(),
  roundId: bigint("round_id", { mode: "bigint" }).notNull(),
  funded: usdg("funded").notNull(),
  sentBack: usdg("sent_back").notNull().default("0"),
  sendBacks: smallint("send_backs").notNull().default(0),
});

export const machines = pgTable("machines", {
  machineId: text("machine_id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  price: usdg("price").notNull(),
  ev: usdg("ev"),
  evLow: usdg("ev_low"),
  buybackBps: integer("buyback_bps"),
  partnerFeeBps: integer("partner_fee_bps").notNull().default(0),
  adopted: boolean("adopted").notNull().default(false),
  available: boolean("available").notNull().default(true),
  odds: text("odds"), // JSON [{label, probabilityBps}]
  quotedAt: ts("quoted_at").notNull(),
});

export const ripsAgg = pgTable("rips_agg", {
  day: text("day").notNull(),
  machineId: text("machine_id").notNull(),
  count: integer("count").notNull().default(0),
  grossUsd: usdg("gross_usd").notNull().default("0"),
  soldBackUsd: usdg("sold_back_usd").notNull().default("0"),
}, (t) => [primaryKey({ columns: [t.day, t.machineId] })]);

/** CC card NFTs: metadata and insured value; `tin` is the current holder (public chain state). */
export const cards = pgTable("cards", {
  tokenId: text("token_id").primaryKey(),
  tin: text("tin"),
  name: text("name"),
  grade: text("grade"),
  image: text("image"),
  insuredValue: usdg("insured_value"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const status = pgTable("status", {
  ts: ts("ts").notNull().defaultNow(),
  component: text("component").notNull(),
  ok: boolean("ok").notNull(),
  detail: text("detail"),
}, (t) => [index().on(t.component, t.ts)]);

/** Indexer progress per source contract. */
export const cursors = pgTable("cursors", {
  source: text("source").primaryKey(),
  block: bigint("block", { mode: "bigint" }).notNull(),
});

/**
 * Encrypted wallet backups (Build §9): limits, cool-off and tin records survive a
 * restore. `locator` is derived from the seed and links to nothing else; the blob is
 * AES-GCM under a seed-derived key. Foil cannot read either.
 */
export const backups = pgTable("backups", {
  locator: text("locator").primaryKey(),
  blob: text("blob").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * Public tin-set snapshots (Build §2 discovery): every tin ever funded with its USDG
 * balance and card token IDs, as one JSON document per indexer pass. Clients download
 * the whole set (through OHTTP) and match their own tins locally; there is no
 * per-address query.
 */
export const snapshots = pgTable("snapshots", {
  block: bigint("block", { mode: "bigint" }).primaryKey(),
  createdAt: ts("created_at").notNull().defaultNow(),
  body: text("body").notNull(),
});

/**
 * Rip Rooms posts (Build §7): public by the user's choice, per pull. The ONE table allowed
 * to link a tin to something (its season handle); several posts by a handle link those
 * tins to each other, which the UI warns about. Nothing else is stored: no IPs, no
 * unposted tins.
 */
export const posts = pgTable("posts", {
  postId: text("post_id").primaryKey(),
  season: text("season").notNull(),
  handle: text("handle").notNull(),
  handlePub: text("handle_pub").notNull(),
  tokenId: text("token_id").notNull(),
  tin: text("tin").notNull(),
  name: text("name"),
  grade: text("grade"),
  image: text("image"),
  insuredValue: usdg("insured_value"),
  ts: ts("ts").notNull().defaultNow(),
}, (t) => [index().on(t.season, t.ts), index().on(t.season, t.tokenId)]);

/** First-come binding of a season handle name to its ed25519 key (names are short and grindable). */
export const handles = pgTable("handles", {
  season: text("season").notNull(),
  handle: text("handle").notNull(),
  handlePub: text("handle_pub").notNull(),
}, (t) => [primaryKey({ columns: [t.season, t.handle] })]);
