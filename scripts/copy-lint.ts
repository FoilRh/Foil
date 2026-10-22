// Copy lint (Build §12): banned words in user-visible strings and JSX text.
// Comments are ignored: only string literals, template text and JSX text are checked.
import ts from "typescript";
import { readFileSync } from "node:fs";
import { Glob } from "bun";

export const BANNED = [
  "APY", "yield", "interest", "earn", "investment", "returns", "win", "jackpot", "profit",
  "guaranteed", "sell back now", "untraceable", "anonymous", "mixer",
];
// "Pokémon" is banned only in brand slots (site name/title, app manifest names).
const BRAND_SLOTS = ["apps/web/src/lib/site.ts", "apps/web/public/manifest.json"];
const SCOPES = ["apps/web/src/**/*.{ts,tsx}", "apps/api/src/**/*.ts", "apps/extension/src/**/*.ts"];

const bannedRe = new RegExp(`\\b(${BANNED.map((w) => w.replace(/ /g, "\\s+")).join("|")})\\b`, "i");
const pokemonRe = /pok[eé]mon/i;

export function visibleStrings(source: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    // Module specifiers are paths, not copy.
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

export function lintText(strings: string[], brandSlot: boolean): string[] {
  return strings.filter((s) => bannedRe.test(s) || (brandSlot && pokemonRe.test(s)));
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  let failures = 0;
  for (const pattern of SCOPES) {
    for (const file of new Glob(pattern).scanSync({ cwd: root })) {
      const rel = file.replace(/\\/g, "/");
      const hits = lintText(visibleStrings(readFileSync(`${root}/${rel}`, "utf8"), rel), BRAND_SLOTS.includes(rel));
      for (const h of hits) { failures++; console.error(`${rel}: "${h.trim().slice(0, 80)}"`); }
    }
  }
  for (const rel of BRAND_SLOTS.filter((f) => f.endsWith(".json"))) {
    const m = JSON.parse(readFileSync(`${root}/${rel}`, "utf8")) as Record<string, unknown>;
    for (const k of ["name", "short_name", "description"]) {
      const v = m[k];
      if (typeof v === "string" && lintText([v], true).length) { failures++; console.error(`${rel}: ${k}`); }
    }
  }
  if (failures) { console.error(`copy-lint: ${failures} banned phrase(s)`); process.exit(1); }
  console.log("copy-lint: ok");
}
