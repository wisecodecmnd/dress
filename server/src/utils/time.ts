import { env } from '../config/env.js';

/**
 * One business timezone for every server-side day boundary.
 *
 * "Today", "due tomorrow" and "completed today" must not depend on whether the
 * container happens to run in UTC or the operator's laptop runs in IST. Every
 * such window is derived here from BUSINESS_TIMEZONE.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Falls back to UTC rather than crashing on a mistyped zone. */
function resolveZone(zone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    console.warn(`[time] BUSINESS_TIMEZONE "${zone}" is not a known IANA zone — using UTC`);
    return 'UTC';
  }
}

export const BUSINESS_TIMEZONE = resolveZone(env.BUSINESS_TIMEZONE);

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** The zone's wall-clock reading of an instant, expressed as a UTC timestamp. */
function wallClock(at: Date): number {
  const map = new Map(parts.formatToParts(at).map((p) => [p.type, p.value]));
  return Date.UTC(
    Number(map.get('year')),
    Number(map.get('month')) - 1,
    Number(map.get('day')),
    // Some ICU builds render midnight as hour 24 under hour12: false.
    Number(map.get('hour')) % 24,
    Number(map.get('minute')),
    Number(map.get('second')),
  );
}

/** The zone's offset from UTC, in milliseconds, at the given instant. */
const offsetMs = (at: Date): number => wallClock(at) - (at.getTime() - at.getMilliseconds());

/**
 * The instant at which the business day containing `at` began. Comparable
 * directly against stored UTC timestamps.
 */
export function startOfBusinessDay(at: Date = new Date()): Date {
  const local = new Date(wallClock(at));
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());

  // Re-resolve the offset at the candidate instant, so a DST transition between
  // midnight and `at` doesn't shift the boundary by an hour.
  const candidate = new Date(midnightLocal - offsetMs(at));
  return new Date(midnightLocal - offsetMs(candidate));
}

/** Whole days added to an instant; used to build day-aligned windows. */
export const addDays = (at: Date, days: number): Date =>
  new Date(at.getTime() + days * DAY_MS);

/**
 * `[start, end)` for the business day containing `at`, plus the following days,
 * which is the shape every dashboard/production window needs.
 */
export function businessDayWindows(at: Date = new Date()) {
  const today = startOfBusinessDay(at);
  return {
    today,
    tomorrow: startOfBusinessDay(addDays(today, 1)),
    dayAfter: startOfBusinessDay(addDays(today, 2)),
  };
}
