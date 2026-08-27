import type { Sentence } from "@/lib/types";

type Point = { turn: number; avg: number; playerId: string | null; eliminated: boolean };

// Reconstructs the running average exactly as the server computed it turn by
// turn: an eliminating score counts toward the average at the moment it
// lands (so the dip below 50 is visible), then gets excluded going forward,
// same as sessions.total_score / score_count in lib/game.ts.
function buildHistory(sentences: Sentence[]): Point[] {
  const ordered = sentences
    .filter((s) => s.turn_number > 0 && s.score !== null)
    .sort((a, b) => a.turn_number - b.turn_number);

  const points: Point[] = [];
  let total = 0;
  let count = 0;
  for (const s of ordered) {
    total += s.score!;
    count += 1;
    points.push({ turn: s.turn_number, avg: total / count, playerId: s.player_id, eliminated: s.removed });
    if (s.removed) {
      total -= s.score!;
      count -= 1;
    }
  }
  return points;
}

export default function ScoreChart({
  sentences,
  playerName,
}: {
  sentences: Sentence[];
  playerName: (id: string | null) => string;
}) {
  const points = buildHistory(sentences);

  if (points.length === 0) {
    return (
      <p className="text-sm text-neutral-500 py-6 text-center">
        Score history will show up after the first turn.
      </p>
    );
  }

  const width = 100;
  const height = 40;
  const pad = 4;
  const x = (i: number) => (points.length === 1 ? width / 2 : pad + (i / (points.length - 1)) * (width - pad * 2));
  const y = (avg: number) => height - pad - (Math.max(0, Math.min(100, avg)) / 100) * (height - pad * 2);
  const thresholdY = y(50);

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.avg)}`).join(" ");

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-24" preserveAspectRatio="none">
        <line
          x1={0}
          x2={width}
          y1={thresholdY}
          y2={thresholdY}
          stroke="currentColor"
          strokeOpacity={0.25}
          strokeDasharray="2 2"
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={path}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) => (
          <circle
            key={p.turn}
            cx={x(i)}
            cy={y(p.avg)}
            r={p.eliminated ? 2 : 1.2}
            fill={p.eliminated ? "#ef4444" : "var(--color-accent)"}
          >
            <title>
              turn {p.turn} - {playerName(p.playerId)}: avg {p.avg.toFixed(1)}
              {p.eliminated ? " (eliminated here)" : ""}
            </title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[11px] text-neutral-500">
        <span>turn {points[0].turn}</span>
        <span>avg 50 threshold</span>
        <span>turn {points[points.length - 1].turn}</span>
      </div>
    </div>
  );
}
