"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { savePlayerIdentity } from "@/lib/identity";
import { ThemePicker } from "@/components/ThemePicker";
import { TURN_SECONDS_OPTIONS, MARATHON_TURN_OPTIONS, ELIMINATION_SAFETY_TURN_CAP } from "@/lib/constants";
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

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [turnSeconds, setTurnSeconds] = useState(TURN_SECONDS_OPTIONS[0]);
  const [gameMode, setGameMode] = useState<SessionMode>("elimination");
  const [maxTurns, setMaxTurns] = useState(MARATHON_TURN_OPTIONS[0]);
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/session/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostName: name,
          turnSeconds,
          mode: gameMode,
          maxTurnsPerPlayer: gameMode === "marathon" ? maxTurns : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      savePlayerIdentity(data.session.code, data.player.id);
      router.push(`/session/${data.session.code}`);
    } catch (err) {
      setError((err as Error).message);
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
      const res = await fetch(`/api/session/${code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      savePlayerIdentity(code, data.player.id);
      router.push(`/session/${code}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="wordmark text-3xl">Story Chain</h1>
          <p className="text-sm opacity-60">AI judges every line, sentence by sentence.</p>
        </div>

        <div className="space-y-1.5">
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
        </div>

        <form onSubmit={mode === "create" ? handleCreate : handleJoin} className="space-y-3">
          <input
            className="field"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          {mode === "create" ? (
            <>
              <div className="space-y-1.5">
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

              <div className="space-y-1.5">
                <span className="text-sm opacity-60">Minutes per turn</span>
                <Chips options={TURN_SECONDS_OPTIONS} value={turnSeconds} onChange={setTurnSeconds} format={(s) => `${s / 60}m`} />
              </div>

              {gameMode === "marathon" && (
                <div className="space-y-1.5">
                  <span className="text-sm opacity-60">Turns per player</span>
                  <Chips options={MARATHON_TURN_OPTIONS} value={maxTurns} onChange={setMaxTurns} format={(n) => String(n)} />
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
      </div>
    </main>
  );
}
