"use client";
import { useEffect, useState } from "react";
import { seasonHandle, type TinRec } from "@foil/client";
import type { RoomPost } from "@foil/protocol";
import { livePostHit, useLive } from "@/lib/foil-live";
import { logActivity, money } from "@/lib/foil-workspace";
import { Action, Badge, Empty, Panel } from "./dashboard-ui";

type Standing = { handle: string; hits: number; insuredTotal: string };

/** Rip Room (Build §7): opt-in, per-hit posts under a per-season handle. */
export function LiveRoom({ notify }: { notify: (text: string) => void }) {
  const live = useLive();
  const w = live.wallet;
  const [feed, setFeed] = useState<RoomPost[]>([]);
  const [board, setBoard] = useState<Standing[]>([]);
  const [confirm, setConfirm] = useState<{ t: TinRec; tokenId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const handle = w ? seasonHandle(w.keys) : null;

  useEffect(() => {
    if (!w) return;
    w.api.rooms.list.query({}).then(setFeed).catch(() => setFeed([]));
    w.api.rooms.leaderboard.query({}).then(setBoard).catch(() => setBoard([]));
  }, [w, live.version]);

  if (!w || !handle) return null;
  const hits = w.state.tins.flatMap((t) => (t.cards ?? []).map((tokenId) => ({ t, tokenId })));
  const postedCount = w.state.tins.reduce((n, t) => n + (t.posted?.length ?? 0), 0);

  async function post(t: TinRec, tokenId: string) {
    setBusy(true);
    try {
      await livePostHit(t, BigInt(tokenId));
      logActivity("Hit posted", `${handle!.name} · ${handle!.season}`);
      notify("Posted to the Room.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "The post did not go through.");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return <div className="space-y-6">
    <Panel title={`@${handle.name}`} eyebrow={`Season ${handle.season} · your handle`}>
      <p className="text-xs leading-copy text-foreground-subtle">Your handle is new each season and is not linked to other seasons. Posting a hit links that tin to this handle. A second post links those tins to each other. Removing a post cannot undo what was already public.</p>
    </Panel>

    <Panel title="Your hits" eyebrow="Cards in your tins">
      {hits.length ? <div className="divide-y divide-foreground/15">{hits.map(({ t, tokenId }) => {
        const posted = t.posted?.includes(tokenId);
        return <div key={`${t.index}-${tokenId}`} className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div><p className="type-caps text-lg">Card #{tokenId}</p><p className="text-xs text-foreground-subtle">Tin {t.index + 1}</p></div>
          {posted ? <Badge muted>Posted</Badge>
            : confirm?.t.index === t.index && confirm.tokenId === tokenId
              ? <div className="flex flex-wrap items-center gap-2"><p className="text-xs text-peach">This links this tin to your other posted tins.</p><Action disabled={busy} onClick={() => void post(t, tokenId)}>Post anyway</Action><Action secondary onClick={() => setConfirm(null)}>Keep private</Action></div>
              : <Action secondary disabled={busy} onClick={() => (postedCount > 0 ? setConfirm({ t, tokenId }) : void post(t, tokenId))}>Post this hit</Action>}
        </div>;
      })}</div> : <Empty title="No hits yet" copy="Cards you pull appear here. Nothing is posted unless you choose to post it." />}
    </Panel>

    <div className="grid grid-cols-2 gap-6 mobile:grid-cols-1">
      <Panel title="The Room" eyebrow={`Season ${handle.season}`}>
        {feed.length ? <ul className="divide-y divide-foreground/15">{feed.map((p) => <li key={p.postId} className="py-3"><p className="type-caps">{p.name ?? `Card #${p.tokenId}`}{p.grade ? ` · ${p.grade}` : ""}</p><p className="text-xs text-foreground-subtle">@{p.handle} · {new Date(p.at).toLocaleDateString()}{p.insuredValue ? ` · ${money(Number(p.insuredValue) / 1e6)} USDG insured` : ""}</p></li>)}</ul>
          : <p className="text-sm text-foreground-subtle">No hits posted this season yet.</p>}
      </Panel>
      <Panel title="Season standings" eyebrow="By insured value of posted hits">
        {board.length ? <ol className="space-y-2">{board.map((b, i) => <li key={b.handle} className="flex justify-between gap-4 text-sm"><span>{i + 1}. @{b.handle}</span><span className="text-foreground-subtle">{b.hits} hit{b.hits > 1 ? "s" : ""} · {money(Number(b.insuredTotal) / 1e6)} USDG</span></li>)}</ol>
          : <p className="text-sm text-foreground-subtle">Standings appear once hits are posted.</p>}
      </Panel>
    </div>
  </div>;
}
