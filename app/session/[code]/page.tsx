"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { getPlayerIdentity, savePlayerIdentity } from "@/lib/identity";
import { COOLDOWN_SECONDS } from "@/lib/constants";
import { useGameSounds } from "@/lib/useGameSounds";
import type { Player, Sentence, Session } from "@/lib/types";
import Avatar from "@/components/Avatar";
import CountdownBar from "@/components/CountdownBar";
import ScoreChart from "@/components/ScoreChart";
import Toasts, { type Toast } from "@/components/Toasts";
import { ThemeCycleButton } from "@/components/ThemePicker";

function scoreColor(score: number | null): string {
  if (score === null) return "text-neutral-500";
  if (score >= 70) return "text-emerald-500";
  if (score >= 50) return "text-amber-500";
  return "text-red-500";
}

export default function SessionPage() {
  const params = useParams() as { code: string };
  const router = useRouter();
  const code = params.code.toUpperCase();
  const sounds = useGameSounds();

  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [joinName, setJoinName] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [storyCopied, setStoryCopied] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    setPlayerId(getPlayerIdentity(code));
  }, [code]);

  const knownPlayerIds = useRef<Set<string> | null>(null);
  const pushToast = useCallback((message: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  const fetchState = useCallback(async () => {
    const { data: sessionRow } = await supabase.from("sessions").select("*").eq("code", code).single();
    if (!sessionRow) {
      setLoaded(true);
      return;
    }
    setSession(sessionRow as Session);
    const [{ data: playerRows }, { data: sentenceRows }] = await Promise.all([
      supabase.from("players").select("*").eq("session_id", sessionRow.id).order("turn_order"),
      supabase.from("sentences").select("*").eq("session_id", sessionRow.id).order("turn_number"),
    ]);
    const rows = (playerRows ?? []) as Player[];

    if (knownPlayerIds.current === null) {
      knownPlayerIds.current = new Set(rows.map((p) => p.id));
    } else {
      for (const p of rows) {
        if (!knownPlayerIds.current.has(p.id)) {
          knownPlayerIds.current.add(p.id);
          pushToast(`${p.name} joined`);
        }
      }
    }

    setPlayers(rows);
    setSentences((sentenceRows ?? []) as Sentence[]);
    setLoaded(true);
  }, [code, pushToast]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel(`session-${session.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions", filter: `id=eq.${session.id}` },
        fetchState,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `session_id=eq.${session.id}` },
        fetchState,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sentences", filter: `session_id=eq.${session.id}` },
        fetchState,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.id, fetchState]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const secondsLeft = useMemo(() => {
    if (!session?.turn_deadline) return null;
    return Math.max(0, Math.ceil((new Date(session.turn_deadline).getTime() - now) / 1000));
  }, [session?.turn_deadline, now]);

  const timeoutFiredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!session || session.status !== "active" || secondsLeft === null) return;
    if (secondsLeft > 0) return;
    const key = `${session.current_turn_player_id}-${session.turn_number}-${session.phase}`;
    if (timeoutFiredFor.current === key) return;
    timeoutFiredFor.current = key;
    fetch(`/api/session/${code}/timeout`, { method: "POST" }).then(fetchState);
  }, [secondsLeft, session, code, fetchState]);

  const me = players.find((p) => p.id === playerId) ?? null;
  const isMyTurn = session?.status === "active" && session.phase === "turn" && session.current_turn_player_id === playerId;
  const isNextUpMe = session?.status === "active" && session.phase === "cooldown" && session.current_turn_player_id === playerId;

  const prevIsMyTurn = useRef(false);
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurn.current) sounds.play("turn");
    prevIsMyTurn.current = isMyTurn;
  }, [isMyTurn, sounds]);

  const prevAliveIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const aliveIds = new Set(players.filter((p) => p.is_alive).map((p) => p.id));
    if (prevAliveIds.current) {
      for (const id of prevAliveIds.current) {
        if (!aliveIds.has(id) && id === playerId) sounds.play("elimination");
      }
    }
    prevAliveIds.current = aliveIds;
  }, [players, playerId, sounds]);

  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (session?.status === "finished" && prevStatus.current !== "finished" && session.winner_player_id === playerId) {
      sounds.play("win");
    }
    prevStatus.current = session?.status;
  }, [session?.status, session?.winner_player_id, playerId, sounds]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/session/${code}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: joinName }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    savePlayerIdentity(code, data.player.id);
    setPlayerId(data.player.id);
    fetchState();
  }

  async function handleStart() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/session/${code}/start`, { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) setError(data.error);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!playerId) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/session/${code}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, content: draft }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setDraft("");
  }

  const [rematchBusy, setRematchBusy] = useState(false);
  async function handlePlayAgain() {
    if (!me) return;
    setRematchBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostName: me.name, turnSeconds: session!.turn_seconds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      savePlayerIdentity(data.session.code, data.player.id);
      router.push(`/session/${data.session.code}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRematchBusy(false);
    }
  }

  async function handleCopyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function storyText(): string {
    const body = sentences
      .filter((s) => !s.removed)
      .sort((a, b) => a.turn_number - b.turn_number)
      .map((s) => s.content)
      .join(" ");
    return `Story Chain — ${code}\n\n${body}\n`;
  }

  async function handleCopyStory() {
    await navigator.clipboard.writeText(storyText());
    setStoryCopied(true);
    setTimeout(() => setStoryCopied(false), 1500);
  }

  function handleDownloadStory() {
    const blob = new Blob([storyText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `story-chain-${code}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (loaded && !session) {
    return (
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <p className="text-lg font-medium">Game not found</p>
          <p className="text-sm text-neutral-500">
            Code <span className="font-mono">{code}</span> doesn&apos;t match any game.
          </p>
          <a href="/" className="inline-block text-sm underline" style={{ color: "var(--accent)" }}>
            Back home
          </a>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="flex-1 max-w-2xl w-full mx-auto p-6 space-y-6">
        <div className="animate-pulse-soft space-y-6">
          <div className="h-6 w-40 rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-20 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-32 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
        </div>
      </main>
    );
  }

  const storySentences = sentences.filter((s) => !s.removed);
  const avg = session.score_count > 0 ? session.total_score / session.score_count : null;
  const currentPlayer = players.find((p) => p.id === session.current_turn_player_id);
  const winner = players.find((p) => p.id === session.winner_player_id);
  const lastTurn = [...sentences]
    .filter((s) => s.player_id !== null)
    .sort((a, b) => b.turn_number - a.turn_number)[0];
  const lastTurnPlayer = lastTurn ? players.find((p) => p.id === lastTurn.player_id) : undefined;

  const eliminatedPlayers = players.filter((p) => !p.is_alive);

  function playerName(id: string | null): string {
    if (id === null) return "AI opening";
    return players.find((p) => p.id === id)?.name ?? "Unknown";
  }

  return (
    <main className="flex-1 max-w-2xl w-full mx-auto p-6 space-y-6">
      <Toasts toasts={toasts} />

      <header className="flex items-center justify-between">
        <h1 className="wordmark text-xl">Story Chain</h1>
        <div className="flex items-center gap-2">
          <Link href="/" className="btn-icon" title="Back home">
            🏠
          </Link>
          <ThemeCycleButton />
          <button onClick={sounds.toggleMuted} className="btn-icon" title={sounds.muted ? "Unmute" : "Mute"}>
            {sounds.muted ? "🔇" : "🔊"}
          </button>
          <button onClick={handleCopyLink} className="btn-icon font-mono tracking-widest">
            {copied ? "Copied!" : code}
          </button>
        </div>
      </header>

      {!me && session.status === "lobby" && (
        <form onSubmit={handleJoin} className="flex gap-2">
          <input
            className="field flex-1"
            placeholder="Your name"
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
            required
          />
          <button className="btn-primary">Join</button>
        </form>
      )}

      <section className="card p-4 space-y-2">
        <h2 className="section-label">
          Players {avg !== null && `· avg score ${avg.toFixed(1)}`}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {players.map((p) => (
            <li
              key={p.id}
              className={`flex items-center gap-1.5 text-sm pl-1.5 pr-2.5 py-1 rounded-full border ${
                !p.is_alive
                  ? "opacity-40 border-[var(--border)]"
                  : p.id === session.current_turn_player_id
                    ? session.phase === "turn"
                      ? "border-emerald-500 turn-spotlight"
                      : "border-amber-500"
                    : "border-[var(--border)]"
              }`}
            >
              <Avatar name={p.name} size={20} faded={!p.is_alive} />
              <span className={!p.is_alive ? "line-through" : ""}>{p.name}</span>
              {p.id === playerId && " (you)"}
            </li>
          ))}
        </ul>
      </section>

      {session.status === "lobby" && (
        <section className="text-center space-y-3">
          <p className="text-sm opacity-60">
            Share code <span className="font-mono font-bold">{code}</span> with friends.
          </p>
          {me && (
            <button onClick={handleStart} disabled={busy || players.length < 2} className="btn-primary">
              {players.length < 2 ? "Waiting for players..." : "Start game"}
            </button>
          )}
        </section>
      )}

      {session.status !== "lobby" && (
        <section className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="section-label">The story</h2>
              <div className="flex items-center gap-1.5">
                <button onClick={handleCopyStory} className="btn-icon" title="Copy story text">
                  {storyCopied ? "Copied!" : "📋 Copy"}
                </button>
                <button onClick={handleDownloadStory} className="btn-icon" title="Download as .txt">
                  ⬇ Download
                </button>
              </div>
            </div>
            <div className="leading-relaxed" style={{ fontFamily: "var(--font-story)" }}>
              {storySentences.map((s, i) => (
                <span key={s.id} className={i === storySentences.length - 1 ? "animate-sentence-in" : ""}>
                  {s.content}{" "}
                </span>
              ))}
            </div>
          </div>

          {lastTurn && (
            <div className="card p-4 space-y-1">
              <h2 className="section-label">Judge&apos;s verdict</h2>
              <div className="flex items-center gap-2">
                <Avatar name={lastTurnPlayer?.name ?? "?"} size={22} />
                <span className="text-sm font-medium">{lastTurnPlayer?.name ?? "Unknown"}</span>
                <span className={`ml-auto text-lg font-bold ${scoreColor(lastTurn.score)}`}>{lastTurn.score}</span>
              </div>
              {lastTurn.reasoning && <p className="text-sm opacity-70">{lastTurn.reasoning}</p>}
              {lastTurn.removed && (
                <p className="text-xs text-red-500 font-medium">
                  Average dropped below 50 — this sentence was removed and {lastTurnPlayer?.name ?? "the player"} is
                  eliminated.
                </p>
              )}
            </div>
          )}

          {sentences.some((s) => s.turn_number > 0) && (
            <div className="card p-4">
              <h2 className="section-label mb-2">Average score over time</h2>
              <ScoreChart sentences={sentences} playerName={playerName} />
            </div>
          )}

          {eliminatedPlayers.length > 0 && (
            <div className="card p-4 space-y-3">
              <h2 className="section-label">Eliminated</h2>
              {eliminatedPlayers.map((p) => {
                const finalSentence = sentences.find((s) => s.player_id === p.id && s.removed);
                return (
                  <div key={p.id} className="flex gap-2">
                    <Avatar name={p.name} size={22} faded />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{p.name}</p>
                      {finalSentence ? (
                        <>
                          <p className="text-sm opacity-70 italic">&ldquo;{finalSentence.content}&rdquo;</p>
                          <p className={`text-xs font-medium ${scoreColor(finalSentence.score)}`}>
                            scored {finalSentence.score}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm opacity-70">Ran out of time.</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {session.status === "active" && (
            <CountdownBar
              secondsLeft={secondsLeft ?? 0}
              totalSeconds={session.phase === "cooldown" ? COOLDOWN_SECONDS : session.turn_seconds}
              label={
                session.phase === "cooldown"
                  ? isNextUpMe
                    ? "You're up next"
                    : `${currentPlayer?.name ?? "..."} is up next`
                  : isMyTurn
                    ? "Your turn"
                    : `Waiting on ${currentPlayer?.name ?? "..."}`
              }
            />
          )}

          {isMyTurn && (
            <form onSubmit={handleSubmit} className="space-y-2">
              <textarea
                className="field"
                rows={3}
                placeholder="Continue the story..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                required
              />
              <button type="submit" disabled={busy} className="btn-primary w-full">
                Submit sentence
              </button>
            </form>
          )}

          {session.status === "finished" && (
            <div className="text-center space-y-3 py-4">
              <p className="wordmark text-2xl">{winner ? `${winner.name} wins!` : "Game over"}</p>
              <p className="text-sm opacity-60">Last writer standing.</p>
              <div className="flex items-center justify-center gap-2">
                {me && (
                  <button onClick={handlePlayAgain} disabled={rematchBusy} className="btn-primary">
                    {rematchBusy ? "Starting..." : "Play again"}
                  </button>
                )}
                <Link href="/" className="btn-secondary">
                  Home
                </Link>
              </div>
            </div>
          )}
        </section>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
    </main>
  );
}
