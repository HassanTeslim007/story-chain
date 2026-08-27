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

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className={`font-mono ${urgent ? "text-red-500" : ""}`}>{secondsLeft}s</span>
      </div>
      <div className="h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-linear ${
            urgent ? "bg-red-500" : "bg-accent"
          }`}
          style={{ width: `${pct * 100}%`, backgroundColor: urgent ? undefined : "var(--color-accent)" }}
        />
      </div>
    </div>
  );
}
