-- Story Chain schema (Supabase Postgres)

create extension if not exists "pgcrypto";

create table sessions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,               -- short join code, e.g. 6 chars
  status text not null default 'lobby',    -- lobby | active | finished
  phase text not null default 'turn' check (phase in ('turn', 'cooldown')),
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

alter table sessions enable row level security;
alter table players enable row level security;
alter table sentences enable row level security;

-- MVP: fully open policies (no auth). Tighten later if needed.
create policy "public read sessions" on sessions for select using (true);
create policy "public read players" on players for select using (true);
create policy "public read sentences" on sentences for select using (true);

-- All writes go through server-side API routes using the service role key,
-- which bypasses RLS, so no public write policies are defined.
