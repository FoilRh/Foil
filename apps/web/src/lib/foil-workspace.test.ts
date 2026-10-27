import { expect, test } from "bun:test";
import { dropStarter, type Workspace } from "./foil-workspace";

test("saved workspaces lose the old example records and keep the user's own", () => {
  const saved: Workspace = {
    version: 1, balance: 1280.5, handle: "quietcollector", dailyLimit: 100, weeklyLimit: 400, coolOffUntil: null, pendingLimits: null, region: "GB", gifts: [],
    tins: [
      { id: "tin-004", name: "Rayquaza VMAX", productId: "vault-01", amount: 100, status: "Kept", shared: false, created: "2026-10-17T10:10:00Z" },
      { id: "tin-live-0", name: "Tin 1", productId: "tin-unassigned", amount: 25, status: "Ready", shared: false, created: "2026-10-27T09:00:00Z" },
    ],
    activity: [
      { id: "initial-1", title: "Collection organized", detail: "", amount: 0, at: "2026-10-17T10:10:00Z" },
      { id: "a1", title: "Region saved", detail: "GB", amount: 0, at: "2026-10-27T09:00:00Z" },
    ],
  };
  const w = dropStarter(saved);
  expect(w.balance).toBe(0);
  expect(w.handle).toBe("");
  expect(w.tins.map((t) => t.id)).toEqual(["tin-live-0"]);
  expect(w.activity.map((a) => a.id)).toEqual(["a1"]);
  expect([w.dailyLimit, w.weeklyLimit, w.region]).toEqual([100, 400, "GB"]);
  expect(dropStarter({ ...w, handle: "mine", balance: 12 })).toMatchObject({ handle: "mine", balance: 12 });
});
