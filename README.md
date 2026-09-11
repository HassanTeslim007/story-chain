# Story Chain

AI-judged collaborative story game. Players take turns adding one sentence to a
story; the judge model scores each sentence 0-100 for coherence, creativity,
and grammar. Two modes, chosen when the game is created:

- **Elimination** — sudden death. If a player's sentence drags the game's
  running average score below 50, they're eliminated and their sentence is
  removed. Last writer standing wins. A generous turn cap
  (`ELIMINATION_SAFETY_TURN_CAP` in `lib/constants.ts`) is a safety net in
  case nobody ever trips the average — if it's reached with more than one
  player left, the game ends and ranks by each player's own total score.
- **Marathon** — no elimination. Everyone writes the same number of turns
  (host-chosen), then the game ends and the highest total individual score
  wins.

In both modes, missing your turn's deadline always eliminates you — that's an
anti-stall rule, not scoring pressure, so it applies in Marathon too.

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
   - `DEEPSEEK_API_KEY` — from [platform.deepseek.com](https://platform.deepseek.com/api_keys).
3. **Run it:**
   ```bash
   npm install
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## How it works

- **Create/join** — `app/page.tsx`. Each *tab* stores its player id for the
  session in `sessionStorage` (`lib/identity.ts`) — no auth. Deliberately
  per-tab, not per-browser: a host and a participant open in two tabs of the
  same browser must not clobber each other's identity, which `localStorage`
  (shared across tabs) would do.
- **Game engine** — `lib/game.ts` holds all state transitions (create, join,
  start, submit sentence, timeout) and runs server-side only, using the
  Supabase service-role client so it can bypass RLS.
- **AI** — `lib/claude.ts` calls DeepSeek (`deepseek-flash`) twice per game
  turn: once to generate the opening (on start), once per submitted sentence
  to score it. DeepSeek's JSON mode has no schema enforcement (`json_object`
  only, not OpenAI-style strict `json_schema`), so the shape is spelled out
  in the prompt and validated against the Zod schema on the way back, with
  one retry if it comes back malformed.
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
  counted* sentences. In Elimination mode, if a new score drops the average
  below 50, that player's sentence is marked `removed` and excluded from the
  running total going forward (as if it never happened), and the player is
  eliminated. Marathon mode never does this — it only ends by turn cap.
- **Turn cap / game end** — `sessions.max_turns_per_player` and each player's
  `turns_taken` decide when a non-elimination ending fires: once every alive
  player has taken that many turns, `resolveEnding` in `lib/game.ts` ends the
  game with `end_reason: 'turn_cap'` and ranks by summed individual sentence
  scores. Ending by a single survivor instead sets `end_reason: 'elimination'`.

## Known rough edges (fine for a prototype, worth hardening later)

- Race handling between a last-second submit and a timeout firing is
  best-effort (guarded DB updates, not a transaction) — fine for casual play,
  not bulletproof under adversarial timing.
- No reconnect/rejoin flow if a player closes their tab (or clears
  `sessionStorage`) mid-game.
- `npx eslint .` currently fails in this environment due to a broken
  `@babel/core` resolution unrelated to this project's code (`next build`
  compiles and type-checks cleanly) — try a clean `node_modules` reinstall if
  you want lint working locally.
