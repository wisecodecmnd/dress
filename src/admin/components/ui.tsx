import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';

/**
 * Shared admin primitives. Dense, functional, and built from the existing
 * Tailwind palette so admin reads as the same product as the storefront.
 */

// ── Layout ──────────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-3xl leading-tight lg:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fog">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  actions,
  children,
  className = '',
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded border border-stone/40 bg-charcoal ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-stone/40 px-4 py-3">
          {title && <h2 className="text-meta uppercase text-mist">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-pearl text-obsidian hover:bg-mist',
  secondary: 'border border-stone/60 text-mist hover:border-pearl hover:text-pearl',
  ghost: 'text-mist hover:bg-stone/30 hover:text-pearl',
  danger: 'border border-red-500/50 text-red-300 hover:bg-red-500/15 hover:text-red-200',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[variant]} ${className}`}
    />
  );
}

// ── Badges ──────────────────────────────────────────────────────────────────

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'accent';

const TONES: Record<Tone, string> = {
  neutral: 'bg-stone/40 text-mist',
  good: 'bg-emerald-500/15 text-emerald-300',
  warn: 'bg-amber-500/15 text-amber-300',
  bad: 'bg-red-500/15 text-red-300',
  info: 'bg-sky-500/15 text-sky-300',
  accent: 'bg-denim/25 text-denim',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-[0.7rem] font-medium uppercase tracking-wide ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Status → tone mapping shared by orders, production and carts. */
export function statusTone(status: string): Tone {
  switch (status) {
    case 'DELIVERED':
    case 'COMPLETED':
    case 'CAPTURED':
    case 'READY':
    case 'CONVERTED':
    case 'ACTIVE':
      return 'good';
    case 'CANCELLED':
    case 'FAILED':
    case 'BLOCKED':
      return 'bad';
    case 'PENDING':
    case 'NOT_STARTED':
    case 'ON_HOLD':
    case 'ABANDONED':
    case 'PARTIALLY_REFUNDED':
    case 'REFUNDED':
      return 'warn';
    case 'IN_PRODUCTION':
    case 'IN_PROGRESS':
    case 'PROCESSING':
    case 'QUALITY_CHECK':
      return 'info';
    case 'SHIPPED':
    case 'CONFIRMED':
    case 'PAID':
      return 'accent';
    default:
      return 'neutral';
  }
}

export const humanise = (value: string) =>
  value.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

// ── Stat cards ──────────────────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
}) {
  const accent =
    tone === 'bad'
      ? 'border-red-500/40'
      : tone === 'warn'
        ? 'border-amber-500/40'
        : tone === 'good'
          ? 'border-emerald-500/40'
          : 'border-stone/40';

  return (
    <div className={`rounded border bg-charcoal p-4 ${accent}`}>
      <p className="text-meta uppercase text-fog">{label}</p>
      <p className="mt-2 font-display text-3xl leading-none">{value}</p>
      {hint && <p className="mt-1 text-xs text-fog">{hint}</p>}
    </div>
  );
}

// ── Tables ──────────────────────────────────────────────────────────────────

/** Wrapper that lets wide tables scroll horizontally instead of breaking. */
export function TableScroll({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Table({ children }: { children: ReactNode }) {
  return <table className="w-full min-w-[48rem] border-collapse text-sm">{children}</table>;
}

export function Th({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className={`border-b border-stone/40 px-3 py-2 text-left text-meta uppercase text-fog ${
        onClick ? 'cursor-pointer select-none hover:text-pearl' : ''
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <td className={`border-b border-stone/25 px-3 py-2.5 align-middle ${className}`}>{children}</td>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-12 text-center text-sm text-fog">
        {children}
      </td>
    </tr>
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────────

const FIELD =
  'w-full rounded border border-stone/50 bg-obsidian px-3 py-2 text-sm text-pearl outline-none transition-colors placeholder:text-fog focus:border-denim disabled:opacity-50';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD} ${props.className ?? ''}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${FIELD} ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${FIELD} ${props.className ?? ''}`} />;
}

export function Field({
  label,
  hint,
  error,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs uppercase tracking-wide text-fog">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-fog">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-300">{error}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-mist">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-stone/60 bg-obsidian accent-denim"
      />
      {label}
    </label>
  );
}

/** Debounced search box — the value only propagates once typing settles. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  delay = 300,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  delay?: number;
}) {
  const [local, setLocal] = useState(value);
  const first = useRef(true);

  // Keep in sync when the parent resets the query (e.g. clearing filters).
  useEffect(() => setLocal(value), [value]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (local === value) return;

    const id = window.setTimeout(() => onChange(local), delay);
    return () => window.clearTimeout(id);
    // `value`/`onChange` intentionally excluded: this fires on typing only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, delay]);

  return (
    <div className="relative">
      <Search
        size={15}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fog"
      />
      <input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className={`${FIELD} pl-8 pr-8`}
      />
      {local && (
        <button
          onClick={() => {
            setLocal('');
            onChange('');
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-fog hover:text-pearl"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// ── Pagination ──────────────────────────────────────────────────────────────

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (next: number) => void;
}) {
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-stone/40 px-4 py-3 sm:flex-row">
      <p className="text-xs text-fog">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span className="px-1 text-xs text-fog">
          {page} / {pageCount}
        </span>
        <Button variant="secondary" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div className="fixed inset-0 bg-obsidian/85" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative my-8 w-full rounded border border-stone/50 bg-charcoal ${
          wide ? 'max-w-4xl' : 'max-w-xl'
        }`}
      >
        <div className="flex items-center justify-between border-b border-stone/40 px-5 py-3">
          <h2 className="font-display text-xl">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1.5 text-fog hover:bg-stone/30 hover:text-pearl"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// ── Feedback ────────────────────────────────────────────────────────────────

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
      <p>{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 underline hover:no-underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function Loading({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded bg-stone/25" />
      ))}
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-stone/40">
        <div className="h-full rounded-full bg-denim" style={{ width: `${clamped}%` }} />
      </div>
      <span className="text-xs text-fog">{clamped}%</span>
    </div>
  );
}
