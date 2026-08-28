"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { savePlayerIdentity } from "@/lib/identity";
import { ThemePicker } from "@/components/ThemePicker";
import { MIN_TURN_SECONDS, MAX_TURN_SECONDS } from "@/lib/constants";

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [turnSeconds, setTurnSeconds] = useState(30);
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
        body: JSON.stringify({ hostName: name, turnSeconds }),
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
          <p className="text-sm opacity-60">
            AI judges every line. Drag the average below 50, you&apos;re out.
          </p>
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
            <label className="block text-sm space-y-1">
              <span className="opacity-60">
                Seconds per turn (up to {MAX_TURN_SECONDS / 60} min)
              </span>
              <input
                type="number"
                min={MIN_TURN_SECONDS}
                max={MAX_TURN_SECONDS}
                className="field"
                value={turnSeconds}
                onChange={(e) => setTurnSeconds(Number(e.target.value))}
              />
            </label>
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
