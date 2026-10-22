import { expect, test } from "bun:test";
import { mergeLimits, openBackup, sealBackup, type BackupData } from "./backup";

const data: BackupData = {
  v: 1, updatedAt: "2026-10-21T00:00:00Z", region: "US", spends: [{ at: "2026-10-20T10:00:00Z", amount: 25 }], tins: [], nextTin: 3,
  limits: { dailyLimit: 250, weeklyLimit: 1000, pendingLimits: null, coolOffUntil: null },
};

test("backup round-trips and rejects a wrong key", () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const blob = sealBackup(key, data);
  expect(openBackup(key, blob)).toEqual(data);
  expect(() => openBackup(crypto.getRandomValues(new Uint8Array(32)), blob)).toThrow();
});

test("restoring never loosens limits or shortens a cool-off", () => {
  const strict = { dailyLimit: 100, weeklyLimit: 300, pendingLimits: null, coolOffUntil: "2026-10-28T00:00:00Z" };
  const loose = { dailyLimit: 250, weeklyLimit: 1000, pendingLimits: { daily: 500, weekly: 2000, at: "2026-10-22T00:00:00Z" }, coolOffUntil: null };
  const m = mergeLimits(loose, strict);
  expect(m.dailyLimit).toBe(100);
  expect(m.weeklyLimit).toBe(300);
  expect(m.coolOffUntil).toBe("2026-10-28T00:00:00Z");
  expect(m.pendingLimits?.daily).toBe(500); // a scheduled raise still waits its 24h
});
