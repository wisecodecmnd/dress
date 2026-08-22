import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { serialize } from '../../utils/serialize.js';
import { logActivity } from '../../services/activity.js';
import {
  addWorkingTime,
  currentStageOf,
  deadlineView,
  minutesBetween,
  progressOf,
  remainingMinutesOf,
} from '../../services/production.js';
import { getSettings } from '../../services/settings.js';
import { actor, contains, paged, paginationSchema, skipTake } from './shared.js';
import { addDays, businessDayWindows, startOfBusinessDay } from '../../utils/time.js';

const planSelect = {
  id: true,
  quantity: true,
  status: true,
  estimatedMinutes: true,
  estimatedCost: true,
  estimatedStartAt: true,
  estimatedCompletionAt: true,
  deadlineAt: true,
  actualStartAt: true,
  actualCompletionAt: true,
  notes: true,
  createdAt: true,
  order: {
    select: {
      id: true,
      number: true,
      status: true,
      priority: true,
      email: true,
      createdAt: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  },
  orderItem: { select: { id: true, name: true, size: true, quantity: true } },
  product: { select: { id: true, name: true, slug: true } },
  stages: { orderBy: { sortOrder: 'asc' as const } },
} as const;

export const listQuerySchema = paginationSchema.extend({
  status: z
    .enum(['all', 'NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'])
    .default('all'),
  /** `active` is the default board view: everything still to be made. */
  view: z.enum(['all', 'active', 'overdue', 'dueSoon', 'dueToday', 'dueTomorrow', 'completedToday']).default('all'),
  stage: z.string().trim().max(80).optional(),
});

export const listProduction = asyncHandler(async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listQuerySchema>;
  const settings = await getSettings();
  const now = new Date();

  const { today, tomorrow, dayAfter } = businessDayWindows(now);
  const warnUntil = startOfBusinessDay(addDays(today, settings.productionWarningDays + 1));

  const live: Prisma.ProductionOrderWhereInput = {
    status: { notIn: ['COMPLETED', 'CANCELLED'] },
  };

  const viewWhere: Record<string, Prisma.ProductionOrderWhereInput> = {
    all: {},
    active: live,
    overdue: { ...live, deadlineAt: { lt: now } },
    dueSoon: { ...live, deadlineAt: { gte: now, lt: warnUntil } },
    dueToday: { ...live, deadlineAt: { gte: today, lt: tomorrow } },
    dueTomorrow: { ...live, deadlineAt: { gte: tomorrow, lt: dayAfter } },
    completedToday: { status: 'COMPLETED', actualCompletionAt: { gte: today, lt: tomorrow } },
  };

  const where: Prisma.ProductionOrderWhereInput = {
    ...viewWhere[query.view],
    ...(query.status !== 'all' ? { status: query.status } : {}),
    ...(query.stage
      ? { stages: { some: { name: contains(query.stage), status: 'IN_PROGRESS' } } }
      : {}),
    ...(query.q
      ? {
          OR: [
            { order: { number: contains(query.q) } },
            { order: { email: contains(query.q) } },
            { product: { name: contains(query.q) } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.productionOrder.findMany({
      where,
      // Nulls last so undated plans don't crowd the top of the board.
      orderBy: [{ deadlineAt: 'asc' }, { createdAt: 'asc' }],
      ...skipTake(query),
      select: planSelect,
    }),
    prisma.productionOrder.count({ where }),
  ]);

  const items = rows.map((plan) => decorate(plan, settings, now));

  res.json(serialize({ ...paged(items, total, query), warningDays: settings.productionWarningDays }));
});

type PlanRow = Prisma.ProductionOrderGetPayload<{ select: typeof planSelect }>;

/** Adds the derived fields the board renders: current stage, progress, deadline state. */
function decorate(plan: PlanRow, settings: Awaited<ReturnType<typeof getSettings>>, now: Date) {
  const current = currentStageOf(plan.stages);

  return {
    ...plan,
    currentStage: current ? { id: current.id, name: current.name, status: current.status } : null,
    progress: progressOf(plan.stages),
    remainingMinutes: remainingMinutesOf(plan.stages),
    ...deadlineView(plan, settings, now),
  };
}

export const getPlan = asyncHandler(async (req, res) => {
  const settings = await getSettings();

  const plan = await prisma.productionOrder.findUnique({
    where: { id: req.params.id },
    select: planSelect,
  });
  if (!plan) throw HttpError.notFound('Production plan not found');

  res.json(serialize({ plan: decorate(plan, settings, new Date()) }));
});

/**
 * Recomputes the order-level rollup after a plan moves, so the order list and
 * dashboard reflect production without a second source of truth.
 */
async function syncOrderFromProduction(
  tx: Prisma.TransactionClient,
  orderId: string,
  actorEmail: string | null,
) {
  const plans = await tx.productionOrder.findMany({
    where: { orderId },
    select: { status: true },
  });

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { status: true, number: true },
  });
  if (!order) return;

  // Only advance an order that is still pre-dispatch; never walk back from
  // SHIPPED/DELIVERED or override a cancellation.
  const advanceable = ['PENDING', 'CONFIRMED', 'PAID', 'PROCESSING', 'IN_PRODUCTION'];
  if (!advanceable.includes(order.status)) return;

  const allDone = plans.length > 0 && plans.every((p) => p.status === 'COMPLETED');
  const anyStarted = plans.some((p) => p.status === 'IN_PROGRESS');

  const next = allDone ? 'READY' : anyStarted ? 'IN_PRODUCTION' : null;
  if (!next || next === order.status) return;

  await tx.order.update({ where: { id: orderId }, data: { status: next } });
  await tx.orderEvent.create({
    data: {
      orderId,
      label: next === 'READY' ? 'Ready for dispatch' : 'Production started',
      detail: next === 'READY' ? 'All production stages completed' : undefined,
      actorEmail,
    },
  });
}

export const startProduction = asyncHandler(async (req, res) => {
  const admin = actor(req);

  const existing = await prisma.productionOrder.findUnique({
    where: { id: req.params.id },
    include: { order: { select: { id: true, number: true } }, stages: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!existing) throw HttpError.notFound('Production plan not found');
  if (existing.status === 'COMPLETED') throw HttpError.badRequest('That plan is already complete');
  if (existing.status === 'CANCELLED') throw HttpError.badRequest('That plan was cancelled');
  if (existing.actualStartAt) throw HttpError.badRequest('Production has already started');

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Conditional on the plan still being unstarted. Two admins pressing Start
    // at the same moment both pass the checks above; only one gets past here,
    // so the recorded start time and the opened stage stay single-valued.
    const claimed = await tx.productionOrder.updateMany({
      where: { id: existing.id, actualStartAt: null, status: { in: ['NOT_STARTED', 'ON_HOLD'] } },
      data: { status: 'IN_PROGRESS', actualStartAt: now },
    });
    if (claimed.count === 0) throw HttpError.conflict('Production has already started');

    // Open the first outstanding stage so the board always shows current work.
    const first = existing.stages.find((s) => s.status === 'PENDING');
    if (first) {
      await tx.productionStage.updateMany({
        where: { id: first.id, status: 'PENDING' },
        data: { status: 'IN_PROGRESS', startedAt: now },
      });
    }

    await syncOrderFromProduction(tx, existing.order.id, admin.actorEmail);
  });

  await logActivity({
    ...admin,
    action: 'production.start',
    entity: 'ProductionOrder',
    entityId: existing.id,
    summary: `Started production for order ${existing.order.number}`,
  });

  res.json(serialize(await reload(existing.id)));
});

async function reload(id: string) {
  const settings = await getSettings();
  const plan = await prisma.productionOrder.findUniqueOrThrow({
    where: { id },
    select: planSelect,
  });
  return { plan: decorate(plan, settings, new Date()) };
}

export const stageUpdateSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'SKIPPED']).optional(),
  assignee: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

/**
 * Moves one stage. Completing a stage records the completion time, derives the
 * actual duration from when it started, and opens the next stage — so the
 * board advances itself rather than relying on the admin to remember.
 */
export const updateStage = asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof stageUpdateSchema>;
  const admin = actor(req);
  const now = new Date();

  const stage = await prisma.productionStage.findFirst({
    where: { id: req.params.stageId, productionOrderId: req.params.id },
    include: {
      productionOrder: {
        select: {
          id: true,
          status: true,
          actualStartAt: true,
          orderId: true,
          order: { select: { number: true } },
        },
      },
    },
  });
  if (!stage) throw HttpError.notFound('That stage is not on this production plan');

  const plan = stage.productionOrder;
  if (plan.status === 'CANCELLED') throw HttpError.badRequest('That plan was cancelled');

  await prisma.$transaction(async (tx) => {
    const completing = input.status === 'COMPLETED' && stage.status !== 'COMPLETED';
    const starting = input.status === 'IN_PROGRESS' && stage.status !== 'IN_PROGRESS';

    // A stage completed without ever being started still gets a start time, so
    // actual duration is never null for finished work.
    const startedAt = stage.startedAt ?? (completing || starting ? now : null);

    // Optimistic concurrency: the write only lands if the stage is still in the
    // status this request was based on. Two admins completing the same stage
    // together would otherwise both record a completion time, both compute an
    // actual duration, and both open the following stage.
    const moved = await tx.productionStage.updateMany({
      where: { id: stage.id, status: stage.status },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(starting || completing ? { startedAt } : {}),
        ...(completing
          ? {
              completedAt: now,
              actualMinutes: startedAt ? minutesBetween(startedAt, now) : 0,
            }
          : {}),
        // Reopening a completed stage clears its completion record.
        ...(input.status && input.status !== 'COMPLETED' && stage.status === 'COMPLETED'
          ? { completedAt: null, actualMinutes: null }
          : {}),
      },
    });

    if (moved.count === 0) {
      throw HttpError.conflict('Someone else just moved that stage — reload the board');
    }

    // The plan is in progress the moment any stage is.
    if (starting || completing) {
      await tx.productionOrder.update({
        where: { id: plan.id },
        data: {
          ...(plan.status === 'NOT_STARTED' ? { status: 'IN_PROGRESS' } : {}),
          ...(plan.actualStartAt ? {} : { actualStartAt: now }),
        },
      });
    }

    if (completing) {
      const siblings = await tx.productionStage.findMany({
        where: { productionOrderId: plan.id },
        orderBy: { sortOrder: 'asc' },
      });

      const next = siblings.find(
        (s) => s.sortOrder > stage.sortOrder && s.status === 'PENDING',
      );

      if (next) {
        await tx.productionStage.updateMany({
          where: { id: next.id, status: 'PENDING' },
          data: { status: 'IN_PROGRESS', startedAt: now },
        });
      }

      // Every stage settled → the plan is done.
      const outstanding = siblings.filter(
        (s) => s.id !== stage.id && s.status !== 'COMPLETED' && s.status !== 'SKIPPED',
      );

      if (outstanding.length === 0) {
        await tx.productionOrder.update({
          where: { id: plan.id },
          data: { status: 'COMPLETED', actualCompletionAt: now },
        });
      }
    }

    await syncOrderFromProduction(tx, plan.orderId, admin.actorEmail);
  });

  await logActivity({
    ...admin,
    action: input.status === 'COMPLETED' ? 'production.stage.complete' : 'production.stage.update',
    entity: 'ProductionOrder',
    entityId: plan.id,
    summary:
      input.status === 'COMPLETED'
        ? `Completed ${stage.name} on order ${plan.order.number}`
        : input.status
          ? `Moved ${stage.name} to ${input.status} on order ${plan.order.number}`
          : `Updated ${stage.name} on order ${plan.order.number}`,
  });

  res.json(serialize(await reload(plan.id)));
});

export const planUpdateSchema = z.object({
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).optional(),
  deadlineAt: z.coerce.date().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const updatePlan = asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof planUpdateSchema>;
  const admin = actor(req);

  const existing = await prisma.productionOrder.findUnique({
    where: { id: req.params.id },
    include: { order: { select: { id: true, number: true } } },
  });
  if (!existing) throw HttpError.notFound('Production plan not found');

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.productionOrder.update({
      where: { id: existing.id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.status === 'COMPLETED' && !existing.actualCompletionAt
          ? { actualCompletionAt: now }
          : {}),
        ...(input.status === 'IN_PROGRESS' && !existing.actualStartAt
          ? { actualStartAt: now }
          : {}),
      },
    });

    // Marking the plan complete settles any stage still outstanding.
    if (input.status === 'COMPLETED') {
      await tx.productionStage.updateMany({
        where: { productionOrderId: existing.id, status: { in: ['PENDING', 'IN_PROGRESS', 'BLOCKED'] } },
        data: { status: 'COMPLETED', completedAt: now },
      });
    }

    await syncOrderFromProduction(tx, existing.order.id, admin.actorEmail);
  });

  await logActivity({
    ...admin,
    action: input.deadlineAt !== undefined ? 'production.deadline' : 'production.update',
    entity: 'ProductionOrder',
    entityId: existing.id,
    summary:
      input.deadlineAt !== undefined
        ? `Changed deadline on order ${existing.order.number} to ${input.deadlineAt ? input.deadlineAt.toDateString() : 'none'}`
        : `Updated production plan for order ${existing.order.number}`,
  });

  res.json(serialize(await reload(existing.id)));
});

/**
 * Re-quotes a plan from the product's *current* process configuration. Used
 * when a plan was created before the product's processes were set up.
 */
export const rebuildPlan = asyncHandler(async (req, res) => {
  const admin = actor(req);

  const existing = await prisma.productionOrder.findUnique({
    where: { id: req.params.id },
    include: { order: { select: { id: true, number: true, createdAt: true } }, stages: true },
  });
  if (!existing) throw HttpError.notFound('Production plan not found');

  if (existing.stages.some((s) => s.status !== 'PENDING')) {
    throw HttpError.badRequest('Work has already started on this plan — rebuild is not safe');
  }

  const settings = await getSettings();

  const processes = await prisma.productProcess.findMany({
    where: { productId: existing.productId },
    include: {
      stage: {
        select: { id: true, name: true, defaultDuration: true, defaultCost: true, isActive: true },
      },
    },
    orderBy: { sortOrder: 'asc' },
  });

  const active = processes.filter((p) => p.stage.isActive);
  if (active.length === 0) throw HttpError.badRequest('That product has no active process stages');

  const totalMinutes = active.reduce(
    (sum, p) => sum + (p.duration ?? p.stage.defaultDuration) * existing.quantity,
    0,
  );
  const totalCost = active.reduce(
    (sum, p) => sum.add((p.cost ?? p.stage.defaultCost).mul(existing.quantity)),
    new Prisma.Decimal(0),
  );

  const completion = addWorkingTime(existing.order.createdAt, totalMinutes, settings);

  await prisma.$transaction(async (tx) => {
    await tx.productionStage.deleteMany({ where: { productionOrderId: existing.id } });

    await tx.productionOrder.update({
      where: { id: existing.id },
      data: {
        estimatedMinutes: totalMinutes,
        estimatedCost: totalCost,
        estimatedCompletionAt: completion,
        deadlineAt: completion,
        stages: {
          create: active.map((p, i) => ({
            stageId: p.stageId,
            name: p.stage.name,
            sortOrder: i,
            status: 'PENDING',
            estimatedMinutes: (p.duration ?? p.stage.defaultDuration) * existing.quantity,
            cost: (p.cost ?? p.stage.defaultCost).mul(existing.quantity),
            isMandatory: p.isMandatory,
          })),
        },
      },
    });
  });

  await logActivity({
    ...admin,
    action: 'production.rebuild',
    entity: 'ProductionOrder',
    entityId: existing.id,
    summary: `Rebuilt production plan for order ${existing.order.number} from current process config`,
  });

  res.json(serialize(await reload(existing.id)));
});

/** Board counters used by the dashboard's production panel. */
export const productionSummary = asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  const now = new Date();
  const { today, tomorrow, dayAfter } = businessDayWindows(now);
  const warnUntil = startOfBusinessDay(addDays(today, settings.productionWarningDays + 1));

  const live: Prisma.ProductionOrderWhereInput = {
    status: { notIn: ['COMPLETED', 'CANCELLED'] },
  };

  const [inProduction, dueToday, dueTomorrow, overdue, dueSoon, completedToday, notStarted] =
    await Promise.all([
      prisma.productionOrder.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.productionOrder.count({ where: { ...live, deadlineAt: { gte: today, lt: tomorrow } } }),
      prisma.productionOrder.count({
        where: { ...live, deadlineAt: { gte: tomorrow, lt: dayAfter } },
      }),
      prisma.productionOrder.count({ where: { ...live, deadlineAt: { lt: now } } }),
      prisma.productionOrder.count({
        where: { ...live, deadlineAt: { gte: now, lt: warnUntil } },
      }),
      prisma.productionOrder.count({
        where: { status: 'COMPLETED', actualCompletionAt: { gte: today, lt: tomorrow } },
      }),
      prisma.productionOrder.count({ where: { status: 'NOT_STARTED' } }),
    ]);

  res.json({
    inProduction,
    notStarted,
    dueToday,
    dueTomorrow,
    overdue,
    dueSoon,
    completedToday,
    warningDays: settings.productionWarningDays,
  });
});
