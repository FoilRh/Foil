/**
 * Public tin-set snapshot and its diffs (Build §2: "the public tin-set snapshot … and
 * hourly diffs"). Diffs only add or update tins; tins never disappear from the set.
 */
export interface SnapshotTin { tin: string; roundId: string; funded: string; usdg: string; cards: string[] }
export interface TinSetSnapshot { block: string; asOf: string; tins: SnapshotTin[] }
export type SnapshotDiff =
  | { kind: "full"; snapshot: TinSetSnapshot }
  | { kind: "diff"; base: string; block: string; asOf: string; changed: SnapshotTin[] };

const key = (t: SnapshotTin) => JSON.stringify([t.roundId, t.funded, t.usdg, t.cards]);

/** Server side: what changed between `base` and `latest`. */
export function diffSnapshots(base: TinSetSnapshot | null, latest: TinSetSnapshot): SnapshotDiff {
  if (!base) return { kind: "full", snapshot: latest };
  const old = new Map(base.tins.map((t) => [t.tin.toLowerCase(), key(t)]));
  const changed = latest.tins.filter((t) => old.get(t.tin.toLowerCase()) !== key(t));
  return { kind: "diff", base: base.block, block: latest.block, asOf: latest.asOf, changed };
}

/** Client side: rebuild the full snapshot from the previous one plus a diff. */
export function applySnapshotDiff(prev: TinSetSnapshot | null, d: SnapshotDiff): TinSetSnapshot {
  if (d.kind === "full") return d.snapshot;
  if (!prev || prev.block !== d.base) throw new Error("snapshot diff does not apply to this base");
  const byTin = new Map(prev.tins.map((t) => [t.tin.toLowerCase(), t]));
  for (const t of d.changed) byTin.set(t.tin.toLowerCase(), t);
  const tins = [...byTin.values()].sort((a, b) => (a.tin.toLowerCase() < b.tin.toLowerCase() ? -1 : 1));
  return { block: d.block, asOf: d.asOf, tins };
}
