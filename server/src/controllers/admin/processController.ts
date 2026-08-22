import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { serialize } from '../../utils/serialize.js';
import { logActivity } from '../../services/activity.js';
import { estimatePlan, resolveStages } from '../../services/production.js';
import { actor, contains, paged, paginationSchema, skipTake, slugify } from './shared.js';

// ── Process stage library ───────────────────────────────────────────────────

export const listQuerySchema = paginationSchema.extend({
  status: z.enum(['all', 'active', 'inactive', 'archived']).default('all'),
});

export const listStages = asyncHandler(async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listQuerySchema>;

  const where = {
    ...(query.status === 'archived'
      ? { archivedAt: { not: null } }
      : {
          archivedAt: null,
          ...(query.status === 'active' ? { isActive: true } : {}),
          ...(query.status === 'inactive' ? { isActive: false } : {}),
        }),
    ...(query.q ? { OR: [{ name: contains(query.q) }, { slug: contains(query.q) }] } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.processStage.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
      ...skipTake(query),
      include: { _count: { select: { products: true } } },
    }),
    prisma.processStage.count({ where }),
  ]);

  const items = rows.map(({ _count, ...s }) => ({ ...s, productCount: _count.products }));

  res.json(serialize(paged(items, total, query)));
});

const stageBody = z.object({
  name: z.string().trim().min(2, 'Name is required').max(80),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens')
    .max(80)
    .optional(),
  description: z.string().trim().max(600).nullish(),
  /** Minutes for one unit. The UI collects hours and converts. */
  defaultDuration: z.coerce.number().int().min(1, 'Duration must be at least a minute').max(100_000),
  durationUnit: z.enum(['MINUTES', 'HOURS', 'DAYS']).default('HOURS'),
  defaultCost: z.coerce.number().min(0).max(10_000_000).default(0),
  isActive: z.coerce.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

export const createStageSchema = stageBody;
export const updateStageSchema = stageBody.partial();

export const createStage = asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof createStageSchema>;

  const slug = input.slug ?? slugify(input.name);
  if (!slug) throw HttpError.badRequest('That name does not produce a usable slug');

  const clash = await prisma.processStage.findUnique({ where: { slug }, select: { id: true } });
  if (clash) throw HttpError.conflict('A process stage with that slug already exists');

  // New stages land at the end of the list unless told otherwise.
  const last = await prisma.processStage.findFirst({
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  const stage = await prisma.processStage.create({
    data: {
      name: input.name,
      slug,
      description: input.description ?? null,
      defaultDuration: input.defaultDuration,
      durationUnit: input.durationUnit,
      defaultCost: new Prisma.Decimal(input.defaultCost),
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? (last ? last.sortOrder + 1 : 0),
    },
  });

  await logActivity({
    ...actor(req),
    action: 'process.create',
    entity: 'ProcessStage',
    entityId: stage.id,
    summary: `Created process stage ${stage.name} (${stage.defaultDuration} min default)`,
  });

  res.status(201).json(serialize({ stage }));
});

export const updateStage = asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof updateStageSchema>;

  const existing = await prisma.processStage.findUnique({ where: { id: req.params.id } });
  if (!existing) throw HttpError.notFound('Process stage not found');

  if (input.slug && input.slug !== existing.slug) {
    const clash = await prisma.processStage.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (clash) throw HttpError.conflict('A process stage with that slug already exists');
  }

  const stage = await prisma.processStage.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.defaultDuration !== undefined ? { defaultDuration: input.defaultDuration } : {}),
      ...(input.durationUnit !== undefined ? { durationUnit: input.durationUnit } : {}),
      ...(input.defaultCost !== undefined
        ? { defaultCost: new Prisma.Decimal(input.defaultCost) }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });

  const summary =
    input.defaultDuration !== undefined && input.defaultDuration !== existing.defaultDuration
      ? `Changed ${stage.name} default duration from ${existing.defaultDuration} to ${stage.defaultDuration} min`
      : input.defaultCost !== undefined && !existing.defaultCost.equals(stage.defaultCost)
        ? `Changed ${stage.name} default cost from ${existing.defaultCost.toFixed(2)} to ${stage.defaultCost.toFixed(2)}`
        : `Updated process stage ${stage.name}`;

  await logActivity({
    ...actor(req),
    action: 'process.update',
    entity: 'ProcessStage',
    entityId: stage.id,
    summary,
  });

  res.json(serialize({ stage }));
});

/** Archived when in use by any product, so live plans keep their reference. */
export const deleteStage = asyncHandler(async (req, res) => {
  const existing = await prisma.processStage.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { products: true, productionStages: true } } },
  });
  if (!existing) throw HttpError.notFound('Process stage not found');

  if (existing._count.products > 0 || existing._count.productionStages > 0) {
    const stage = await prisma.processStage.update({
      where: { id: existing.id },
      data: { archivedAt: new Date(), isActive: false },
    });

    await logActivity({
      ...actor(req),
      action: 'process.archive',
      entity: 'ProcessStage',
      entityId: stage.id,
      summary: `Archived process stage ${stage.name} (still referenced by live work)`,
    });

    return res.json(serialize({ stage, archived: true }));
  }

  await prisma.processStage.delete({ where: { id: existing.id } });

  await logActivity({
    ...actor(req),
    action: 'process.delete',
    entity: 'ProcessStage',
    entityId: existing.id,
    summary: `Deleted process stage ${existing.name}`,
  });

  res.json({ ok: true, archived: false });
});

export const reorderStagesSchema = z.object({
  order: z
    .array(z.object({ id: z.string().min(1), sortOrder: z.coerce.number().int().min(0) }))
    .min(1)
    .max(200),
});

export const reorderStages = asyncHandler(async (req, res) => {
  const { order } = req.body as z.infer<typeof reorderStagesSchema>;

  await prisma.$transaction(
    order.map((row) =>
      prisma.processStage.update({ where: { id: row.id }, data: { sortOrder: row.sortOrder } }),
    ),
  );

  await logActivity({
    ...actor(req),
    action: 'process.reorder',
    entity: 'ProcessStage',
    summary: `Reordered ${order.length} process stages`,
  });

  res.json({ ok: true });
});

// ── Per-product process configuration ───────────────────────────────────────

const withStage = {
  stage: {
    select: {
      id: true,
      name: true,
      slug: true,
      defaultDuration: true,
      defaultCost: true,
      durationUnit: true,
      isActive: true,
    },
  },
} as const;

/**
 * Returns the product's configured stages plus the rolled-up totals the admin
 * UI displays. Individual rows are always returned alongside the total, so the
 * admin can see where the time and cost actually sit.
 */
async function processesFor(productId: string) {
  const rows = await prisma.productProcess.findMany({
    where: { productId },
    include: withStage,
    orderBy: { sortOrder: 'asc' },
  });

  const resolved = resolveStages(rows as never);
  const estimate = estimatePlan(resolved, 1);

  return {
    processes: rows.map((row) => ({
      ...row,
      // What this row will actually contribute, after override resolution.
      effectiveDuration: row.duration ?? row.stage.defaultDuration,
      effectiveCost: row.cost ?? row.stage.defaultCost,
    })),
    totalDuration: estimate.unitMinutes,
    totalCost: estimate.unitCost,
  };
}

export const getProductProcesses = asyncHandler(async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true },
  });
  if (!product) throw HttpError.notFound('Product not found');

  res.json(serialize({ product, ...(await processesFor(product.id)) }));
});

export const attachSchema = z.object({
  stageId: z.string().min(1),
  duration: z.coerce.number().int().min(1).max(100_000).nullish(),
  cost: z.coerce.number().min(0).max(10_000_000).nullish(),
  isMandatory: z.coerce.boolean().optional(),
  notes: z.string().trim().max(600).nullish(),
});

export const attachProcess = asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof attachSchema>;
  const productId = req.params.id;

  const [product, stage] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true } }),
    prisma.processStage.findUnique({
      where: { id: input.stageId },
      select: { id: true, name: true, archivedAt: true },
    }),
  ]);

  if (!product) throw HttpError.notFound('Product not found');
  if (!stage) throw HttpError.badRequest('That process stage does not exist');
  if (stage.archivedAt) throw HttpError.badRequest('That process stage is archived');

  const clash = await prisma.productProcess.findUnique({
    where: { productId_stageId: { productId, stageId: stage.id } },
    select: { id: true },
  });
  if (clash) throw HttpError.conflict('That stage is already on this product');

  const last = await prisma.productProcess.findFirst({
    where: { productId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  await prisma.productProcess.create({
    data: {
      productId,
      stageId: stage.id,
      sortOrder: last ? last.sortOrder + 1 : 0,
      duration: input.duration ?? null,
      cost: input.cost != null ? new Prisma.Decimal(input.cost) : null,
      isMandatory: input.isMandatory ?? true,
      notes: input.notes ?? null,
    },
  });

  await logActivity({
    ...actor(req),
    action: 'product.process.attach',
    entity: 'Product',
    entityId: productId,
    summary: `Added stage ${stage.name} to ${product.name}`,
  });

  res.status(201).json(serialize(await processesFor(productId)));
});

export const updateProcessSchema = z.object({
  duration: z.coerce.number().int().min(1).max(100_000).nullish(),
  cost: z.coerce.number().min(0).max(10_000_000).nullish(),
  isMandatory: z.coerce.boolean().optional(),
  notes: z.string().trim().max(600).nullish(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

export const updateProcess = asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof updateProcessSchema>;

  const existing = await prisma.productProcess.findFirst({
    where: { id: req.params.processId, productId: req.params.id },
    include: withStage,
  });
  if (!existing) throw HttpError.notFound('That stage is not on this product');

  await prisma.productProcess.update({
    where: { id: existing.id },
    data: {
      ...(input.duration !== undefined ? { duration: input.duration } : {}),
      ...(input.cost !== undefined
        ? { cost: input.cost != null ? new Prisma.Decimal(input.cost) : null }
        : {}),
      ...(input.isMandatory !== undefined ? { isMandatory: input.isMandatory } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });

  await logActivity({
    ...actor(req),
    action: 'product.process.update',
    entity: 'Product',
    entityId: req.params.id,
    summary: `Updated stage ${existing.stage.name} configuration`,
    meta: { changes: Object.keys(input) },
  });

  res.json(serialize(await processesFor(req.params.id)));
});

export const detachProcess = asyncHandler(async (req, res) => {
  const existing = await prisma.productProcess.findFirst({
    where: { id: req.params.processId, productId: req.params.id },
    include: withStage,
  });
  if (!existing) throw HttpError.notFound('That stage is not on this product');

  await prisma.productProcess.delete({ where: { id: existing.id } });

  await logActivity({
    ...actor(req),
    action: 'product.process.detach',
    entity: 'Product',
    entityId: req.params.id,
    summary: `Removed stage ${existing.stage.name} from the product`,
  });

  res.json(serialize(await processesFor(req.params.id)));
});

export const reorderProcessesSchema = z.object({
  order: z
    .array(z.object({ id: z.string().min(1), sortOrder: z.coerce.number().int().min(0) }))
    .min(1)
    .max(100),
});

export const reorderProcesses = asyncHandler(async (req, res) => {
  const { order } = req.body as z.infer<typeof reorderProcessesSchema>;
  const productId = req.params.id;

  // Scoped to this product so one product's payload can't reorder another's.
  const owned = await prisma.productProcess.findMany({
    where: { productId, id: { in: order.map((o) => o.id) } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((o) => o.id));
  const updates = order.filter((o) => ownedIds.has(o.id));

  if (updates.length !== order.length) {
    throw HttpError.badRequest('One of those stages is not on this product');
  }

  await prisma.$transaction(
    updates.map((row) =>
      prisma.productProcess.update({ where: { id: row.id }, data: { sortOrder: row.sortOrder } }),
    ),
  );

  await logActivity({
    ...actor(req),
    action: 'product.process.reorder',
    entity: 'Product',
    entityId: productId,
    summary: `Reordered ${updates.length} process stages`,
  });

  res.json(serialize(await processesFor(productId)));
});

/** Copies the whole active stage library onto a product in one call. */
export const applyDefaults = asyncHandler(async (req, res) => {
  const productId = req.params.id;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true },
  });
  if (!product) throw HttpError.notFound('Product not found');

  const stages = await prisma.processStage.findMany({
    where: { isActive: true, archivedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { id: true },
  });

  const existing = await prisma.productProcess.findMany({
    where: { productId },
    select: { stageId: true },
  });
  const have = new Set(existing.map((e) => e.stageId));
  const missing = stages.filter((s) => !have.has(s.id));

  if (missing.length > 0) {
    await prisma.productProcess.createMany({
      data: missing.map((s, i) => ({
        productId,
        stageId: s.id,
        sortOrder: existing.length + i,
      })),
    });
  }

  await logActivity({
    ...actor(req),
    action: 'product.process.applyDefaults',
    entity: 'Product',
    entityId: productId,
    summary: `Applied ${missing.length} default process stages to ${product.name}`,
  });

  res.json(serialize(await processesFor(productId)));
});
