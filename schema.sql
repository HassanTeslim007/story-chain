-- Story Chain schema (Supabase Postgres)

create extension if not exists "pgcrypto";

create table sessions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,               -- short join code, e.g. 6 chars
  status text not null default 'lobby',    -- lobby | active | finished
  phase text not null default 'turn' check (phase in ('turn', 'judging', 'cooldown')),
  mode text not null default 'elimination' check (mode in ('elimination', 'marathon')),
  max_turns_per_player int not null default 12, -- safety cap (elimination) or the whole point (marathon)
  end_reason text check (end_reason in ('elimination', 'turn_cap')),
  genre text,                              -- steers the AI opening; null/empty = "surprise me"
  ai_difficulty text check (ai_difficulty in ('easy', 'normal', 'hard')), -- set only for solo-vs-AI games
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
  is_ai boolean not null default false,    -- true for the AI opponent in a solo game
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

-- Archive of standout individual lines (score > 50), kept past the 24h
-- session cleanup so genuinely good writing isn't lost when its game is
-- purged. The story-so-far context is plain text with NO attribution -
-- only the highlighted line itself is credited to its author, a conscious
-- exception, not a precedent for logging names elsewhere. No FK to
-- sessions/players (survives their cleanup independently, like game_events).
create table great_lines (
  id uuid primary key default gen_random_uuid(),
  session_code text not null,
  turn_number int not null,
  context text not null,      -- story so far, unattributed
  sentence text not null,     -- the line that scored > 50
  author_name text not null,  -- who wrote it - the one deliberate exception
  score numeric not null,
  mode text not null,
  genre text,
  created_at timestamptz not null default now()
);

-- Fixed-window per-IP rate limiting (see lib/rateLimit.ts). Rows are cheap
-- and short-lived - swept by the same hourly cleanup job as sessions.
create table rate_limits (
  key text primary key,   -- "{route}:{ip}:{fixed window bucket}"
  count int not null default 1,
  created_at timestamptz not null default now()
);

alter table sessions enable row level security;
alter table players enable row level security;
alter table sentences enable row level security;
alter table game_events enable row level security;
alter table great_lines enable row level security;
alter table rate_limits enable row level security;

-- MVP: fully open policies (no auth). Tighten later if needed.
create policy "public read sessions" on sessions for select using (true);
create policy "public read players" on players for select using (true);
create policy "public read sentences" on sentences for select using (true);

-- game_events, great_lines, and rate_limits get NO policies at all -
-- anon/authenticated clients have zero access. Only the service-role key
-- (which bypasses RLS) reads or writes them.

-- All writes go through server-side API routes using the service role key,
-- which bypasses RLS, so no public write policies are defined.

-- No history feature reads old sessions, so a pg_cron job purges them hourly
-- rather than keeping them forever: finished sessions after a 24h grace
-- period (so players can still revisit/export right after), and abandoned
-- lobby/active sessions nobody ever finished, same threshold. players and
-- sentences cascade-delete via their FK on sessions. See the
-- add_stale_session_cleanup migration for the actual function/schedule.
