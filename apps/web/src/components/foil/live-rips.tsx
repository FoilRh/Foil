"use client";
import { useState } from "react";
import { readyTins } from "@foil/client";
import { useLive } from "@/lib/foil-live";
import { EXTENSION_STORE_URL, startRipping, stopRipping, useRipping } from "@/lib/foil-extension";
import { money } from "@/lib/foil-workspace";
import { Action, Badge, Panel } from "./dashboard-ui";

/** Browser mode (Build §5A): rip on the pack site through the Foil extension, one fresh tin per rip. */
export function LiveRips() {
  const live = useLive();
  const rip = useRipping();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const w = live.wallet;
  if (!w) return null;
  const ready = readyTins(w.state.tins);

  async function start() {
    setBusy(true);
    setError("");
    try {
      await startRipping(w!);
      window.open("https://gacha.collectorcrypt.com", "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start.");
    } finally {
      setBusy(false);
    }
  }

  return <Panel title="Rip with the Foil extension" eyebrow="Browser mode · live">
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Badge muted={!rip.available}>{rip.available ? "Extension found" : "Extension not found"}</Badge>
        <Badge muted={!ready.length}>{ready.length} ready tin{ready.length === 1 ? "" : "s"}</Badge>
        {rip.connected && <Badge>Connected</Badge>}
      </div>
      {rip.tin && <p className="text-sm">Active tin: <span className="text-accent">Tin {rip.tin.index + 1}</span> · {money(Number(rip.tin.usdg ?? rip.tin.size) / 1e6)} USDG. The pack site sees only this tin.</p>}
      {rip.paused && <p className="text-sm text-peach">{rip.paused}</p>}
      <p className="text-xs leading-copy text-foreground-subtle">The extension shows the pack site one fresh tin at a time. Every request is checked and shown to you before the tin signs; anything that would send funds or cards elsewhere is blocked. When a card lands, Foil switches to the next ready tin and clears the site&apos;s storage so it cannot link your tins.</p>
      {!rip.available && <p className="text-xs leading-copy text-foreground-subtle">{EXTENSION_STORE_URL ? <><a href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-4">Install the Foil extension</a> from the Chrome Web Store, then reload this page.</> : "Install the Foil extension in this browser, then reload this page."}</p>}
      {(error || rip.error) && <p role="alert" className="text-sm text-highlight-secondary">{error || rip.error}</p>}
      {rip.connected
        ? <Action secondary onClick={() => stopRipping()}>Stop ripping</Action>
        : <Action disabled={!rip.available || busy || !ready.length} onClick={() => void start()}>{busy ? "Connecting…" : "Start ripping"}</Action>}
    </div>
  </Panel>;
}
