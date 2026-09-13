-- Story Chain schema (Supabase Postgres)

create extension if not exists "pgcrypto";

create table sessions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,               -- short join code, e.g. 6 chars
  status text not null default 'lobby',    -- lobby | active | finished
  phase text not null default 'turn' check (phase in ('turn', 'cooldown')),
  mode text not null default 'elimination' check (mode in ('elimination', 'marathon')),
  max_turns_per_player int not null default 12, -- safety cap (elimination) or the whole point (marathon)
  end_reason text check (end_reason in ('elimination', 'turn_cap')),
  genre text,                              -- steers the AI opening; null/empty = "surprise me"
  turn_seconds int not null default 30,
  current_turn_player_id uuid,
  turn_number int not null default 0,
  turn_deadline timestamptz,               -- deadline of the current phase (turn or cooldown)
  total_score numeric not null default 0,  -- sum of scores currently counted in avg
  score_count int not null default 0,      -- count of scores currently counted in avg
  winner_player_id uuid,
  created_at timestamptz not null default now()
);

create table players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  name text not null,
  turn_order int not null,
  is_alive boolean not null default true,
  turns_taken int not null default 0,      -- completed (submitted) turns, for the turn cap
  joined_at timestamptz not null default now()
);

create table sentences (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  player_id uuid references players(id) on delete set null, -- null for AI opening
  turn_number int not null,
  content text not null,
  score numeric,               -- null for AI opening / eliminated-by-timeout entries
  removed boolean not null default false,
  reasoning text,
  created_at timestamptz not null default now()
);

-- Lightweight, insert-only analytics - deliberately NOT a FK to sessions, so
-- the cleanup job below can purge full session/story content on its own
-- schedule without ever touching these rows. No player names, no story
-- content - just enough to answer "how many people play, and how far do
-- they get" (created -> started -> finished funnel).
create table game_events (
  id uuid primary key default gen_random_uuid(),
  event text not null check (event in ('created', 'started', 'finished', 'cancelled')),
  session_code text not null,
  mode text not null,
  genre text,
  turn_seconds int not null,
  player_count int,
  end_reason text,
  turns_played int,
  created_at timestamptz not null default now()
);

alter table sessions enable row level security;
alter table players enable row level security;
alter table sentences enable row level security;
alter table game_events enable row level security;

-- MVP: fully open policies (no auth). Tighten later if needed.
create policy "public read sessions" on sessions for select using (true);
create policy "public read players" on players for select using (true);
create policy "public read sentences" on sentences for select using (true);

-- game_events gets NO policies at all - anon/authenticated clients have zero
-- access. Only the service-role key (which bypasses RLS) reads or writes it.

-- All writes go through server-side API routes using the service role key,
-- which bypasses RLS, so no public write policies are defined.

-- No history feature reads old sessions, so a pg_cron job purges them hourly
-- rather than keeping them forever: finished sessions after a 24h grace
-- period (so players can still revisit/export right after), and abandoned
-- lobby/active sessions nobody ever finished, same threshold. players and
-- sentences cascade-delete via their FK on sessions. See the
-- add_stale_session_cleanup migration for the actual function/schedule.
