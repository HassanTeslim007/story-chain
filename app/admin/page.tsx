import { notFound } from "next/navigation";
import { getServiceClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

type EventRow = {
  event: "created" | "started" | "finished";
  mode: string;
  genre: string | null;
  end_reason: string | null;
  player_count: number | null;
  turns_played: number | null;
};

function tally(values: string[]): [string, number][] {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

// Gated by a shared secret in the URL, not real auth - fine for a
// low-stakes, no-PII aggregate stats page, but the key is visible in
// browser history/referrers/server logs. Don't put anything sensitive here.
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const { key } = await searchParams;
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    notFound();
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from("game_events")
    .select("event, mode, genre, end_reason, player_count, turns_played")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    return (
      <main className="flex-1 p-6 max-w-2xl mx-auto w-full">
        <p className="text-red-500 text-sm">Failed to load stats: {error.message}</p>
      </main>
    );
  }

  const rows = (data ?? []) as EventRow[];
  const funnelCounts = Object.fromEntries(tally(rows.map((r) => r.event)));
  const finished = rows.filter((r) => r.event === "finished");
  const completionRate = funnelCounts.created ? ((funnelCounts.finished ?? 0) / funnelCounts.created) * 100 : null;

  return (
    <main className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-6">
      <h1 className="wordmark text-2xl">Stats</h1>

      <section className="card p-4 space-y-1">
        <h2 className="section-label">Funnel</h2>
        <p className="text-sm">Created: {funnelCounts.created ?? 0}</p>
        <p className="text-sm">Started: {funnelCounts.started ?? 0}</p>
        <p className="text-sm">Finished: {funnelCounts.finished ?? 0}</p>
        {completionRate !== null && (
          <p className="text-sm opacity-70">Completion rate: {completionRate.toFixed(1)}%</p>
        )}
      </section>

      <section className="card p-4 space-y-1">
        <h2 className="section-label">Mode (finished games)</h2>
        {tally(finished.map((r) => r.mode)).map(([k, v]) => (
          <p key={k} className="text-sm">
            {k}: {v}
          </p>
        ))}
      </section>

      <section className="card p-4 space-y-1">
        <h2 className="section-label">Genre (finished games)</h2>
        {tally(finished.map((r) => r.genre || "Surprise me")).map(([k, v]) => (
          <p key={k} className="text-sm">
            {k}: {v}
          </p>
        ))}
      </section>

      <section className="card p-4 space-y-1">
        <h2 className="section-label">How games ended</h2>
        {tally(finished.map((r) => r.end_reason || "unknown")).map(([k, v]) => (
          <p key={k} className="text-sm">
            {k}: {v}
          </p>
        ))}
      </section>

      <p className="text-xs opacity-50">Last {rows.length} events (max 1000), most recent first.</p>
    </main>
  );
}
