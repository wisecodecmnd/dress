import { Prisma } from '@prisma/client';

/**
 * Prisma Decimal doesn't survive JSON.stringify as a number, and floats would
 * lose paise. Decimals go over the wire as fixed-2 strings; the client coerces.
 */
export const money = (value: Prisma.Decimal | number | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  return value instanceof Prisma.Decimal ? value.toFixed(2) : value.toFixed(2);
};

/** Recursively converts Decimal fields in an API payload to strings. */
export function serialize<T>(input: T): T {
  if (input instanceof Prisma.Decimal) return input.toFixed(2) as unknown as T;
  if (input instanceof Date) return input.toISOString() as unknown as T;
  if (Array.isArray(input)) return input.map((v) => serialize(v)) as unknown as T;

  if (input !== null && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = serialize(value);
    }
    return out as T;
  }

  return input;
}
