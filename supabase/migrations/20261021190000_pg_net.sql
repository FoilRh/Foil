-- Lets pg_cron call the services' /tick endpoints on Vercel (scripts/vercel/deploy.ts cron).
create extension if not exists pg_net;
