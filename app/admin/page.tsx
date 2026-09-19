import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabaseServer";
import { StatTile, BarChart, TrendChart } from "@/components/AdminCharts";
import Avatar from "@/components/Avatar";

export const dynamic = "force-dynamic";

const ADMIN_COOKIE = "story_chain_admin";

async function login(formData: FormData) {
  "use server";
  const key = formData.get("key");
  if (typeof key === "string" && key && process.env.ADMIN_KEY && key === process.env.ADMIN_KEY) {
    (await cookies()).set(ADMIN_COOKIE, key, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/admin",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
}

async function logout() {
  "use server";
  (await cookies()).delete(ADMIN_COOKIE);
}

type EventRow = {
  event: "created" | "started" | "finished" | "cancelled";
  mode: string;
  genre: string | null;
  end_reason: string | null;
  player_count: number | null;
  turns_played: number | null;
  created_at: string;
};

type GreatLineRow = {
  id: string;
  session_code: string;
  context: string;
  sentence: string;
  author_name: string;
  score: number;
  mode: string;
  genre: string | null;
  created_at: string;
};

function tally(values: string[]): { label: string; value: number }[] {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  return Object.entries(counts)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function dailyTrend(rows: EventRow[], days: number) {
  const buckets = new Map<string, { created: number; started: number; finished: number }>();
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    buckets.set(d.toISOString().slice(0, 10), { created: 0, started: 0, finished: 0 });
  }
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    const bucket = buckets.get(day);
    if (bucket && (r.event === "created" || r.event === "started" || r.event === "finished")) {
      bucket[r.event] += 1;
    }
  }
  return Array.from(buckets.entries()).map(([date, counts]) => ({ date, ...counts }));
}

export default async function AdminPage() {
  const cookieStore = await cookies();
  const authed = !!process.env.ADMIN_KEY && cookieStore.get(ADMIN_COOKIE)?.value === process.env.ADMIN_KEY;

  if (!authed) {
    return (
      <main className="flex-1 flex items-center justify-center p-6">
        <form action={login} className="card w-full max-w-xs p-5 space-y-3">
          <h1 className="wordmark text-lg">Admin</h1>
          <input type="password" name="key" className="field" placeholder="Admin key" required autoFocus />
          <button type="submit" className="btn-primary w-full">
            Enter
          </button>
        </form>
      </main>
    );
  }

  const db = getServiceClient();
  const [eventsRes, greatLinesRes, sessionsRes] = await Promise.all([
    db
      .from("game_events")
      .select("event, mode, genre, end_reason, player_count, turns_played, created_at")
      .order("created_at", { ascending: false })
      .limit(2000),
    db.from("great_lines").select("*").order("created_at", { ascending: false }).limit(30),
    db
      .from("sessions")
      .select("id, code, mode, genre, status, created_at")
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const rows = (eventsRes.data ?? []) as EventRow[];
  const greatLines = (greatLinesRes.data ?? []) as GreatLineRow[];
  const recentSessions = sessionsRes.data ?? [];

  const [recentPlayersRes, recentSentencesRes] = await Promise.all([
    recentSessions.length
      ? db
          .from("players")
          .select("id, session_id, name, is_ai, is_alive")
          .in(
            "session_id",
            recentSessions.map((s) => s.id),
          )
      : Promise.resolve({ data: [] }),
    recentSessions.length
      ? db
          .from("sentences")
          .select("session_id, turn_number, player_id, content, score, removed")
          .in(
            "session_id",
            recentSessions.map((s) => s.id),
          )
          .order("turn_number", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);
  const recentPlayers = recentPlayersRes.data ?? [];
  const recentSentences = recentSentencesRes.data ?? [];

  const funnelCounts = Object.fromEntries(tally(rows.map((r) => r.event)).map((t) => [t.label, t.value]));
  const finished = rows.filter((r) => r.event === "finished");
  const completionRate = funnelCounts.created ? ((funnelCounts.finished ?? 0) / funnelCounts.created) * 100 : null;
  const trend = dailyTrend(rows, 30);

  return (
    <main className="flex-1 p-6 max-w-3xl mx-auto w-full space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="wordmark text-2xl">Dashboard</h1>
        <form action={logout}>
          <button className="btn-secondary text-sm">Log out</button>
        </form>
      </div>

      <section className="space-y-3">
        <h2 className="section-label">Funnel</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Created" value={funnelCounts.created ?? 0} />
          <StatTile label="Started" value={funnelCounts.started ?? 0} />
          <StatTile label="Finished" value={funnelCounts.finished ?? 0} />
          <StatTile
            label="Completion rate"
            value={completionRate !== null ? `${completionRate.toFixed(1)}%` : "—"}
            hint="finished / created"
          />
        </div>
        <TrendChart points={trend} />
      </section>

      <section className="space-y-3">
        <h2 className="section-label">Breakdown (finished games)</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <BarChart title="Mode" data={tally(finished.map((r) => r.mode))} />
          <BarChart title="How games ended" data={tally(finished.map((r) => r.end_reason || "unknown"))} />
          <BarChart title="Genre" data={tally(finished.map((r) => r.genre || "Surprise me"))} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-label">Great lines (score &gt; 50, kept past the 24h cleanup)</h2>
        {greatLines.length === 0 ? (
          <p className="text-sm opacity-50">None yet.</p>
        ) : (
          <div className="space-y-3">
            {greatLines.map((g) => (
              <div key={g.id} className="card p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-xs opacity-60">
                  <Avatar name={g.author_name} size={18} />
                  <span>{g.author_name}</span>
                  <span className="ml-auto font-mono">{g.score}</span>
                </div>
                <p className="text-sm opacity-50 italic">{g.context}</p>
                <p className="text-sm font-medium">{g.sentence}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="section-label">Recent games (live only - purged after 24h)</h2>
        {recentSessions.length === 0 ? (
          <p className="text-sm opacity-50">No live sessions right now.</p>
        ) : (
          <div className="space-y-3">
            {recentSessions.map((s) => {
              const players = recentPlayers.filter((p) => p.session_id === s.id);
              const sentences = recentSentences
                .filter((sen) => sen.session_id === s.id && !sen.removed && sen.player_id)
                .map((sen) => ({ ...sen, playerName: players.find((p) => p.id === sen.player_id)?.name ?? "?" }));
              return (
                <details key={s.id} className="card p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    {s.code} · {s.mode} · {s.genre || "Surprise me"} · {s.status} ·{" "}
                    {players.map((p) => p.name).join(", ")}
                  </summary>
                  <div className="mt-3 space-y-1.5">
                    {sentences.length === 0 ? (
                      <p className="text-xs opacity-50">No turns yet.</p>
                    ) : (
                      sentences.map((sen, i) => (
                        <p key={i} className="text-sm">
                          <span className="opacity-60 font-medium">{sen.playerName}:</span> {sen.content}{" "}
                          <span className="opacity-50 font-mono text-xs">({sen.score})</span>
                        </p>
                      ))
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
