export default function CountdownBar({
  secondsLeft,
  totalSeconds,
  label,
}: {
  secondsLeft: number;
  totalSeconds: number;
  label: string;
}) {
  const pct = totalSeconds > 0 ? Math.max(0, Math.min(1, secondsLeft / totalSeconds)) : 0;
  const urgent = secondsLeft <= Math.min(10, totalSeconds * 0.3);

  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);

  return (
    <div>
      {/* Default (Manuscript/Editor): linear bar. Stage swaps to the ring
          below via CSS - both render unconditionally so no component needs
          to know which theme is active. */}
      <div className="countdown-linear space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span>{label}</span>
          <span className={`font-mono ${urgent ? "text-red-500" : ""}`}>{secondsLeft}s</span>
        </div>
        <div className="h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-linear"
            style={{ width: `${pct * 100}%`, backgroundColor: urgent ? "#ef4444" : "var(--accent)" }}
          />
        </div>
      </div>

      <div className="countdown-circular flex-col items-center gap-1">
        <div className="relative" style={{ width: 72, height: 72 }}>
          <svg viewBox="0 0 72 72" width={72} height={72} className={urgent ? "ember-urgent" : undefined}>
            <circle cx={36} cy={36} r={radius} fill="none" stroke="var(--border)" strokeWidth={5} />
            <circle
              cx={36}
              cy={36}
              r={radius}
              fill="none"
              stroke={urgent ? "#ef4444" : "var(--accent-2)"}
              strokeWidth={5}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 36 36)"
              className="ember-ring-progress"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center font-mono text-sm">{secondsLeft}s</span>
        </div>
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}
