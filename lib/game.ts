import { getServiceClient } from "./supabaseServer";
import { generateOpening, scoreSentence } from "./claude";
import type { Player, Session, SessionMode } from "./types";
import {
  COOLDOWN_SECONDS,
  MIN_TURN_SECONDS,
  MAX_TURN_SECONDS,
  ELIMINATION_SAFETY_TURN_CAP,
  MARATHON_TURN_OPTIONS,
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

function nextAlivePlayer(players: Player[], afterPlayerId: string): Player | null {
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

// Decides whether the game ends given this turn's alive-player set, or
// returns null to continue to the next turn. Two ways to end: elimination
// reduced the field to one player, or every remaining player has hit the
// turn cap (elimination mode's safety net, or marathon's actual game
// length) - in which case the highest total individual score wins.
async function resolveEnding(session: Session, alive: Player[]): Promise<Partial<Session> | null> {
  if (alive.length === 0) {
    // Exactly one player is removed per resolution out of a pool that was
    // >=2 alive, so this should be unreachable - assert rather than
    // silently finishing the game with a null winner.
    throw new GameError("Elimination left no players alive - unreachable, game state is corrupted");
  }
  if (alive.length === 1) {
    return {
      status: "finished",
      end_reason: "elimination",
      winner_player_id: alive[0].id,
      current_turn_player_id: null,
      turn_deadline: null,
      phase: "turn",
    };
  }
  if (alive.every((p) => p.turns_taken >= session.max_turns_per_player)) {
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
    .insert({ code, turn_seconds: seconds, mode: resolvedMode, max_turns_per_player: maxTurns })
    .select("*")
    .single();
  if (sessionError || !session) throw new GameError(sessionError?.message ?? "Could not create session");

  const { data: player, error: playerError } = await db
    .from("players")
    .insert({ session_id: session.id, name: hostName, turn_order: 0 })
    .select("*")
    .single();
  if (playerError || !player) throw new GameError(playerError?.message ?? "Could not create player");

  return { session: session as Session, player: player as Player };
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

  const opening = await generateOpening();
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

  const { data: sentenceRows, error: storyError } = await db
    .from("sentences")
    .select("content")
    .eq("session_id", session.id)
    .eq("removed", false)
    .order("turn_number", { ascending: true });
  if (storyError) throw new GameError(storyError.message);
  const storySoFar = (sentenceRows ?? []).map((r) => r.content as string);

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

  const players = await getPlayers(session.id);
  const submitter = players.find((p) => p.id === playerId)!;
  submitter.turns_taken += 1;
  await db.from("players").update({ turns_taken: submitter.turns_taken }).eq("id", playerId);

  const newTotal = session.total_score + score;
  const newCount = session.score_count + 1;
  const avg = newTotal / newCount;
  // Marathon mode has no score-based elimination - the turn cap is its only
  // ending, handled by resolveEnding below.
  const eliminated = session.mode === "elimination" && avg < 50;

  if (eliminated) {
    await db.from("sentences").update({ removed: true }).eq("id", inserted.id);
    await db.from("players").update({ is_alive: false }).eq("id", playerId);
    submitter.is_alive = false;
  }

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

  // Guarded update: only apply if this turn hasn't already been resolved
  // by a concurrent timeout call.
  const { data: updatedRows, error: updateError } = await db
    .from("sessions")
    .update(patch)
    .eq("id", session.id)
    .eq("current_turn_player_id", playerId)
    .eq("status", "active")
    .eq("phase", "turn")
    .select("id");
  if (updateError) throw new GameError(updateError.message);
  if (!updatedRows || updatedRows.length === 0) {
    // Someone else's timeout check already advanced this turn - undo our
    // score's effect on the story so it doesn't linger as a phantom entry.
    await db.from("sentences").update({ removed: true }).eq("id", inserted.id);
    throw new GameError("Turn already expired");
  }

  return { score, reasoning, eliminated };
}

export async function checkTimeout(code: string) {
  const db = getServiceClient();
  const session = await getSessionByCode(code);
  if (session.status !== "active" || !session.current_turn_player_id || !session.turn_deadline) {
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
  return { advanced: true };
}
