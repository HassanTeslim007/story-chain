"use client";

export default function HelpModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "color-mix(in srgb, black 55%, transparent)" }}
      onClick={onClose}
    >
      <div className="card w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="wordmark text-lg">{title}</h2>
          <button onClick={onClose} className="btn-icon" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="text-sm opacity-80 space-y-2 leading-relaxed">{children}</div>
        <button onClick={onClose} className="btn-primary w-full">
          Got it
        </button>
      </div>
    </div>
  );
}
