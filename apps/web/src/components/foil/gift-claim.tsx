"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { decodeGiftFragment } from "@foil/client/src/gift";
import { liveClaimGift, liveConfigured, lookupGiftTin, useLive } from "@/lib/foil-live";
import { logActivity, money } from "@/lib/foil-workspace";
import { Action, Badge, Panel } from "./dashboard-ui";
import { VaultSetup } from "./vault-setup";

type Gift = NonNullable<ReturnType<typeof decodeGiftFragment>>;
type Lookup = { state: "loading" } | { state: "missing" } | { state: "empty" } | { state: "ready"; usdg: bigint };

/** Claim page for a gift link (Build §6). The key is read from the fragment only. */
export function GiftClaim() {
  const live = useLive();
  const [gift, setGift] = useState<Gift | null | undefined>(undefined);
  const [lookup, setLookup] = useState<Lookup>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setGift(decodeGiftFragment(window.location.hash));
  }, []);

  useEffect(() => {
    if (!gift || !liveConfigured) return;
    lookupGiftTin(gift.address)
      .then((t) => setLookup(!t ? { state: "missing" } : t.usdg === 0n ? { state: "empty" } : { state: "ready", usdg: t.usdg }))
      .catch(() => setLookup({ state: "missing" }));
  }, [gift, live.phase]);

  async function claim() {
    if (!gift || lookup.state !== "ready") return;
    setBusy(true);
    setError("");
    try {
      await liveClaimGift(gift.key, lookup.usdg);
      logActivity("Gift claimed", "Joins your Stash after screening", Number(lookup.usdg) / 1e6);
      // Drop the key from the address bar now that it has done its job.
      history.replaceState(null, "", "/gift/");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The gift could not be claimed.");
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (gift === undefined) body = <p className="text-sm text-foreground-subtle">Opening your gift…</p>;
  else if (!gift) body = <p className="text-sm text-foreground-subtle">This link is not a Foil gift, or it was cut short. Ask the sender to copy it again.</p>;
  else if (!liveConfigured) body = <p className="text-sm text-foreground-subtle">Gifts can be claimed once Foil is live.</p>;
  else if (done) body = <div className="space-y-4"><Badge>Claimed</Badge><p className="text-sm leading-copy">The gift is on its way to your Stash and arrives after screening.</p><Link href="/dashboard?tab=stash" className="text-sm text-accent underline">Open your Stash</Link></div>;
  else body = <div className="space-y-5">
    {gift.note && <p className="type-script text-2xl text-peach">“{gift.note}”</p>}
    {lookup.state === "loading" && <p className="text-sm text-foreground-subtle">Checking the gift…</p>}
    {lookup.state === "missing" && <p className="text-sm text-foreground-subtle">This gift is not funded yet. Funding rounds run every 10 to 30 minutes; try again a little later.</p>}
    {lookup.state === "empty" && <p className="text-sm text-foreground-subtle">This gift has already been claimed or taken back.</p>}
    {lookup.state === "ready" && <>
      <p className="type-display text-6xl leading-display">{money(Number(lookup.usdg) / 1e6)} <span className="text-2xl text-accent">USDG</span></p>
      <p className="text-xs leading-copy text-foreground-subtle">Claiming moves it into your own Stash, privately. Until you claim it, anyone holding this link can, so claim it now.</p>
      {live.phase === "unlocked"
        ? <Action className="w-full" disabled={busy} onClick={() => void claim()}>{busy ? "Claiming…" : "Claim to my Stash"}</Action>
        : <div className="border-t border-foreground/15 pt-5"><p className="mb-4 text-sm">{live.phase === "locked" ? "Unlock your Foil wallet to claim." : "Set up a Foil wallet to claim. It takes a minute."}</p><VaultSetup onDone={() => setError("")}/></div>}
    </>}
    {error && <p role="alert" className="text-sm text-highlight-secondary">{error}</p>}
  </div>;

  return <main className="foil-dashboard flex min-h-svh items-center justify-center bg-background bg-(image:--workspace-gradient) px-4 py-10 text-foreground">
    <div className="w-full max-w-lg"><Link href="/" aria-label="Foil home" className="type-display mb-6 block text-4xl text-accent">FOIL</Link>
      <Panel title="Someone sent you a gift" eyebrow="A Foil gift">{body}</Panel>
    </div>
  </main>;
}
