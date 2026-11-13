// Shared by the API routes (the leading underscore keeps this file from being a route itself).
// The database is Vercel's Postgres (Neon): connecting it to the project in Vercel → Storage sets DATABASE_URL.
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
export const sql = url ? neon(url) : null;

let ready: Promise<void> | null = null;
export function schema() {
  if (!sql) return Promise.reject(new Error('no database'));
  ready ??= (async () => {
    await sql`create table if not exists rn_sessions (
      id text primary key, name text not null, started_at timestamptz not null default now(), last_at timestamptz not null default now(),
      device jsonb, progress jsonb not null default '{}'::jsonb, ended boolean not null default false, batches int not null default 0)`;
    await sql`create table if not exists rn_events (id bigserial primary key, session text not null, t real not null, type text not null, data jsonb, at timestamptz not null default now())`;
    await sql`create index if not exists rn_events_session on rn_events (session, t)`;
    await sql`create table if not exists rn_track (id bigserial primary key, session text not null, seq int not null, points jsonb not null)`;
    await sql`create index if not exists rn_track_session on rn_track (session, seq)`;
  })().catch(e => { ready = null; throw e; });
  return ready;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
