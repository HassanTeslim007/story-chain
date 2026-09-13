"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { getPlayerIdentity, savePlayerIdentity } from "@/lib/identity";
import { postJson } from "@/lib/apiFetch";
import { COOLDOWN_SECONDS, MAX_SENTENCE_LENGTH } from "@/lib/constants";
import { useSpeechToText } from "@/lib/useSpeechToText";
import { useGameSounds } from "@/lib/useGameSounds";
import type { Player, Sentence, Session } from "@/lib/types";
import Avatar from "@/components/Avatar";
import CountdownBar from "@/components/CountdownBar";
import ScoreChart from "@/components/ScoreChart";
import Toasts, { type Toast } from "@/components/Toasts";
import { ThemeCycleButton } from "@/components/ThemePicker";
import QRCode from "@/components/QRCode";

function scoreColor(score: number | null): string {
  if (score === null) return "text-neutral-500";
  if (score >= 70) return "text-emerald-500";
  if (score >= 50) return "text-amber-500";
  return "text-red-500";
}

// The running average is what actually decides elimination (avg < 50), so
// its danger zone is wider than a single sentence's: still "close to 50"
// well above the line, not just below it.
function avgStatusColor(avg: number): { text: string; border: string } {
  if (avg < 60) return { text: "text-red-500", border: "#ef4444" };
  if (avg < 75) return { text: "text-amber-500", border: "#f59e0b" };
  return { text: "text-emerald-500", border: "#10b981" };
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
  const mic = useSpeechToText((text) => {
    setDraft((prev) => (prev ? `${prev.trim()} ${text}` : text).slice(0, MAX_SENTENCE_LENGTH));
  });
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [judging, setJudging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [storyCopied, setStoryCopied] = useState(false);
  // Set post-mount only (empty during SSR) so the server and first client
  // render match - window.location isn't available during SSR, and filling
  // it in immediately would make the QR code's encoded path mismatch on
  // hydration.
  const [joinUrl, setJoinUrl] = useState("");
  useEffect(() => setJoinUrl(window.location.href), []);
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
    fetch(`/api/session/${code}/timeout`, { method: "POST" })
      .then(fetchState)
      .catch(() => {});
  }, [secondsLeft, session, code, fetchState]);

  const me = players.find((p) => p.id === playerId) ?? null;
  const isMyTurn = session?.status === "active" && session.phase === "turn" && session.current_turn_player_id === playerId;
  const isNextUpMe = session?.status === "active" && session.phase === "cooldown" && session.current_turn_player_id === playerId;

  // The story box scrolls internally now (fixed height) - keep it pinned to
  // the newest sentence, otherwise a new turn could land below the fold and
  // go unnoticed by anyone not already scrolled to the bottom.
  const storyBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = storyBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sentences.length]);

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
    const { ok, data } = await postJson<{ session: Session; player: Player }>(`/api/session/${code}/join`, {
      name: joinName,
    });
    if (!ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    savePlayerIdentity(code, data.player.id);
    setPlayerId(data.player.id);
    fetchState();
  }

  async function handleStart() {
    setBusy(true);
    setError(null);
    const { ok, data } = await postJson(`/api/session/${code}/start`);
    setBusy(false);
    if (!ok) setError(data.error ?? "Something went wrong.");
  }

  async function handleCancel() {
    if (!playerId) return;
    if (!window.confirm("Cancel this game? This can't be undone.")) return;
    setBusy(true);
    setError(null);
    const { ok, data } = await postJson(`/api/session/${code}/cancel`, { playerId });
    if (!ok) {
      setBusy(false);
      setError(data.error ?? "Something went wrong.");
      return;
    }
    router.push("/");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!playerId) return;
    setBusy(true);
    setJudging(true);
    setError(null);
    try {
      const { ok, data } = await postJson(`/api/session/${code}/submit`, { playerId, content: draft });
      if (!ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setDraft("");
    } finally {
      setBusy(false);
      setJudging(false);
    }
  }

  const [rematchBusy, setRematchBusy] = useState(false);
  async function handlePlayAgain() {
    if (!me) return;
    setRematchBusy(true);
    setError(null);
    try {
      const { ok, data } = await postJson<{ session: Session; player: Player }>("/api/session/create", {
        hostName: me.name,
        turnSeconds: session!.turn_seconds,
        mode: session!.mode,
        maxTurnsPerPlayer: session!.max_turns_per_player,
      });
      if (!ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      savePlayerIdentity(data.session.code, data.player.id);
      router.push(`/session/${data.session.code}`);
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
  const avgColor = avg !== null ? avgStatusColor(avg) : null;
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

  function totalScoreFor(id: string): number {
    return sentences
      .filter((s) => s.player_id === id && !s.removed && s.score !== null)
      .reduce((sum, s) => sum + (s.score as number), 0);
  }

  // In marathon mode nobody is eliminated, so every alive player advances in
  // lockstep - the lowest turns_taken among them is the round currently in
  // progress (1-indexed, capped at the game length).
  const round =
    session.mode === "marathon" && players.length > 0
      ? Math.min(session.max_turns_per_player, Math.min(...players.map((p) => p.turns_taken)) + 1)
      : null;

  return (
    <main
      className={`flex-1 w-full mx-auto p-6 lg:p-8 space-y-6 max-w-2xl lg:max-w-[1560px] ${
        isMyTurn ? "pb-32" : ""
      }`}
    >
      <Toasts toasts={toasts} />

      {/* Header/join/players/lobby stay at reading width even on desktop -
          only the gameplay grid below uses the wider container, for its
          chart/verdict side columns. */}
      <div className="max-w-2xl mx-auto w-full space-y-6">
      {/* Sticky so the running average is always visible without scrolling
          up, no matter how far down the story/chart/verdict you've scrolled. */}
      <header
        className="sticky top-0 z-30 -mt-6 lg:-mt-8 pt-6 lg:pt-8 pb-3 flex items-center justify-between"
        style={{
          backgroundColor: "color-mix(in srgb, var(--background) 90%, transparent)",
          backdropFilter: "blur(8px)",
        }}
      >
        <h1 className="wordmark text-xl">Story Chain</h1>
        <div className="flex items-center gap-2">
          {avg !== null && avgColor && (
            <span className={`btn-icon font-mono font-bold ${avgColor.text}`} title="Running average">
              {avg.toFixed(1)}
            </span>
          )}
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

      {!me && session.status === "active" && players.some((p) => p.is_alive) && (
        <section className="card p-4 space-y-2 text-center">
          <p className="text-sm opacity-70">Lost your seat? Tap your name to reconnect.</p>
          <div className="flex flex-wrap justify-center gap-2">
            {players
              .filter((p) => p.is_alive)
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    savePlayerIdentity(code, p.id);
                    setPlayerId(p.id);
                  }}
                  className="btn-secondary text-sm"
                >
                  {p.name}
                </button>
              ))}
          </div>
        </section>
      )}

      <section className="card p-4 space-y-2">
        <h2 className="section-label">
          Players {avg !== null && `· avg score ${avg.toFixed(1)}`}
          {round !== null && ` · round ${round}/${session.max_turns_per_player}`}
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
          <p className="text-sm opacity-60">Share the code or scan to join.</p>
          <p className="marquee-code text-2xl font-mono font-bold inline-block">{code}</p>
          <p className="text-xs opacity-50">Genre: {session.genre || "Surprise me"}</p>
          {joinUrl && (
            <div className="flex justify-center">
              <QRCode value={joinUrl} />
            </div>
          )}
          {me && (
            <div className="flex items-center justify-center gap-2">
              <button onClick={handleStart} disabled={busy || players.length < 2} className="btn-primary">
                {players.length < 2 ? "Waiting for players..." : "Start game"}
              </button>
              {me.turn_order === 0 && players.length === 1 && (
                <button onClick={handleCancel} disabled={busy} className="btn-secondary">
                  Cancel game
                </button>
              )}
            </div>
          )}
        </section>
      )}
      </div>

      {session.status !== "lobby" && (
        // Three columns on desktop (chart | story | verdict) so the wide
        // viewport isn't just empty margin; a plain single-column stack on
        // mobile. Each side column is pinned to its grid line explicitly
        // (col-start-*) rather than relying on auto-placement, so if one
        // side has no content yet, the other doesn't shift into its slot.
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[280px_minmax(0,50rem)_280px] lg:gap-10 lg:items-start">
          {sentences.some((s) => s.turn_number > 0) && (
            <aside className="order-2 lg:order-none lg:col-start-1 lg:row-start-1 lg:-rotate-1 hover:lg:rotate-0 transition-transform duration-300">
              <div className="space-y-5">
                <div className="card p-4">
                  <h2 className="section-label mb-2">Average score over time</h2>
                  <ScoreChart sentences={sentences} playerName={playerName} />
                </div>

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
              </div>
            </aside>
          )}

          <section className="order-1 lg:order-none lg:col-start-2 lg:row-start-1 min-w-0 space-y-5">
            <div className="card story-frame flex flex-col h-[calc(80vh-220px)] min-h-[240px]">
              <div className="flex items-center justify-between shrink-0">
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
              {/* Fixed-height card, scrolls internally - the story keeps
                  growing but the surrounding layout (header, sidebars,
                  floating input) never has to move to make room for it. */}
              <div
                ref={storyBoxRef}
                className="story-text leading-relaxed overflow-y-auto flex-1 mt-3 pr-1"
                style={{ fontFamily: "var(--font-story)" }}
              >
                {storySentences.map((s, i) => (
                  <span key={s.id} className={i === storySentences.length - 1 ? "animate-sentence-in" : ""}>
                    {s.content}{" "}
                  </span>
                ))}
              </div>
            </div>

            {session.status === "finished" && (
              <div className="text-center space-y-3 py-4">
                <p className="wordmark text-2xl">{winner ? `${winner.name} wins!` : "Game over"}</p>
                <p className="text-sm opacity-60">
                  {session.end_reason === "turn_cap"
                    ? `Highest score after ${session.max_turns_per_player} turns each.`
                    : "Last writer standing."}
                </p>

                {session.end_reason === "turn_cap" && (
                  <div className="card p-4 space-y-2 text-left max-w-xs mx-auto">
                    <h2 className="section-label">Final scores</h2>
                    {[...players]
                      .map((p) => ({ p, total: totalScoreFor(p.id) }))
                      .sort((a, b) => b.total - a.total)
                      .map(({ p, total }, i) => (
                        <div key={p.id} className="flex items-center gap-2 text-sm">
                          <span className="w-4 opacity-50">{i + 1}</span>
                          <Avatar name={p.name} size={20} faded={!p.is_alive} />
                          <span className={p.id === session.winner_player_id ? "font-semibold" : ""}>{p.name}</span>
                          <span className="ml-auto font-mono">{total}</span>
                        </div>
                      ))}
                  </div>
                )}

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

          {(session.status === "active" || judging || lastTurn || avg !== null) && (
            <aside className="order-3 lg:order-none lg:col-start-3 lg:row-start-1 lg:rotate-1 hover:lg:rotate-0 transition-transform duration-300">
              <div className="space-y-5">
                {session.status === "active" &&
                  (session.phase === "judging" ? (
                    // Time is frozen while the judge is reading - shown to
                    // every viewer, not just the submitter, so a ticking
                    // countdown never implies someone's about to be timed
                    // out for a turn they already submitted in time.
                    <div className="card p-3 text-center text-sm opacity-70 animate-pulse-soft">
                      ✒️ The judge is reading {currentPlayer?.name ?? "their"}&apos;s line...
                    </div>
                  ) : (
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
                  ))}

                {(judging || lastTurn || avg !== null) && (
                  <div
                    className="card p-4 space-y-2"
                    style={avgColor ? { borderColor: avgColor.border, borderWidth: 2 } : undefined}
                  >
                    <h2 className="section-label">Judge&apos;s verdict</h2>

                    {avg !== null && (
                      <div className="text-center py-1">
                        <p className={`text-4xl font-bold leading-none ${avgColor!.text}`}>{avg.toFixed(1)}</p>
                        <p className="text-[11px] opacity-50 mt-1">running average</p>
                      </div>
                    )}

                    {judging ? (
                      <p className="text-sm opacity-70 animate-pulse-soft">✒️ The judge is reading your line...</p>
                    ) : (
                      lastTurn && (
                        <div className="space-y-1 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
                          <div className="flex items-center gap-3 pt-2">
                            <Avatar name={lastTurnPlayer?.name ?? "?"} size={22} />
                            <span className="text-sm font-medium">{lastTurnPlayer?.name ?? "Unknown"}</span>
                            <span className={`verdict-seal ml-auto text-lg font-bold ${scoreColor(lastTurn.score)}`}>
                              {lastTurn.score}
                            </span>
                          </div>
                          {lastTurn.score !== null && (
                            <div className="verdict-gauge-track">
                              <div className="verdict-gauge-danger" />
                              <div
                                className="verdict-gauge-marker"
                                style={{ left: `${Math.max(0, Math.min(100, lastTurn.score))}%` }}
                              />
                            </div>
                          )}
                          {lastTurn.reasoning && <p className="text-sm opacity-70 pt-1">{lastTurn.reasoning}</p>}
                          {lastTurn.removed && (
                            <p className="text-xs text-red-500 font-medium">
                              Average dropped below 50 — this sentence was removed and{" "}
                              {lastTurnPlayer?.name ?? "the player"} is eliminated.
                            </p>
                          )}
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      )}

      {isMyTurn && (
        // Floating, not docked to the flow - so you never have to scroll
        // down to find it, no matter how long the story or the sidebars get.
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-2xl">
          <form onSubmit={handleSubmit} className="card p-3 shadow-lg space-y-2">
            <textarea
              className="field"
              rows={2}
              placeholder="Continue the story..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_SENTENCE_LENGTH}
              required
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs opacity-50">
                {draft.length}/{MAX_SENTENCE_LENGTH}
              </p>
              <div className="flex items-center gap-2">
                {mic.supported && (
                  <button
                    type="button"
                    onClick={mic.listening ? mic.stop : mic.start}
                    className={`btn-icon ${mic.listening ? "animate-pulse-soft" : ""}`}
                    title={mic.listening ? "Stop dictation" : "Dictate your sentence"}
                    style={mic.listening ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
                  >
                    {mic.listening ? "⏹" : "🎤"}
                  </button>
                )}
                <button type="submit" disabled={busy} className="btn-primary">
                  Submit sentence
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {error && <p className="text-sm text-red-500 max-w-2xl mx-auto w-full">{error}</p>}
    </main>
  );
}
