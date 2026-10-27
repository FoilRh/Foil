/**
 * Publishes the committed state of this repo to the public mirror, with its own history.
 *   bun scripts/publish-public.ts [--dry]    (after committing and pushing the private repo)
 * Settings and the token come from deploy/public-github.env (gitignored): GITHUB_PUBLIC_TOKEN,
 * GITHUB_PUBLIC_REPO, PUBLIC_NAME, PUBLIC_EMAIL, PUBLIC_FORBIDDEN (comma-separated words).
 *
 * Rules (see the private repo's setup notes):
 * - only tracked files from HEAD, never the working tree, never gitignored files;
 * - no *.md except the root README.md, no `lovable` or `.claude` folders, nothing listed in PRIVATE_ONLY; the public
 *   repo keeps its own LICENSE (MIT) and history, and each publish is one commit on top;
 * - every commit is authored and committed by PUBLIC_NAME <PUBLIC_EMAIL>, no trailers;
 * - aborts if any file name, file content or the message contains a PUBLIC_FORBIDDEN word, this
 *   repo's own git user.name / user.email, or a value from deploy/*.env (keys, tokens, URLs).
 * The mirror lives in ../foil-public (outside this repo). The token is passed per push as an
 * HTTP header, never written to a remote URL or git config.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
const mirror = join(root, "..", "foil-public");
const PRIVATE_ONLY = [/(^|\/)apps\/web\/docs\/reference\/foil-cc-outreach\.pdf$/, /^LICENSE$/];
/** Files the public repo owns (its MIT LICENSE): never exported over, never deleted. */
const PUBLIC_OWNED = new Set(["LICENSE"]);
const excluded = (p: string) =>
  (/\.md$/i.test(p) && p !== "README.md") || /(^|\/)lovable(\/|$)/i.test(p) || /(^|\/)\.claude(\/|$)/.test(p) || PRIVATE_ONLY.some((r) => r.test(p));

function envFile(f: string): Record<string, string> {
  if (!existsSync(f)) return {};
  return Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).flatMap((l) => {
    const m = /^([A-Z0-9_]+)=(.+)$/.exec(l.trim());
    return m ? [[m[1]!, m[2]!]] : [];
  }));
}
const cfg = envFile(join(root, "deploy", "public-github.env"));
for (const k of ["GITHUB_PUBLIC_TOKEN", "GITHUB_PUBLIC_REPO", "PUBLIC_NAME", "PUBLIC_EMAIL", "PUBLIC_FORBIDDEN"]) {
  if (!cfg[k]) throw new Error(`${k} missing from deploy/public-github.env`);
}

function run(cmd: string[], cwd: string, opts: { input?: Uint8Array | string; env?: Record<string, string> } = {}) {
  const p = Bun.spawnSync(cmd, { cwd, stdin: opts.input === undefined ? "ignore" : new Blob([opts.input]), stdout: "pipe", stderr: "pipe", env: { ...process.env, ...opts.env } });
  if (p.exitCode !== 0) {
    // Name the command without its arguments: the push carries the token (base64) in a -c header.
    const what = cmd.filter((a) => !a.startsWith("-") && !a.includes("extraheader")).slice(0, 2).join(" ");
    const b64 = Buffer.from(`x-access-token:${cfg.GITHUB_PUBLIC_TOKEN}`).toString("base64");
    throw new Error(`${what} failed: ${p.stderr.toString().replaceAll(cfg.GITHUB_PUBLIC_TOKEN!, "***").replaceAll(b64, "***").slice(-600)}`);
  }
  return p.stdout;
}
const git = (args: string[], cwd = root, opts = {}) => run(["git", ...args], cwd, opts);

// Everything that must never reach the public repo, matched case-insensitively.
const needles = [
  ...cfg.PUBLIC_FORBIDDEN!.split(",").map((w) => w.trim()).filter(Boolean),
  git(["config", "user.name"]).toString().trim(),
  git(["config", "user.email"]).toString().trim(),
  cfg.GITHUB_PUBLIC_TOKEN!,
  ...readdirSync(join(root, "deploy")).filter((f) => f.endsWith(".env")).flatMap((f) =>
    Object.entries(envFile(join(root, "deploy", f)))
      .filter(([k, v]) => v.length >= 12 && /KEY|TOKEN|SECRET|PASSWORD|DATABASE|MNEMONIC|SCOPE|WEBHOOK/.test(k))
      .map(([, v]) => v)),
].filter((n) => n.length >= 4).map((n) => n.toLowerCase());
const leak = (text: string) => {
  const t = text.toLowerCase();
  return needles.some((n) => t.includes(n));
};

// 1. The mirror repo (created once, outside this repo).
if (!existsSync(join(mirror, ".git"))) {
  mkdirSync(mirror, { recursive: true });
  git(["init", "-q", "-b", "main"], mirror);
  git(["remote", "add", "origin", `https://github.com/${cfg.GITHUB_PUBLIC_REPO}.git`], mirror);
}
git(["config", "user.name", cfg.PUBLIC_NAME!], mirror);
git(["config", "user.email", cfg.PUBLIC_EMAIL!], mirror);
const auth = ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${cfg.GITHUB_PUBLIC_TOKEN}`).toString("base64")}`];
// Build on whatever the public repo already has (its initial commit, its LICENSE).
git([...auth, "fetch", "-q", "origin"], mirror);
const hasRemote = Bun.spawnSync(["git", "rev-parse", "--verify", "-q", "origin/main"], { cwd: mirror }).exitCode === 0;
if (hasRemote) {
  git(["reset", "-q", "--mixed", "origin/main"], mirror);
  for (const f of PUBLIC_OWNED) Bun.spawnSync(["git", "checkout", "-q", "origin/main", "--", f], { cwd: mirror });
}

// 2. The file list from HEAD, filtered. Gitlinks (submodules) are re-created by commit id.
const entries = git(["ls-tree", "-r", "-z", "HEAD"]).toString().split("\0").filter(Boolean).map((l) => {
  const [meta, path] = l.split("\t") as [string, string];
  const [mode, type, sha] = meta.split(" ") as [string, string, string];
  return { mode, type, sha, path };
}).filter((e) => !excluded(e.path));

// 3. Replace the mirror's tree with that list (its .git stays).
for (const f of readdirSync(mirror)) if (f !== ".git" && !PUBLIC_OWNED.has(f)) rmSync(join(mirror, f), { recursive: true, force: true });
const problems: string[] = [];
for (const e of entries) {
  if (leak(e.path)) problems.push(`path ${e.path}`);
  if (e.type === "commit") continue;
  const body = git(["cat-file", "blob", e.sha]);
  if (leak(body.toString("latin1"))) problems.push(`content ${e.path}`);
  const out = join(mirror, e.path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, body, { mode: e.mode === "100755" ? 0o755 : 0o644 });
}
const subject = git(["log", "-1", "--format=%s"]).toString().trim();
if (leak(subject)) problems.push("commit subject");
if (problems.length) throw new Error(`refusing to publish:\n  ${problems.join("\n  ")}`);

if (process.argv.includes("--dry")) {
  console.log(`dry run: ${entries.length} files would be published, no problems found (mirror tree written to ${mirror})`);
  process.exit(0);
}

// 4. Stage, add gitlinks, commit as the public identity only, push.
git(["add", "-A"], mirror);
for (const e of entries.filter((x) => x.type === "commit")) {
  git(["update-index", "--add", "--cacheinfo", `160000,${e.sha},${e.path}`], mirror);
}
if (git(["status", "--porcelain"], mirror).toString().trim() === "") {
  console.log("public mirror already up to date");
  process.exit(0);
}
const who = { GIT_AUTHOR_NAME: cfg.PUBLIC_NAME!, GIT_AUTHOR_EMAIL: cfg.PUBLIC_EMAIL!, GIT_COMMITTER_NAME: cfg.PUBLIC_NAME!, GIT_COMMITTER_EMAIL: cfg.PUBLIC_EMAIL! };
git(["commit", "-q", "-F", "-"], mirror, { input: `${subject}\n`, env: who });
git([...auth, "push", "-q", "origin", "main"], mirror);
console.log(`published ${entries.length} files to ${cfg.GITHUB_PUBLIC_REPO}: ${git(["log", "-1", "--format=%h %an <%ae>"], mirror).toString().trim()}`);
