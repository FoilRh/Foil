-- Privacy lockdown (plan.md "Supabase rules"): browsers never talk to Supabase.
-- Only the API and services connect, as the postgres role through the pooler.
-- RLS with no policies denies anon/authenticated on every table; grants are revoked too.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on public.%I from anon, authenticated', t.tablename);
  end loop;
end $$;

alter default privileges in schema public revoke all on tables from anon, authenticated;

-- Housekeeping on pg_cron.
create extension if not exists pg_cron;

-- Safety net: reveals are deleted when a round executes; never keep one past 2 hours.
select cron.schedule('foil-prune-reveals', '*/15 * * * *',
  $$delete from public.pending_reveals where received_at < now() - interval '2 hours'$$);

-- Status history: keep 7 days.
select cron.schedule('foil-prune-status', '17 3 * * *',
  $$delete from public.status where ts < now() - interval '7 days'$$);
