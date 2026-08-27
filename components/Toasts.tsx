export type Toast = { id: string; message: string };

export default function Toasts({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-toast-in rounded-full bg-neutral-900 text-white dark:bg-white dark:text-black text-sm px-4 py-1.5 shadow-lg"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
