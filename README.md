# Story Chain

AI-judged collaborative story game. Players take turns adding one sentence to a
story; Claude scores each sentence 0-100 for coherence, creativity, and
grammar. If a player's sentence drags the game's running average score below
50, they're eliminated and their sentence is removed. Last writer standing
wins.

## Setup

1. **Supabase project.** Create one at [supabase.com](https://supabase.com),
   then run [`schema.sql`](./schema.sql) in the SQL editor to create the
   `sessions`, `players`, and `sentences` tables. Enable Realtime on all three
   tables (Database → Replication).
2. **Env vars.** Copy `.env.local.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Project
     Settings → API.
   - `SUPABASE_SERVICE_ROLE_KEY` — same page (server-only, never expose to the
     client).
   - `OPENROUTER_API_KEY` — from [openrouter.ai](https://openrouter.ai/keys).
3. **Run it:**
   ```bash
   npm install
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## How it works

- **Create/join** — `app/page.tsx`. Each browser stores its player id for the
  session in `localStorage` (`lib/identity.ts`) — no auth.
- **Game engine** — `lib/game.ts` holds all state transitions (create, join,
  start, submit sentence, timeout) and runs server-side only, using the
  Supabase service-role client so it can bypass RLS.
- **AI** — `lib/claude.ts` calls GPT-4o via OpenRouter twice per game turn:
  once to generate the opening (on start), once per submitted sentence to
  score it. Both use structured outputs (Zod schema → JSON schema) so the
  response is always valid JSON.
- **Live sync** — the game room (`app/session/[code]/page.tsx`) subscribes to
  Postgres changes on `sessions`/`players`/`sentences` via Supabase Realtime,
  so every connected browser re-renders as soon as any player acts.
- **Turn timer** — enforced server-side. `turn_deadline` lives on the
  `sessions` row; each client counts down locally from it, and whichever
  client's countdown hits zero first calls `POST /api/session/[code]/timeout`,
  which is idempotent and only takes effect if that turn hasn't already been
  resolved.
- **Average score / elimination** — `sessions.total_score` /
  `sessions.score_count` track a running average across all *currently
  counted* sentences. If a new score drops the average below 50, that
  player's sentence is marked `removed` and excluded from the running total
  going forward (as if it never happened), and the player is eliminated.

## Known rough edges (fine for a prototype, worth hardening later)

- Race handling between a last-second submit and a timeout firing is
  best-effort (guarded DB updates, not a transaction) — fine for casual play,
  not bulletproof under adversarial timing.
- No reconnect/rejoin flow if a player clears `localStorage` mid-game.
- `npx eslint .` currently fails in this environment due to a broken
  `@babel/core` resolution unrelated to this project's code (`next build`
  compiles and type-checks cleanly) — try a clean `node_modules` reinstall if
  you want lint working locally.
