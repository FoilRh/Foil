"use client";
import { useState } from "react";
import type { TinRec } from "@foil/client";
import { liveGiftLink, liveTakeBackGift, useLive } from "@/lib/foil-live";
import { logActivity, money } from "@/lib/foil-workspace";
import { Action, Badge, Empty, Panel } from "./dashboard-ui";

function status(t: TinRec): { label: string; ready: boolean } {
  if (t.state === "Requested") return { label: "Waiting for its round", ready: false };
  if (t.gift?.takenBack) return { label: "Taken back", ready: false };
  if (t.usdg === "0") return { label: "Claimed", ready: false };
  return { label: "Ready to share", ready: true };
}

/** Live gift tins (Build §6). The link is a bearer secret: shown on request, never stored elsewhere. */
export function LiveGifts({ notify }: { notify: (text: string) => void }) {
  const live = useLive();
  const [shown, setShown] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const gifts = live.wallet?.state.tins.filter((t) => t.gift) ?? [];

  async function copy(t: TinRec) {
    const link = liveGiftLink(t);
    try {
      await navigator.clipboard.writeText(link);
      notify("Gift link copied. Share it privately: whoever opens it first can claim it.");
    } catch {
      setShown(t.index);
    }
  }

  async function takeBack(t: TinRec) {
    setBusy(t.index);
    try {
      await liveTakeBackGift(t);
      logActivity("Gift taken back", `Tin ${t.index + 1} · joins your Stash after screening`, Number(t.usdg ?? t.size) / 1e6);
      notify("Gift taken back. The link no longer holds anything.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "That did not go through.");
    } finally {
      setBusy(null);
    }
  }

  if (!gifts.length) {
    return <Empty title="No live gifts yet" copy="A gift is a freshly funded tin. You share a link; the recipient moves it into their own Stash." />;
  }
  return <Panel title="Your gifts" eyebrow="Funded tins, shared by link">
    <div className="divide-y divide-foreground/15">{gifts.map((t) => {
      const s = status(t);
      return <article key={t.index} className="flex items-start justify-between gap-5 py-5 mobile:flex-col">
        <div className="min-w-0">
          <Badge muted={!s.ready}>{s.label}</Badge>
          <p className="mt-3 text-sm text-accent">{money(Number(t.size) / 1e6)} USDG</p>
          {t.gift?.note && <p className="mt-2 text-sm text-foreground-subtle">“{t.gift.note}”</p>}
          {shown === t.index && <p className="mt-3 break-all rounded-lg border border-highlight-secondary/40 p-3 font-mono text-xs">{liveGiftLink(t)}</p>}
        </div>
        {s.ready && <div className="flex flex-wrap gap-2">
          <Action secondary onClick={() => void copy(t)}>Copy gift link</Action>
          <Action secondary disabled={busy === t.index} onClick={() => void takeBack(t)}>{busy === t.index ? "Working…" : "Take back"}</Action>
        </div>}
      </article>;
    })}</div>
    <p className="mt-4 text-xs leading-copy text-foreground-subtle">A gift link carries the tin&apos;s key in the part after “#”, which browsers never send to any server. Until it is claimed, anyone with the link (including you) can move it. On-chain it looks like any tin returning to a Stash.</p>
  </Panel>;
}
