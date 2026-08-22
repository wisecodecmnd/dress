import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler } from '../../utils/http.js';
import { serialize } from '../../utils/serialize.js';
import { contains, paged, paginationSchema, skipTake } from './shared.js';
import { updateSettings, getSettings, settingsSchema } from '../../services/settings.js';
import { actor } from './shared.js';
import { logActivity } from '../../services/activity.js';

// ── Activity / notifications ────────────────────────────────────────────────

export const listQuerySchema = paginationSchema.extend({
  entity: z.string().trim().max(40).optional(),
  action: z.string().trim().max(60).optional(),
});

export const listActivity = asyncHandler(async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listQuerySchema>;

  const where = {
    ...(query.entity ? { entity: query.entity } : {}),
    ...(query.action ? { action: { startsWith: query.action } } : {}),
    ...(query.q ? { summary: contains(query.q) } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...skipTake(query),
    }),
    prisma.activityLog.count({ where }),
  ]);

  res.json(serialize(paged(items, total, query)));
});

// ── Settings ────────────────────────────────────────────────────────────────

export const readSettings = asyncHandler(async (_req, res) => {
  res.json({ settings: await getSettings() });
});

/** Partial update — only the keys present are written. */
export const patchSettingsSchema = settingsSchema.partial();

export const writeSettings = asyncHandler(async (req, res) => {
  const patch = req.body as Record<string, unknown>;
  const settings = await updateSettings(patch);

  await logActivity({
    ...actor(req),
    action: 'settings.update',
    entity: 'Setting',
    summary: `Updated business settings: ${Object.keys(patch).join(', ')}`,
    meta: { keys: Object.keys(patch) },
  });

  res.json({ settings });
});
