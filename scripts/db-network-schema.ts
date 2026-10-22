/**
 * Gives a network its own schema and login role in the shared Supabase database:
 *   bun scripts/db-network-schema.ts mainnet
 * Admin connection: DATABASE_URL in deploy/testnet.env (the project's postgres role).
 * - schema `<network>` holding every table from supabase/migrations (applied once each,
 *   tracked in <network>.__migrations), with RLS on and anon/authenticated revoked;
 * - role `foil_<network>` (LOGIN, random password) whose search_path is that schema, so services
 *   run unchanged; it can use only its own schema (not testnet's `public` tables);
 * - pg_cron housekeeping jobs for that schema;
 * - DATABASE_URL for the role written to deploy/<network>.env (through the same pooler).
 * Idempotent; never prints the password.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const network = process.argv[2];
if (network !== "mainnet") throw new Error("usage: db-network-schema.ts mainnet (testnet keeps the public schema)");
const root = join(import.meta.dir, "..");
const envPath = (n: string) => join(root, "deploy", `${n}.env`);
const readEnv = (n: string) => Object.fromEntries(readFileSync(envPath(n), "utf8").split(/\r?\n/).flatMap((l) => {
  const m = /^([A-Z0-9_]+)=(.+)$/.exec(l.trim());
  return m ? [[m[1]!, m[2]!]] : [];
})) as Record<string, string>;

const adminUrl = readEnv("testnet").DATABASE_URL;
if (!adminUrl) throw new Error("DATABASE_URL missing from deploy/testnet.env");
const schema = network;
const role = `foil_${network}`;
const sql = postgres(adminUrl, { prepare: false, max: 1, onnotice: () => {} });

await sql.unsafe(`create schema if not exists ${schema}`);
await sql.unsafe(`create table if not exists ${schema}.__migrations (name text primary key, applied_at timestamptz not null default now())`);

// Migrations, written for `public`, applied into the network's schema.
const dir = join(root, "supabase", "migrations");
const done = new Set((await sql.unsafe(`select name from ${schema}.__migrations`)).map((r) => r.name as string));
for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  if (done.has(f)) continue;
  const body = readFileSync(join(dir, f), "utf8")
    .replaceAll("public.", `${schema}.`)
    .replaceAll("schemaname = 'public'", `schemaname = '${schema}'`)
    .replaceAll("in schema public", `in schema ${schema}`)
    .replace(/cron\.schedule\('([a-z0-9-]+)'/g, `cron.schedule('$1-${schema}'`);
  await sql.begin(async (tx) => {
    await tx.unsafe(`set local search_path = ${schema}, extensions`);
    for (const stmt of body.split("--> statement-breakpoint")) if (stmt.trim()) await tx.unsafe(stmt);
    await tx.unsafe(`insert into ${schema}.__migrations (name) values ($1)`, [f]);
  });
  console.log(`applied ${f} → ${schema}`);
}

// The service role: login, own schema only.
const exists = (await sql`select 1 from pg_roles where rolname = ${role}`).length > 0;
const env = readFileSync(envPath(network), "utf8");
const haveUrl = /^DATABASE_URL=postgres/m.test(env);
let password: string | null = null;
if (!exists || !haveUrl) {
  password = randomBytes(24).toString("base64url");
  await sql.unsafe(`${exists ? "alter" : "create"} role ${role} with login password '${password}'`);
}
await sql.unsafe(`alter role ${role} set search_path = ${schema}`);
await sql.unsafe(`grant usage on schema ${schema} to ${role}`);
await sql.unsafe(`grant select, insert, update, delete on all tables in schema ${schema} to ${role}`);
await sql.unsafe(`alter default privileges in schema ${schema} grant select, insert, update, delete on tables to ${role}`);
await sql.unsafe(`revoke all on ${schema}.__migrations from ${role}`);
// RLS on every table (deny anon/authenticated); this role, not the owner, needs an explicit policy.
for (const { tablename } of await sql`select tablename from pg_tables where schemaname = ${schema} and tablename <> '__migrations'`) {
  const t = `${schema}."${tablename}"`;
  await sql.unsafe(`alter table ${t} enable row level security`);
  await sql.unsafe(`revoke all on ${t} from anon, authenticated`);
  await sql.unsafe(`drop policy if exists service_rw on ${t}`);
  await sql.unsafe(`create policy service_rw on ${t} for all to ${role} using (true) with check (true)`);
}
await sql.end();

if (password) {
  // Same pooler host and project ref as the admin URL; user `<role>.<project ref>`.
  const u = new URL(adminUrl);
  const ref = decodeURIComponent(u.username).split(".")[1];
  if (!ref) throw new Error("admin DATABASE_URL user is not <role>.<project ref>");
  u.username = `${role}.${ref}`;
  u.password = password;
  const line = `DATABASE_URL=${u.toString()}`;
  const next = /^DATABASE_URL=.*$/m.test(env) ? env.replace(/^DATABASE_URL=.*$/m, line) : `${env.trimEnd()}\n${line}\n`;
  writeFileSync(envPath(network), next, { mode: 0o600 });
  console.log(`role ${role} ready; DATABASE_URL written to deploy/${network}.env`);
} else {
  console.log(`role ${role} already set up`);
}
