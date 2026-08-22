/**
 * Admin-only formatters. Money and dates reuse src/utils/format.ts — these are
 * the extras the operational views need (durations, relative times, deadlines).
 */
export { formatPrice, formatDate } from '../utils/format';

/** Minutes → a compact human duration. 870 → "14.5h", 30 → "30m". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes === 0) return '0m';
  if (minutes < 60) return `${minutes}m`;

  const hours = minutes / 60;
  // Whole and half hours read better than decimals with trailing zeroes.
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded}h`;
}

/** Minutes → working days, given the configured day length. */
export function formatWorkingDays(minutes: number, minutesPerDay: number): string {
  if (minutesPerDay <= 0) return '—';
  const days = minutes / minutesPerDay;
  const rounded = Math.round(days * 10) / 10;
  return rounded === 1 ? '1 day' : `${rounded} days`;
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60_000],
  ['month', 30 * 24 * 60 * 60_000],
  ['day', 24 * 60 * 60_000],
  ['hour', 60 * 60_000],
  ['minute', 60_000],
];

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "2 minutes ago", "in 3 days". */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';

  const delta = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(delta);

  if (abs < 45_000) return 'just now';

  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return relative.format(Math.round(delta / ms), unit);
  }

  return relative.format(Math.round(delta / 60_000), 'minute');
}

/** Date + time, for timestamps where the hour matters. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/** `<input type="date">` wants yyyy-mm-dd in local time. */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** How a deadline should read on the board. */
export function deadlineLabel(
  daysRemaining: number | null,
  isOverdue: boolean,
): string {
  if (daysRemaining === null) return 'No deadline';
  if (isOverdue) {
    const late = Math.abs(daysRemaining);
    return `${late} day${late === 1 ? '' : 's'} overdue`;
  }
  if (daysRemaining === 0) return 'Due today';
  if (daysRemaining === 1) return 'Due tomorrow';
  return `${daysRemaining} days left`;
}

export const customerName = (
  person: { firstName?: string | null; lastName?: string | null; email?: string } | null | undefined,
  fallback = 'Guest',
): string => {
  if (!person) return fallback;
  const name = [person.firstName, person.lastName].filter(Boolean).join(' ');
  return name || person.email || fallback;
};
