"use client";
import { useState, type FormEvent } from "react";
import { createVault, importVault, unlock, useLive } from "@/lib/foil-live";
import { Action, Badge, field } from "./dashboard-ui";

/** Create, import or unlock the on-device Foil wallet. Keys never leave this browser. */
export function VaultSetup({ onDone }: { onDone: (message: string) => void }) {
  const live = useLive();
  const [mode, setMode] = useState<"create" | "import">("create");
  const [pass, setPass] = useState("");
  const [phrase, setPhrase] = useState("");
  const [shown, setShown] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (live.phase === "locked") {
        await unlock(pass);
        onDone("Foil wallet unlocked.");
      } else if (mode === "create") {
        setShown(await createVault(pass));
      } else {
        await importVault(phrase, pass);
        onDone("Foil wallet restored. Syncing your Stash…");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (shown) {
    return <div className="space-y-5">
      <p className="text-sm leading-copy text-foreground-muted">Write these 12 words down, in order, and keep them offline. They are the only way to restore your Stash and tins on another device. Foil cannot recover them.</p>
      <ol className="grid grid-cols-3 gap-2 border border-foreground/15 p-4 text-sm mobile:grid-cols-2">{shown.split(" ").map((w, i) => <li key={i} className="type-caps"><span className="text-foreground-subtle">{i + 1}.</span> {w}</li>)}</ol>
      <label className="flex items-start gap-3 text-xs leading-copy"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1"/>I have written down my recovery phrase.</label>
      <Action className="w-full" disabled={!saved} onClick={() => onDone("Your Foil wallet is ready.")}>Continue</Action>
    </div>;
  }

  return <form onSubmit={submit} className="space-y-5">
    <Badge>Keys stay on this device</Badge>
    {live.phase !== "locked" && <div className="flex gap-2">
      <Action secondary={mode !== "create"} type="button" onClick={() => setMode("create")}>New wallet</Action>
      <Action secondary={mode !== "import"} type="button" onClick={() => setMode("import")}>Restore</Action>
    </div>}
    {live.phase !== "locked" && mode === "import" && <label className="block space-y-2"><span className="type-caps text-sm tracking-wide">Recovery phrase</span><textarea required rows={3} className={field} value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" spellCheck={false}/></label>}
    <label className="block space-y-2"><span className="type-caps text-sm tracking-wide">{live.phase === "locked" ? "Passphrase" : "Choose a passphrase"}</span><input required type="password" minLength={10} className={field} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete={live.phase === "locked" ? "current-password" : "new-password"}/></label>
    <p className="text-xs leading-copy text-foreground-subtle">The passphrase encrypts your wallet in this browser. Proofs are made here too; only encrypted requests leave the device, through a relay that cannot read them.</p>
    {error && <p role="alert" className="text-sm text-highlight-secondary">{error}</p>}
    <Action type="submit" className="w-full" disabled={busy}>{busy ? "Working…" : live.phase === "locked" ? "Unlock" : mode === "create" ? "Create wallet" : "Restore wallet"}</Action>
  </form>;
}
