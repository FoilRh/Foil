"use client";
/**
 * Fund Collector Crypt's Solana balance from the active tin (Relay bridge), then mark the rip.
 * The card lands in the Collector Crypt account, so Foil cannot see it arrive: the user marks it.
 */
import { useState } from "react";
import { fundCc, markActiveTinRipped, quoteCcFunding, type CcFundingQuote } from "@/lib/foil-extension";
import { money } from "@/lib/foil-workspace";
import { Action, field } from "./dashboard-ui";

export function CcFunding() {
  const [address, setAddress] = useState("");
  const [price, setPrice] = useState("25");
  const [quote, setQuote] = useState<CcFundingQuote | null>(null);
  const [step, setStep] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(job: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await job(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); setStep(""); }
  }
  const getQuote = () => run(async () => { setDone(false); setQuote(await quoteCcFunding(address, Number(price))); });
  const send = () => run(async () => { await fundCc(quote!, setStep); setDone(true); setQuote(null); });
  const ripped = () => run(async () => { await markActiveTinRipped(); setDone(false); setAddress(""); });

  return <section aria-labelledby="cc-funding" className="space-y-4 border-t border-foreground/15 pt-5">
    <h3 id="cc-funding" className="type-caps text-sm tracking-wide">Fund Collector Crypt</h3>
    <p className="text-xs leading-copy text-foreground-subtle">Collector Crypt sells packs from a Solana USDC balance. Sign in there with Foil, open Fund, copy the account&apos;s Solana address, and the tin bridges the pack price to it. The bridge links this tin to that account onchain; neither leads back to you.</p>
    {!quote && !done && <div className="grid gap-3">
      <label className="block space-y-2"><span className="type-caps text-xs tracking-wide">Collector Crypt Solana address</span>
        <input className={`${field} font-mono`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Paste from Collector Crypt" spellCheck={false} autoComplete="off" /></label>
      <label className="block space-y-2"><span className="type-caps text-xs tracking-wide">Pack price · USDC</span>
        <input className={field} type="number" min={1} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <Action disabled={busy || !address.trim()} onClick={() => void getQuote()}>{busy ? "Getting a quote…" : "Get quote"}</Action>
    </div>}
    {quote && <div className="space-y-3">
      <p className="text-sm">The tin sends <span className="text-accent">{money(Number(quote.amountIn) / 1e6)} USDG</span>; Collector Crypt receives <span className="text-accent">{money(Number(quote.amountOut) / 1e6)} USDC</span> at:</p>
      <p className="break-all rounded-lg border border-foreground/25 p-3 font-mono text-sm">{quote.recipient}</p>
      <p className="text-xs leading-copy text-foreground-subtle">Check every character against Collector Crypt: a Solana address has no checksum, and funds sent to a wrong one cannot be recovered.</p>
      <div className="flex flex-wrap gap-2">
        <Action disabled={busy} onClick={() => void send()}>{busy ? step || "Sending…" : "Send to Collector Crypt"}</Action>
        <Action secondary disabled={busy} onClick={() => setQuote(null)}>Change</Action>
      </div>
    </div>}
    {done && <div className="space-y-3">
      <p role="status" className="text-sm">Arrived. Open your pack on Collector Crypt, then mark this tin as ripped to move on to the next one. Send any USDG left in the tin back to your Stash from My tins.</p>
      <Action disabled={busy} onClick={() => void ripped()}>{busy ? "Updating…" : "Mark as ripped"}</Action>
    </div>}
    {error && <p role="alert" className="text-sm text-highlight-secondary">{error}</p>}
  </section>;
}
