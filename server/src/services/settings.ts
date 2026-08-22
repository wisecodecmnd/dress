import { z } from 'zod';
import { prisma } from '../config/prisma.js';

/**
 * Business settings. Defaults live here so a fresh database is fully
 * operational before an admin ever opens /admin/settings; the Setting table
 * only stores overrides.
 *
 * Every key below is read by real code — see the `used by` note on each.
 */
export const settingsSchema = z.object({
  /** Days before a production deadline that an order counts as "due soon".
      Used by the dashboard alerts and the production board. */
  productionWarningDays: z.coerce.number().int().min(0).max(60).default(3),

  /** Productive minutes available per working day, used to convert a plan's
      estimated minutes into calendar dates. */
  productionMinutesPerDay: z.coerce.number().int().min(30).max(1440).default(480),

  /** ISO weekdays (1 = Monday … 7 = Sunday) the workshop runs on. Deadline
      maths skips every other day. */
  workingDays: z.array(z.coerce.number().int().min(1).max(7)).min(1).default([1, 2, 3, 4, 5, 6]),

  /** Calendar days added after production completes to reach the customer. */
  deliveryBufferDays: z.coerce.number().int().min(0).max(60).default(3),

  /** Fallback duration (minutes) for a product with no configured processes. */
  defaultProcessDuration: z.coerce.number().int().min(1).max(100_000).default(60),

  /** ISO 4217 code used to label money in the admin UI. */
  currency: z.string().trim().length(3).default('INR'),

  /** IANA zone the admin UI labels dates with. */
  timezone: z.string().trim().min(1).max(64).default('Asia/Kolkata'),

  /** Prefix for generated order numbers. */
  orderNumberPrefix: z
    .string()
    .trim()
    .regex(/^[A-Z]{1,6}$/, 'Use 1–6 uppercase letters')
    .default('DQ'),

  /** Status a newly placed order is created with. */
  defaultOrderStatus: z.enum(['PENDING', 'CONFIRMED']).default('PENDING'),

  /** Whether a category created through admin starts visible on the storefront. */
  defaultCategoryVisible: z.coerce.boolean().default(true),

  /** Minutes of inactivity after which a cart with items reads as abandoned. */
  cartAbandonedAfterMinutes: z.coerce.number().int().min(5).max(20_160).default(240),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

/**
 * Reads every override and layers it over the defaults. Unknown or corrupt
 * rows are ignored rather than throwing, so one bad value can't take the
 * admin panel down.
 */
export async function getSettings(): Promise<Settings> {
  const rows = await prisma.setting.findMany();

  const overrides: Record<string, unknown> = {};
  for (const row of rows) {
    if ((SETTING_KEYS as string[]).includes(row.key)) overrides[row.key] = row.value;
  }

  const merged = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...overrides });
  return merged.success ? merged.data : DEFAULT_SETTINGS;
}

/** Validates and persists a partial update, returning the full merged set. */
export async function updateSettings(patch: Record<string, unknown>): Promise<Settings> {
  const current = await getSettings();
  const next = settingsSchema.parse({ ...current, ...patch });

  const changed = SETTING_KEYS.filter(
    (key) => JSON.stringify(next[key]) !== JSON.stringify(current[key]),
  );

  await prisma.$transaction(
    changed.map((key) =>
      prisma.setting.upsert({
        where: { key },
        create: { key, value: next[key] as never },
        update: { value: next[key] as never },
      }),
    ),
  );

  return next;
}
