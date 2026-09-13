"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { savePlayerIdentity } from "@/lib/identity";
import { postJson } from "@/lib/apiFetch";
import type { Difficulty, Player, Session } from "@/lib/types";
import { ThemePicker } from "@/components/ThemePicker";
import {
  TURN_SECONDS_OPTIONS,
  MARATHON_TURN_OPTIONS,
  ELIMINATION_SAFETY_TURN_CAP,
  GENRE_OPTIONS,
  MAX_GENRE_LENGTH,
  DIFFICULTY_OPTIONS,
} from "@/lib/constants";
import type { SessionMode } from "@/lib/types";

function Chips<T extends string | number>({
  options,
  value,
  onChange,
  format,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format: (v: T) => string;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className="flex-1 text-sm py-1.5 border"
          style={{
            borderRadius: "var(--radius)",
            borderColor: value === opt ? "var(--accent)" : "var(--border)",
            backgroundColor: value === opt ? "var(--accent)" : "transparent",
            color: value === opt ? "white" : "var(--foreground)",
          }}
        >
          {format(opt)}
        </button>
      ))}
    </div>
  );
}

function GenrePicker({
  genre,
  setGenre,
  customGenre,
  setCustomGenre,
}: {
  genre: string;
  setGenre: (g: string) => void;
  customGenre: boolean;
  setCustomGenre: (c: boolean) => void;
}) {
  return (
    <div className="space-y-2.5">
      <span className="text-sm opacity-60">Genre</span>
      <div className="flex flex-wrap gap-1.5">
        {["", ...GENRE_OPTIONS].map((opt) => {
          const active = !customGenre && genre === opt;
          return (
            <button
              key={opt || "surprise"}
              type="button"
              onClick={() => {
                setCustomGenre(false);
                setGenre(opt);
              }}
              className="text-sm px-3 py-1.5 border"
              style={{
                borderRadius: "var(--radius)",
                borderColor: active ? "var(--accent)" : "var(--border)",
                backgroundColor: active ? "var(--accent)" : "transparent",
                color: active ? "white" : "var(--foreground)",
              }}
            >
              {opt || "Surprise me"}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setCustomGenre(true);
            setGenre("");
          }}
          className="text-sm px-3 py-1.5 border"
          style={{
            borderRadius: "var(--radius)",
            borderColor: customGenre ? "var(--accent)" : "var(--border)",
            backgroundColor: customGenre ? "var(--accent)" : "transparent",
            color: customGenre ? "white" : "var(--foreground)",
          }}
        >
          Custom…
        </button>
      </div>
      {customGenre && (
        <input
          className="field"
          placeholder="e.g. cozy bakery mystery, cyberpunk heist..."
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          maxLength={MAX_GENRE_LENGTH}
          autoFocus
        />
      )}
    </div>
  );
}

const SAMPLE_STORY =
  "Once, in a city that forgot its own name, a locksmith found a door with no wall around it. " +
  "She turned the handle anyway, half-expecting nothing. The hinges sighed like they'd been " +
  "waiting years for someone brave — or bored — enough to ask what was on the other side.";

// Live preview of the story card, built from the exact same .card/.story-frame
// classes the real game uses - so switching the theme picker re-skins this
// too, automatically, with zero extra wiring.
function StoryFramePreview() {
  return (
    <div className="hidden lg:flex flex-col justify-center" aria-hidden="true">
      <div className="card story-frame flex flex-col h-[440px]">
        <div className="flex items-center justify-between shrink-0">
          <h2 className="section-label">The story</h2>
          <div className="flex items-center gap-1.5">
            <span className="btn-icon">📋 Copy</span>
            <span className="btn-icon">⬇ Download</span>
          </div>
        </div>
        <div
          className="story-text leading-relaxed overflow-y-auto flex-1 mt-3 pr-1"
          style={{ fontFamily: "var(--font-story)" }}
        >
          {SAMPLE_STORY}
        </div>
      </div>
      <p className="text-center text-xs opacity-50 mt-3">Live preview — pick a theme to see it change</p>
    </div>
  );
}

const DIFFICULTY_BLURBS: Record<Difficulty, string> = {
  easy: "The AI keeps it simple and a little unimaginative - a fair fight for a first game.",
  normal: "The AI writes a solid, reasonably creative line each turn - a genuine contest.",
  hard: "The AI goes all out - vivid, inventive lines that'll be tough to out-write.",
};

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [turnSeconds, setTurnSeconds] = useState(TURN_SECONDS_OPTIONS[0]);
  const [gameMode, setGameMode] = useState<SessionMode>("elimination");
  const [maxTurns, setMaxTurns] = useState(MARATHON_TURN_OPTIONS[0]);
  const [genre, setGenre] = useState(""); // "" = surprise me
  const [customGenre, setCustomGenre] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState<"create" | "join" | "solo">("create");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { ok, data } = await postJson<{ session: Session; player: Player }>("/api/session/create", {
        hostName: name,
        turnSeconds,
        mode: gameMode,
        maxTurnsPerPlayer: gameMode === "marathon" ? maxTurns : undefined,
        genre,
      });
      if (!ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      savePlayerIdentity(data.session.code, data.player.id);
      router.push(`/session/${data.session.code}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const code = joinCode.trim().toUpperCase();
      const { ok, data } = await postJson<{ session: Session; player: Player }>(`/api/session/${code}/join`, { name });
      if (!ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      savePlayerIdentity(code, data.player.id);
      router.push(`/session/${code}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSolo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { ok, data } = await postJson<{ session: Session; player: Player }>("/api/session/solo", {
        hostName: name,
        turnSeconds,
        maxTurnsPerPlayer: maxTurns,
        genre,
        difficulty,
      });
      if (!ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      savePlayerIdentity(data.session.code, data.player.id);
      router.push(`/session/${data.session.code}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6 lg:p-12">
      <div className="w-full max-w-sm lg:max-w-6xl lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center">
        <div className="space-y-8">
          <div className="text-center lg:text-left space-y-3">
            <h1 className="wordmark text-3xl lg:text-5xl">Story Chain</h1>
            <p className="text-sm lg:text-base opacity-60">AI judges every line, sentence by sentence.</p>
            <ul className="text-xs lg:text-sm opacity-60 space-y-1.5 pt-2 inline-block text-left">
              <li>✒️ The judge scores every line for coherence, creativity, and grammar</li>
              <li>⚔️ Elimination or Marathon — sudden death, or ranked by total score</li>
              <li>🔄 Live multiplayer — everyone sees every turn as it lands</li>
              <li>🤖 Or play solo against an AI opponent, 3 difficulty levels</li>
            </ul>
          </div>

          <div className="space-y-2.5">
            <p className="section-label">Theme</p>
            <ThemePicker />
          </div>

          <div
            className="flex border overflow-hidden text-sm"
            style={{ borderColor: "var(--border)", borderRadius: "var(--radius)" }}
          >
            <button
              className="flex-1 py-2 transition-colors"
              style={mode === "create" ? { backgroundColor: "var(--accent)", color: "white" } : undefined}
              onClick={() => setMode("create")}
            >
              Create game
            </button>
            <button
              className="flex-1 py-2 transition-colors"
              style={mode === "join" ? { backgroundColor: "var(--accent)", color: "white" } : undefined}
              onClick={() => setMode("join")}
            >
              Join game
            </button>
            <button
              className="flex-1 py-2 transition-colors"
              style={mode === "solo" ? { backgroundColor: "var(--accent)", color: "white" } : undefined}
              onClick={() => setMode("solo")}
            >
              Play vs AI
            </button>
          </div>

          {mode === "solo" ? (
            <form onSubmit={handleSolo} className="space-y-5">
              <input
                className="field"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />

              <div className="space-y-2.5">
                <span className="text-sm opacity-60">Difficulty</span>
                <Chips
                  options={DIFFICULTY_OPTIONS}
                  value={difficulty}
                  onChange={setDifficulty}
                  format={(d) => d[0].toUpperCase() + d.slice(1)}
                />
                <p className="text-[11px] opacity-50 leading-snug">{DIFFICULTY_BLURBS[difficulty]}</p>
              </div>

              <div className="space-y-2.5">
                <span className="text-sm opacity-60">Minutes per turn</span>
                <Chips
                  options={TURN_SECONDS_OPTIONS}
                  value={turnSeconds}
                  onChange={setTurnSeconds}
                  format={(s) => `${s / 60}m`}
                />
              </div>

              <GenrePicker genre={genre} setGenre={setGenre} customGenre={customGenre} setCustomGenre={setCustomGenre} />

              <div className="space-y-2.5">
                <span className="text-sm opacity-60">Turns per player</span>
                <Chips options={MARATHON_TURN_OPTIONS} value={maxTurns} onChange={setMaxTurns} format={(n) => String(n)} />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? "..." : "Play"}
              </button>
            </form>
          ) : (
            <form onSubmit={mode === "create" ? handleCreate : handleJoin} className="space-y-5">
              <input
                className="field"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />

              {mode === "create" ? (
                <>
                  <div className="space-y-2.5">
                    <span className="text-sm opacity-60">Mode</span>
                    <Chips
                      options={["elimination", "marathon"] as const}
                      value={gameMode}
                      onChange={setGameMode}
                      format={(m) => (m === "elimination" ? "Elimination" : "Marathon")}
                    />
                    <p className="text-[11px] opacity-50 leading-snug">
                      {gameMode === "elimination"
                        ? `Sudden death — drag the average below 50 and you're out. Last writer standing wins. Capped at ${ELIMINATION_SAFETY_TURN_CAP} turns each — if nobody's eliminated by then, highest total score wins.`
                        : "No elimination — everyone writes the same number of turns, ranked by total score."}
                    </p>
                  </div>

                  <div className="space-y-2.5">
                    <span className="text-sm opacity-60">Minutes per turn</span>
                    <Chips
                      options={TURN_SECONDS_OPTIONS}
                      value={turnSeconds}
                      onChange={setTurnSeconds}
                      format={(s) => `${s / 60}m`}
                    />
                  </div>

                  <GenrePicker genre={genre} setGenre={setGenre} customGenre={customGenre} setCustomGenre={setCustomGenre} />

                  {gameMode === "marathon" && (
                    <div className="space-y-2.5">
                      <span className="text-sm opacity-60">Turns per player</span>
                      <Chips
                        options={MARATHON_TURN_OPTIONS}
                        value={maxTurns}
                        onChange={setMaxTurns}
                        format={(n) => String(n)}
                      />
                    </div>
                  )}
                </>
              ) : (
                <input
                  className="field uppercase tracking-widest"
                  placeholder="Game code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  required
                />
              )}

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? "..." : mode === "create" ? "Create" : "Join"}
              </button>
            </form>
          )}
        </div>

        <StoryFramePreview />
      </div>
    </main>
  );
}
