import { X } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';

const accent = {
  success: 'border-denim/60',
  error: 'border-red-500/60',
  info: 'border-stone',
} as const;

export default function ToastStack() {
  const toasts = useUIStore((s) => s.toasts);
  const dismiss = useUIStore((s) => s.dismissToast);

  return (
    <div
      className="pointer-events-none fixed bottom-6 left-1/2 z-[80] flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-2"
      role="region"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex animate-fade-up items-center justify-between gap-4 border bg-charcoal/95 px-4 py-3 backdrop-blur ${accent[t.kind]}`}
        >
          <span className="text-sm text-pearl">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="text-fog transition-colors hover:text-pearl"
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
