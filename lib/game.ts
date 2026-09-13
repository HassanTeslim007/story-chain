import { getServiceClient } from "./supabaseServer";
import { generateOpening, generateAiSentence, scoreSentence } from "./claude";
import type { Difficulty, Player, Session, SessionMode } from "./types";
import {
  COOLDOWN_SECONDS,
  MIN_TURN_SECONDS,
  MAX_TURN_SECONDS,
  ELIMINATION_SAFETY_TURN_CAP,
  MARATHON_TURN_OPTIONS,
  MAX_SENTENCE_LENGTH,
  MAX_GENRE_LENGTH,
  DIFFICULTY_OPTIONS,
} from "./constants";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function randomCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export class GameError extends Error {}

async function getSessionByCode(code: string): Promise<Session> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("sessions")
    .select("*")
    .eq("code", code.toUpperCase())
    .single();
  if (error || !data) throw new GameError("Session not found");
  return data as Session;
}

async function getPlayers(sessionId: string): Promise<Player[]> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("players")
    .select("*")
    .eq("session_id", sessionId)
    .order("turn_order", { ascending: true });
  if (error) throw new GameError(error.message);
  return (data ?? []) as Player[];
}

async function getStorySoFar(sessionId: string): Promise<string[]> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("sentences")
    .select("content")
    .eq("session_id", sessionId)
    .eq("removed", false)
    .order("turn_number", { ascending: true });
  if (error) throw new GameError(error.message);
  return (data ?? []).map((r) => r.content as string);
}

// Best-effort funnel logging (created -> started -> finished). Insert-only,
// no FK to sessions - deliberately decoupled so the cleanup job can purge
// full session/story content without touching these rows. Never let a
// logging failure break the actual game.
async function logGameEvent(
  db: ReturnType<typeof getServiceClient>,
  event: "created" | "started" | "finished" | "cancelled",
  session: Pick<Session, "code" | "mode" | "genre" | "turn_seconds">,
  extra?: { player_count?: number; end_reason?: string | null; turns_played?: number },
) {
  const { error } = await db.from("game_events").insert({
    event,
    session_code: session.code,
    mode: session.mode,
    genre: session.genre,
    turn_seconds: session.turn_seconds,
    player_count: extra?.player_count ?? null,
    end_reason: extra?.end_reason ?? null,
    turns_played: extra?.turns_played ?? null,
  });
  if (error) console.error("game_events insert failed:", error.message);
}

export function nextAlivePlayer(players: Player[], afterPlayerId: string): Player | null {
  const alive = players.filter((p) => p.is_alive);
  if (alive.length === 0) return null;
  const idx = players.findIndex((p) => p.id === afterPlayerId);
  const ordered = [...players.slice(idx + 1), ...players.slice(0, idx + 1)];
  return ordered.find((p) => p.is_alive) ?? null;
}

// Sum of each candidate's own (non-removed, scored) sentences, for the
// turn-cap ending. Ties go to whichever candidate appears earliest in
// candidateIds - callers pass players in turn_order, so ties favor whoever
// joined first.
async function topScorer(sessionId: string, candidateIds: string[]): Promise<string> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("sentences")
    .select("player_id, score")
    .eq("session_id", sessionId)
    .eq("removed", false)
    .not("score", "is", null);
  if (error) throw new GameError(error.message);

  const totals = new Map<string, number>(candidateIds.map((id) => [id, 0]));
  for (const row of data ?? []) {
    if (row.player_id && totals.has(row.player_id)) {
      totals.set(row.player_id, totals.get(row.player_id)! + (row.score as number));
    }
  }
  return candidateIds.reduce((best, id) => (totals.get(id)! > totals.get(best)! ? id : best));
}

// Pure decision of whether/why the game ends given this turn's alive-player
// set - exported so it's unit-testable without a Supabase client. Two ways
// to end: elimination reduced the field to one player, or every remaining
// player has hit the turn cap (elimination mode's safety net, or marathon's
// actual game length).
export function endReasonFor(
  session: Pick<Session, "max_turns_per_player">,
  alive: Player[],
): "elimination" | "turn_cap" | null {
  if (alive.length === 0) {
    // Exactly one player is removed per resolution out of a pool that was
    // >=2 alive, so this should be unreachable - assert rather than
    // silently finishing the game with a null winner.
    throw new GameError("Elimination left no players alive - unreachable, game state is corrupted");
  }
  if (alive.length === 1) return "elimination";
  if (alive.every((p) => p.turns_taken >= session.max_turns_per_player)) return "turn_cap";
  return null;
}

// DB-touching wrapper: turns a reason into the actual session patch, looking
// up the turn-cap winner (highest total individual score) when needed.
async function resolveEnding(session: Session, alive: Player[]): Promise<Partial<Session> | null> {
  const reason = endReasonFor(session, alive);
  if (reason === "elimination") {
    return {
      status: "finished",
      end_reason: "elimination",
      winner_player_id: alive[0].id,
      current_turn_player_id: null,
      turn_deadline: null,
      phase: "turn",
    };
  }
  if (reason === "turn_cap") {
    const winnerId = await topScorer(
      session.id,
      alive.map((p) => p.id),
    );
    return {
      status: "finished",
      end_reason: "turn_cap",
      winner_player_id: winnerId,
      current_turn_player_id: null,
      turn_deadline: null,
      phase: "turn",
    };
  }
  return null;
}

export async function createSession(
  hostName: string,
  turnSeconds: number,
  mode: SessionMode = "elimination",
  maxTurnsPerPlayer?: number,
  genre?: string | null,
  difficulty?: Difficulty | null,
) {
  const db = getServiceClient();

  // Clamp server-side - the UI enforces this range too, but requests can
  // bypass the client, so the authoritative bound has to live here.
  const seconds = Math.min(MAX_TURN_SECONDS, Math.max(MIN_TURN_SECONDS, Math.floor(turnSeconds) || 30));
  const resolvedMode: SessionMode = mode === "marathon" ? "marathon" : "elimination";
  const maxTurns =
    resolvedMode === "marathon"
      ? MARATHON_TURN_OPTIONS.includes(maxTurnsPerPlayer ?? -1)
        ? (maxTurnsPerPlayer as number)
        : MARATHON_TURN_OPTIONS[0]
      : ELIMINATION_SAFETY_TURN_CAP;
  const resolvedGenre = genre?.trim() ? genre.trim().slice(0, MAX_GENRE_LENGTH) : null;

  let code = randomCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing } = await db
      .from("sessions")
      .select("id")
      .eq("code", code)
      .maybeSingle();
    if (!existing) break;
    code = randomCode();
  }

  const { data: session, error: sessionError } = await db
    .from("sessions")
    .insert({
      code,
      turn_seconds: seconds,
      mode: resolvedMode,
      max_turns_per_player: maxTurns,
      genre: resolvedGenre,
      ai_difficulty: difficulty ?? null,
    })
    .select("*")
    .single();
  if (sessionError || !session) throw new GameError(sessionError?.message ?? "Could not create session");

  const { data: player, error: playerError } = await db
    .from("players")
    .insert({ session_id: session.id, name: hostName, turn_order: 0 })
    .select("*")
    .single();
  if (playerError || !player) throw new GameError(playerError?.message ?? "Could not create player");

  await logGameEvent(db, "created", session as Session);

  return { session: session as Session, player: player as Player };
}

// Solo vs AI: only Marathon applies (no elimination pressure against an
// opponent that can't be "out"), so mode is forced regardless of what's
// passed in. Creates the session, seats the AI as a second player, and
// starts the game immediately - there's no lobby to wait in when the
// opponent is already there.
export async function createSoloGame(
  hostName: string,
  turnSeconds: number,
  maxTurnsPerPlayer: number | undefined,
  genre: string | null | undefined,
  difficulty: string | undefined,
) {
  const db = getServiceClient();
  const resolvedDifficulty: Difficulty = (DIFFICULTY_OPTIONS as readonly string[]).includes(difficulty ?? "")
    ? (difficulty as Difficulty)
    : "normal";

  const { session, player } = await createSession(
    hostName,
    turnSeconds,
    "marathon",
    maxTurnsPerPlayer,
    genre,
    resolvedDifficulty,
  );

  const { error: aiError } = await db
    .from("players")
    .insert({ session_id: session.id, name: "AI", turn_order: 1, is_ai: true });
  if (aiError) throw new GameError(aiError.message);

  await startGame(session.code);
  const startedSession = await getSessionByCode(session.code);

  return { session: startedSession, player };
}

// Triggered by the human's own client when it notices (via Realtime) that
// the AI holds the current turn - there's no server-side cron in this app,
// so whoever's watching the game kicks it off. Writing and scoring stay
// fully decoupled: the AI's line goes through the exact same submitSentence
// path as a human's, so turn rotation, the turn cap, and cooldown all just
// work without any AI-specific branching there.
export async function resolveAiTurn(code: string) {
  const session = await getSessionByCode(code);
  if (session.status !== "active" || session.phase !== "turn") {
    return { advanced: false };
  }
  const players = await getPlayers(session.id);
  const current = players.find((p) => p.id === session.current_turn_player_id);
  if (!current?.is_ai) {
    return { advanced: false };
  }

  const storySoFar = await getStorySoFar(session.id);
  const sentence = await generateAiSentence(storySoFar, session.ai_difficulty ?? "normal");
  await submitSentence(code, current.id, sentence);
  return { advanced: true };
}

// Only the creator (turn_order 0) can cancel, and only before anyone else
// has joined - once a second player is in the lobby, the game belongs to
// the group, not just the host. Deletes the session outright (cascades to
// the host's own player row) rather than adding a "cancelled" session
// status - consistent with the no-history design, nothing to show for a
// game that never started.
export async function cancelSession(code: string, playerId: string) {
  const db = getServiceClient();
  const session = await getSessionByCode(code);
  if (session.status !== "lobby") throw new GameError("Game already started");

  const players = await getPlayers(session.id);
  const host = players.find((p) => p.turn_order === 0);
  if (!host || host.id !== playerId) throw new GameError("Only the creator can cancel this game");
  if (players.length > 1) throw new GameError("Other players have already joined");

  await logGameEvent(db, "cancelled", session);

  const { error } = await db.from("sessions").delete().eq("id", session.id);
  if (error) throw new GameError(error.message);
}

export async function joinSession(code: string, name: string) {
  const db = getServiceClient();
  const session = await getSessionByCode(code);
  if (session.status !== "lobby") throw new GameError("Game already started");

  const players = await getPlayers(session.id);
  const { data: player, error } = await db
    .from("players")
    .insert({ session_id: session.id, name, turn_order: players.length })
    .select("*")
    .single();
  if (error || !player) throw new GameError(error?.message ?? "Could not join session");

  return { session, player: player as Player };
}

export async function startGame(code: string) {
  const db = getServiceClient();
  const session = await getSessionByCode(code);
  if (session.status !== "lobby") throw new GameError("Game already started");

  const players = await getPlayers(session.id);
  if (players.length < 2) throw new GameError("Need at least 2 players to start");

  const opening = await generateOpening(session.genre);
  const { error: sentenceError } = await db.from("sentences").insert({
    session_id: session.id,
    player_id: null,
    turn_number: 0,
    content: opening.join(" "),
    score: null,
  });
  if (sentenceError) throw new GameError(sentenceError.message);

  const first = players[0];
  // Cooldown before the first turn too, so everyone has time to read the
  // opening before the timer starts - same as between every later turn.
  const deadline = new Date(Date.now() + COOLDOWN_SECONDS * 1000).toISOString();

  const { error: updateError } = await db
    .from("sessions")
    .update({
      status: "active",
      phase: "cooldown",
      current_turn_player_id: first.id,
      turn_number: 1,
      turn_deadline: deadline,
    })
    .eq("id", session.id)
    .eq("status", "lobby");
  if (updateError) throw new GameError(updateError.message);

  await logGameEvent(db, "started", session, { player_count: players.length });
}

export async function submitSentence(code: string, playerId: string, content: string) {
  const db = getServiceClient();
  const session = await getSessionByCode(code);

  if (session.status !== "active") throw new GameError("Game is not active");
  if (session.phase !== "turn") throw new GameError("Next turn hasn't started yet");
  if (session.current_turn_player_id !== playerId) throw new GameError("It's not your turn");
  if (session.turn_deadline && new Date(session.turn_deadline).getTime() < Date.now()) {
    throw new GameError("Turn already expired");
  }
  const trimmed = content.trim();
  if (!trimmed) throw new GameError("Sentence cannot be empty");
  if (trimmed.length > MAX_SENTENCE_LENGTH) {
    throw new GameError(`Keep it to one sentence - ${MAX_SENTENCE_LENGTH} characters max`);
  }

  // Claim the turn before calling the judge, not after. Scoring can take a
  // few seconds - without this, a submit that lands right before the
  // deadline can still lose the race to a concurrent checkTimeout poll that
  // fires while the judge is thinking, eliminating a player who actually
  // submitted in time. Flipping to "judging" here makes checkTimeout back
  // off entirely (see below) for as long as this takes - the time left is
  // effectively frozen, not still running out underneath the judge call.
  const { data: claimedRows, error: claimError } = await db
    .from("sessions")
    .update({ phase: "judging" })
    .eq("id", session.id)
    .eq("current_turn_player_id", playerId)
    .eq("status", "active")
    .eq("phase", "turn")
    .select("id");
  if (claimError) throw new GameError(claimError.message);
  if (!claimedRows || claimedRows.length === 0) {
    throw new GameError("Turn already expired");
  }

  // Everything from here on can throw (the judge call, DB writes,
  // resolveEnding's own query) while the session sits claimed in "judging".
  // Nothing else can ever move a session out of "judging" - not checkTimeout
  // (it explicitly no-ops there), not another submit (phase!=="turn" is
  // rejected above) - so if this throws without reverting, the game is
  // permanently stuck: no turn can ever be submitted or timed out again.
  try {
    const storySoFar = await getStorySoFar(session.id);
    const { score, reasoning } = await scoreSentence(storySoFar, trimmed);

    const { data: inserted, error: insertError } = await db
      .from("sentences")
      .insert({
        session_id: session.id,
        player_id: playerId,
        turn_number: session.turn_number,
        content: trimmed,
        score,
        reasoning,
      })
      .select("*")
      .single();
    if (insertError || !inserted) throw new GameError(insertError?.message ?? "Could not save sentence");

    // Compute this turn's effect on player state in memory only for now -
    // don't write turns_taken/is_alive until the guarded session update below
    // confirms this turn actually stuck. Otherwise a concurrent timeout that
    // wins the race leaves this player over-counted or wrongly eliminated,
    // with only the sentence rolled back.
    const players = await getPlayers(session.id);
    const submitter = players.find((p) => p.id === playerId)!;
    submitter.turns_taken += 1;

    const newTotal = session.total_score + score;
    const newCount = session.score_count + 1;
    const avg = newTotal / newCount;
    // Marathon mode has no score-based elimination - the turn cap is its only
    // ending, handled by resolveEnding below.
    const eliminated = session.mode === "elimination" && avg < 50;
    if (eliminated) submitter.is_alive = false;

    const finalTotal = eliminated ? session.total_score : newTotal;
    const finalCount = eliminated ? session.score_count : newCount;

    const alive = players.filter((p) => p.is_alive);
    const ending = await resolveEnding(session, alive);

    const patch: Partial<Session> = {
      total_score: finalTotal,
      score_count: finalCount,
      ...(ending ?? {
        current_turn_player_id: nextAlivePlayer(players, playerId)!.id,
        turn_number: session.turn_number + 1,
        phase: "cooldown",
        turn_deadline: new Date(Date.now() + COOLDOWN_SECONDS * 1000).toISOString(),
      }),
    };

    // Guarded update: this only fails now if the claim above somehow didn't
    // stick (it should always be exclusive - nothing else can flip phase away
    // from "judging" once claimed), kept as a defensive check rather than an
    // expected race.
    const { data: updatedRows, error: updateError } = await db
      .from("sessions")
      .update(patch)
      .eq("id", session.id)
      .eq("current_turn_player_id", playerId)
      .eq("status", "active")
      .eq("phase", "judging")
      .select("id");
    if (updateError) throw new GameError(updateError.message);
    if (!updatedRows || updatedRows.length === 0) {
      // Someone else's timeout check already advanced this turn - undo our
      // score's effect on the story so it doesn't linger as a phantom entry.
      // turns_taken/is_alive were never written, so there's nothing else to
      // roll back.
      await db.from("sentences").update({ removed: true }).eq("id", inserted.id);
      throw new GameError("Turn already expired");
    }

    // Session update stuck - now it's safe to persist the player-side effects.
    await db.from("players").update({ turns_taken: submitter.turns_taken }).eq("id", playerId);
    if (eliminated) {
      await db.from("sentences").update({ removed: true }).eq("id", inserted.id);
      await db.from("players").update({ is_alive: false }).eq("id", playerId);
    }

    if (ending) {
      await logGameEvent(db, "finished", session, {
        player_count: players.length,
        end_reason: ending.end_reason ?? null,
        turns_played: session.turn_number,
      });
    }

    return { score, reasoning, eliminated };
  } catch (err) {
    // Best-effort: hand the turn back rather than leave it stuck. Guarded so
    // this can't clobber a state that already moved on for some other
    // reason - if the row isn't still exactly what we claimed, do nothing.
    await db
      .from("sessions")
      .update({ phase: "turn" })
      .eq("id", session.id)
      .eq("current_turn_player_id", playerId)
      .eq("phase", "judging")
      .then(({ error }) => {
        if (error) console.error("Failed to revert stuck judging phase:", error.message);
      });
    throw err;
  }
}

export async function checkTimeout(code: string) {
  const db = getServiceClient();
  const session = await getSessionByCode(code);
  if (session.status !== "active" || !session.current_turn_player_id || !session.turn_deadline) {
    return { advanced: false };
  }
  // A submit has claimed this turn and is waiting on the judge - the time
  // left is frozen for as long as that takes. submitSentence is the only
  // thing that moves a session out of "judging", so there's nothing for a
  // timeout to do here regardless of how long the stored deadline says.
  if (session.phase === "judging") {
    return { advanced: false };
  }
  if (new Date(session.turn_deadline).getTime() > Date.now()) {
    return { advanced: false };
  }

  if (session.phase === "cooldown") {
    // Cooldown elapsed - open the next player's turn. No elimination here.
    const { data: updatedRows, error } = await db
      .from("sessions")
      .update({
        phase: "turn",
        turn_deadline: new Date(Date.now() + session.turn_seconds * 1000).toISOString(),
      })
      .eq("id", session.id)
      .eq("phase", "cooldown")
      .eq("turn_number", session.turn_number)
      .eq("status", "active")
      .select("id");
    if (error) throw new GameError(error.message);
    return { advanced: (updatedRows?.length ?? 0) > 0 };
  }

  // A missed turn always eliminates, in both modes - it's an anti-stall
  // safeguard against an AFK player, distinct from marathon's "no scoring
  // pressure" pitch (which only covers the avg<50 elimination check above).
  const expiredPlayerId = session.current_turn_player_id;
  const players = await getPlayers(session.id);
  const updatedPlayers = players.map((p) =>
    p.id === expiredPlayerId ? { ...p, is_alive: false } : p,
  );
  const alive = updatedPlayers.filter((p) => p.is_alive);
  const ending = await resolveEnding(session, alive);

  const patch: Partial<Session> =
    ending ?? {
      current_turn_player_id: nextAlivePlayer(updatedPlayers, expiredPlayerId)!.id,
      turn_number: session.turn_number + 1,
      phase: "cooldown",
      turn_deadline: new Date(Date.now() + COOLDOWN_SECONDS * 1000).toISOString(),
    };

  // Guarded update: atomically claim the timeout before touching player
  // state, so a submit that lands at the same instant can't be undone by us.
  const { data: updatedRows, error } = await db
    .from("sessions")
    .update(patch)
    .eq("id", session.id)
    .eq("current_turn_player_id", expiredPlayerId)
    .eq("status", "active")
    .eq("phase", "turn")
    .select("id");
  if (error) throw new GameError(error.message);
  if (!updatedRows || updatedRows.length === 0) {
    // Someone else already handled this timeout (or a submit beat us to it).
    return { advanced: false };
  }

  await db.from("players").update({ is_alive: false }).eq("id", expiredPlayerId);

  if (ending) {
    await logGameEvent(db, "finished", session, {
      player_count: players.length,
      end_reason: ending.end_reason ?? null,
      turns_played: session.turn_number,
    });
  }

  return { advanced: true };
}
