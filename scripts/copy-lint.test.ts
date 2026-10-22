import { expect, test } from "bun:test";
import { lintText, visibleStrings } from "./copy-lint";

test("flags banned words in strings and JSX, ignores comments and imports", () => {
  const src = `
    // this returns anonymous data — comment, ignored
    import x from "./win";
    const a = "Earn yield now";
    const b = \`Hit the \${x} jackpot\`;
    export const C = () => <p>Totally untraceable</p>;
    const ok = "window and earnings";`;
  const hits = lintText(visibleStrings(src, "f.tsx"), false);
  expect(hits.map((h) => h.trim())).toEqual(["Earn yield now", "jackpot", "Totally untraceable"]);
});

test("Pokémon is only banned in brand slots", () => {
  expect(lintText(["Pokémon TCG"], false)).toEqual([]);
  expect(lintText(["Pokémon Wallet"], true)).toEqual(["Pokémon Wallet"]);
});
