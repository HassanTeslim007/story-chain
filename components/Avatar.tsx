const PALETTE = [
  "#db2777",
  "#f97316",
  "#0ea5e9",
  "#16a34a",
  "#8b5cf6",
  "#eab308",
  "#ef4444",
  "#14b8a6",
];

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function Avatar({
  name,
  size = 28,
  faded = false,
}: {
  name: string;
  size?: number;
  faded?: boolean;
}) {
  const color = colorFor(name);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        backgroundColor: color,
        opacity: faded ? 0.4 : 1,
      }}
    >
      {initialsFor(name)}
    </span>
  );
}
