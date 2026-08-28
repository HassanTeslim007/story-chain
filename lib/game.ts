import { getServiceClient } from "./supabaseServer";
import { generateOpening, scoreSentence } from "./claude";
import type { Player, Session } from "./types";

import { COOLDOWN_SECONDS, MIN_TURN_SECONDS, MAX_TURN_SECONDS } from "./constants";

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

export async function createSession(hostName: string, turnSeconds: number) {
  const db = getServiceClient();

  // Clamp server-side - the UI enforces this range too, but requests can
  // bypass the client, so the authoritative bound has to live here.
  const seconds = Math.min(MAX_TURN_SECONDS, Math.max(MIN_TURN_SECONDS, Math.floor(turnSeconds) || 30));

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
    .insert({ code, turn_seconds: seconds })
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
  const newTotal = session.total_score + score;
  const newCount = session.score_count + 1;
  const avg = newTotal / newCount;
  const eliminated = avg < 50;

  if (eliminated) {
    await db.from("sentences").update({ removed: true }).eq("id", inserted.id);
    await db.from("players").update({ is_alive: false }).eq("id", playerId);
    players.find((p) => p.id === playerId)!.is_alive = false;
  }

  const finalTotal = eliminated ? session.total_score : newTotal;
  const finalCount = eliminated ? session.score_count : newCount;

  const alive = players.filter((p) => p.is_alive);

  const patch: Partial<Session> = {
    total_score: finalTotal,
    score_count: finalCount,
  };

  if (alive.length <= 1) {
    // Exactly one player is eliminated per resolution out of a pool that was
    // >=2 alive, so alive.length should always land on 1, never 0. Assert it
    // rather than silently finishing the game with a null winner.
    if (alive.length === 0) {
      throw new GameError("Elimination left no players alive - unreachable, game state is corrupted");
    }
    patch.status = "finished";
    patch.winner_player_id = alive[0].id;
    patch.current_turn_player_id = null;
    patch.turn_deadline = null;
  } else {
    const next = nextAlivePlayer(players, playerId);
    patch.current_turn_player_id = next!.id;
    patch.turn_number = session.turn_number + 1;
    patch.phase = "cooldown";
    patch.turn_deadline = new Date(Date.now() + COOLDOWN_SECONDS * 1000).toISOString();
  }

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

  const expiredPlayerId = session.current_turn_player_id;
  const players = await getPlayers(session.id);
  const updatedPlayers = players.map((p) =>
    p.id === expiredPlayerId ? { ...p, is_alive: false } : p,
  );
  const alive = updatedPlayers.filter((p) => p.is_alive);
  const patch: Partial<Session> = {};

  if (alive.length <= 1) {
    if (alive.length === 0) {
      throw new GameError("Elimination left no players alive - unreachable, game state is corrupted");
    }
    patch.status = "finished";
    patch.winner_player_id = alive[0].id;
    patch.current_turn_player_id = null;
    patch.turn_deadline = null;
  } else {
    const next = nextAlivePlayer(updatedPlayers, expiredPlayerId);
    patch.current_turn_player_id = next!.id;
    patch.turn_number = session.turn_number + 1;
    patch.phase = "cooldown";
    patch.turn_deadline = new Date(Date.now() + COOLDOWN_SECONDS * 1000).toISOString();
  }

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
