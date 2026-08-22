import { z } from 'zod';
import type { Request } from 'express';

/**
 * Shared query shape for every admin list endpoint. Filtering, sorting and
 * paging all happen in Postgres — the admin never pulls a whole table into
 * memory to slice it in JS.
 */
export const paginationSchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().trim().max(40).optional(),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

export type Pagination = z.infer<typeof paginationSchema>;

export const skipTake = (p: Pick<Pagination, 'page' | 'pageSize'>) => ({
  skip: (p.page - 1) * p.pageSize,
  take: p.pageSize,
});

export const paged = <T>(items: T[], total: number, p: Pagination) => ({
  items,
  total,
  page: p.page,
  pageSize: p.pageSize,
  pageCount: Math.max(1, Math.ceil(total / p.pageSize)),
});

/**
 * Builds an orderBy from an allowlist. An unknown sort key falls back to the
 * default rather than erroring, so a stale bookmark still loads.
 */
export function orderBy<K extends string>(
  p: Pagination,
  allowed: readonly K[],
  fallback: Record<string, 'asc' | 'desc'>,
): Record<string, 'asc' | 'desc'> {
  if (p.sort && (allowed as readonly string[]).includes(p.sort)) {
    return { [p.sort]: p.dir };
  }
  return fallback;
}

/** Case-insensitive contains, or undefined when there's nothing to search. */
export const contains = (q: string | undefined) =>
  q && q.length > 0 ? ({ contains: q, mode: 'insensitive' } as const) : undefined;

/** The signed-in admin, for audit rows. requireAdmin guarantees it exists. */
export const actor = (req: Request) => ({
  actorId: req.auth?.sub ?? null,
  actorEmail: req.auth?.email ?? null,
});

/** Turns a display name into a URL-safe slug. */
export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

export const boundedDate = z.coerce.date();

/** Parses `?from=&to=` into a Prisma date filter. */
export const dateRangeSchema = z.object({
  from: boundedDate.optional(),
  to: boundedDate.optional(),
});

export function dateFilter(range: z.infer<typeof dateRangeSchema>) {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lte: range.to } : {}),
  };
}
