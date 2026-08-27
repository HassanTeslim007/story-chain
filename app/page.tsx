"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { savePlayerIdentity } from "@/lib/identity";

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
          <h1 className="text-3xl font-bold" style={{ fontFamily: "var(--font-serif)" }}>
            Story Chain
          </h1>
          <p className="text-sm text-neutral-500">
            AI judges every line. Drag the average below 50, you&apos;re out.
          </p>
        </div>

        <div className="flex rounded-lg border border-neutral-300 dark:border-neutral-700 overflow-hidden text-sm">
          <button
            className="flex-1 py-2 transition-colors"
            style={mode === "create" ? { backgroundColor: "var(--color-accent)", color: "white" } : undefined}
            onClick={() => setMode("create")}
          >
            Create game
          </button>
          <button
            className="flex-1 py-2 transition-colors"
            style={mode === "join" ? { backgroundColor: "var(--color-accent)", color: "white" } : undefined}
            onClick={() => setMode("join")}
          >
            Join game
          </button>
        </div>

        <form onSubmit={mode === "create" ? handleCreate : handleJoin} className="space-y-3">
          <input
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          {mode === "create" ? (
            <label className="block text-sm space-y-1">
              <span className="text-neutral-500">Seconds per turn</span>
              <input
                type="number"
                min={10}
                max={120}
                className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
                value={turnSeconds}
                onChange={(e) => setTurnSeconds(Number(e.target.value))}
              />
            </label>
          ) : (
            <input
              className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 uppercase tracking-widest"
              placeholder="Game code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              required
            />
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md text-white py-2 font-medium disabled:opacity-50"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            {loading ? "..." : mode === "create" ? "Create" : "Join"}
          </button>
        </form>
      </div>
    </main>
  );
}
