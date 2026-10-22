// Privacy CI (Build §11).
// 1. Client network calls must go through @foil/client's OHTTP transport.
// 2. API and services must never read or log client IPs or user agents (the OHTTP relay's
//    in-memory rate limit is the one documented exception).
// The schema rule (no linking tables) lives in packages/db/src/schema.test.ts.
import { readFileSync } from "node:fs";
import { Glob } from "bun";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

export const RULES = [
  {
    name: "client network call outside the OHTTP transport",
    scopes: ["apps/web/src/**/*.{ts,tsx}", "packages/client/src/**/*.ts", "apps/extension/src/**/*.ts"],
    allow: (f: string) => f.startsWith("packages/client/src/transport/") || f.endsWith(".test.ts"),
    re: /\bfetch\s*\(|new\s+WebSocket\b|XMLHttpRequest|new\s+EventSource\b|sendBeacon|createClient\s*\(/,
  },
  {
    name: "server reads a client IP or user agent",
    scopes: ["apps/api/src/**/*.ts", "services/*/src/**/*.ts"],
    // The OHTTP relay is the one hop that sees client IPs by design (RFC 9458): it keys an
    // in-memory, per-minute rate limit on them and never logs, stores or forwards them.
    allow: (f: string) => f.endsWith(".test.ts") || f === "services/ohttp-relay/src/relay.ts",
    re: /x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip|remoteAddress|\.ip\b|getConnInfo|user-agent/i,
  },
] as const;

export function scan(file: string, text: string) {
  const hits: string[] = [];
  for (const rule of RULES) {
    if (!rule.scopes.some((s) => new Glob(s).match(file)) || rule.allow(file)) continue;
    text.split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      if (rule.re.test(code)) hits.push(`${file}:${i + 1}: ${rule.name}: ${line.trim()}`);
    });
  }
  return hits;
}

if (import.meta.main) {
  const hits: string[] = [];
  for (const scope of RULES.flatMap((r) => r.scopes)) {
    for (const f of new Glob(scope).scanSync({ cwd: root })) {
      const rel = f.replace(/\\/g, "/");
      hits.push(...scan(rel, readFileSync(`${root}/${rel}`, "utf8")));
    }
  }
  const unique = [...new Set(hits)];
  unique.forEach((h) => console.error(h));
  if (unique.length) process.exit(1);
  console.log("privacy-lint: ok");
}
