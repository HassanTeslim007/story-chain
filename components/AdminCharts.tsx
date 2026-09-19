// Hand-rolled, server-rendered chart primitives for the admin dashboard -
// no client JS, no charting library, same convention as components/ScoreChart.tsx.
// Colors are the dataviz skill's validated default categorical palette
// (references/palette.md): slots 1-3 (blue/orange/aqua) are pre-validated
// all-pairs in both light and dark, which is all three series here need.
// Scope decision: this internal tool follows OS light/dark only, not the
// player-facing Manuscript/Stage/Editor toggle - building three validated
// chart skins for an admin-only page wasn't worth it.

export function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="section-label">{label}</p>
      <p className="text-3xl font-bold mt-1" style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </p>
      {hint && <p className="text-xs opacity-50 mt-0.5">{hint}</p>}
    </div>
  );
}

export function BarChart({ title, data }: { title: string; data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="card p-4">
      <style>{`
        .admin-bar-fill { background: #2a78d6; }
        @media (prefers-color-scheme: dark) { .admin-bar-fill { background: #3987e5; } }
      `}</style>
      <h3 className="section-label mb-3">{title}</h3>
      {data.length === 0 ? (
        <p className="text-xs opacity-50">No data yet.</p>
      ) : (
        <div className="space-y-2">
          {data.map((d) => (
            <div key={d.label} className="space-y-0.5">
              <div className="flex justify-between text-xs opacity-70">
                <span>{d.label}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{d.value}</span>
              </div>
              <div className="h-2 rounded-full" style={{ background: "var(--border)" }}>
                <div
                  className="admin-bar-fill h-2 rounded-full"
                  style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TREND_SERIES = [
  { key: "created", label: "Created", light: "#2a78d6", dark: "#3987e5" },
  { key: "started", label: "Started", light: "#eb6834", dark: "#d95926" },
  { key: "finished", label: "Finished", light: "#1baf7a", dark: "#199e70" },
] as const;

export function TrendChart({
  points,
}: {
  points: { date: string; created: number; started: number; finished: number }[];
}) {
  const width = 100;
  const height = 32;
  const pad = 2;
  const maxY = Math.max(1, ...points.flatMap((p) => [p.created, p.started, p.finished]));
  const x = (i: number) => (points.length <= 1 ? width / 2 : pad + (i / (points.length - 1)) * (width - pad * 2));
  const y = (v: number) => height - pad - (v / maxY) * (height - pad * 2);

  return (
    <div className="card p-4 space-y-3">
      <style>{`
        .admin-trend { --c-created: ${TREND_SERIES[0].light}; --c-started: ${TREND_SERIES[1].light}; --c-finished: ${TREND_SERIES[2].light}; }
        @media (prefers-color-scheme: dark) {
          .admin-trend { --c-created: ${TREND_SERIES[0].dark}; --c-started: ${TREND_SERIES[1].dark}; --c-finished: ${TREND_SERIES[2].dark}; }
        }
      `}</style>
      <h3 className="section-label">Last {points.length} days</h3>
      <div className="admin-trend">
        {points.length === 0 ? (
          <p className="text-xs opacity-50">No data yet.</p>
        ) : (
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-32" preserveAspectRatio="none">
            {TREND_SERIES.map((s) => {
              const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p[s.key])}`).join(" ");
              return (
                <path
                  key={s.key}
                  d={d}
                  fill="none"
                  stroke={`var(--c-${s.key})`}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        )}
        <div className="flex gap-4 text-xs opacity-70 pt-2">
          {TREND_SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: `var(--c-${s.key})` }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
