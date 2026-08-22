import { Prisma } from '@prisma/client';
import type { Prisma as PrismaNS } from '@prisma/client';
import { getSettings, type Settings } from './settings.js';

/**
 * Production planning: how long an ordered line takes to make, and therefore
 * when it is due.
 *
 * Estimates are snapshotted onto ProductionOrder/ProductionStage rows at order
 * time. Editing a product's process configuration afterwards changes what
 * *future* orders are quoted, never what a live plan is held to.
 */

/** A product's configured stages, resolved against their stage defaults. */
export interface ResolvedStage {
  stageId: string;
  name: string;
  sortOrder: number;
  /** Minutes for a single unit. */
  minutes: number;
  cost: Prisma.Decimal;
  isMandatory: boolean;
}

type ProductProcessWithStage = {
  stageId: string;
  sortOrder: number;
  duration: number | null;
  cost: Prisma.Decimal | null;
  isMandatory: boolean;
  stage: { id: string; name: string; defaultDuration: number; defaultCost: Prisma.Decimal; isActive: boolean };
};

/**
 * Resolves per-product overrides over stage defaults. A null override means
 * "follow the stage", so editing a stage's default updates every product that
 * hasn't opted out.
 */
export function resolveStages(processes: ProductProcessWithStage[]): ResolvedStage[] {
  return processes
    .filter((p) => p.stage.isActive)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => ({
      stageId: p.stageId,
      name: p.stage.name,
      sortOrder: p.sortOrder,
      minutes: p.duration ?? p.stage.defaultDuration,
      cost: p.cost ?? p.stage.defaultCost,
      isMandatory: p.isMandatory,
    }));
}

export interface PlanEstimate {
  /** Total minutes for the whole line (per-unit work × quantity). */
  totalMinutes: number;
  totalCost: Prisma.Decimal;
  /** Per-unit totals, which is what the admin product editor displays. */
  unitMinutes: number;
  unitCost: Prisma.Decimal;
}

export function estimatePlan(stages: ResolvedStage[], quantity: number): PlanEstimate {
  const unitMinutes = stages.reduce((sum, s) => sum + s.minutes, 0);
  const unitCost = stages.reduce((sum, s) => sum.add(s.cost), new Prisma.Decimal(0));

  return {
    unitMinutes,
    unitCost,
    totalMinutes: unitMinutes * quantity,
    totalCost: unitCost.mul(quantity),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO weekday, 1 = Monday … 7 = Sunday. */
const isoWeekday = (date: Date): number => date.getUTCDay() || 7;

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/**
 * Walks `minutes` of work forward from `from`, consuming only working days at
 * `minutesPerDay` each, and returns the date the work finishes.
 *
 * Deliberately day-granular: the workshop is scheduled in days, and a
 * minute-accurate model would imply a precision the business doesn't have.
 */
export function addWorkingTime(from: Date, minutes: number, settings: Settings): Date {
  const workingDays = settings.workingDays.length ? settings.workingDays : [1, 2, 3, 4, 5, 6];
  const perDay = Math.max(1, settings.productionMinutesPerDay);

  // Work always starts on the first working day at or after `from`.
  let cursor = startOfUtcDay(from);
  let guard = 0;
  while (!workingDays.includes(isoWeekday(cursor))) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    if (++guard > 400) return cursor;
  }

  // A plan with no work still lands on a real date.
  let remaining = Math.max(0, minutes);
  if (remaining === 0) return cursor;

  guard = 0;
  while (remaining > perDay) {
    remaining -= perDay;
    do {
      cursor = new Date(cursor.getTime() + DAY_MS);
      if (++guard > 4000) return cursor;
    } while (!workingDays.includes(isoWeekday(cursor)));
  }

  return cursor;
}

/** Adds plain calendar days — delivery buffer is not workshop time. */
export function addCalendarDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

export interface PlanSchedule {
  estimatedStartAt: Date;
  estimatedCompletionAt: Date;
  deadlineAt: Date;
  deliveryDueAt: Date;
}

export function schedulePlan(placedAt: Date, totalMinutes: number, settings: Settings): PlanSchedule {
  const estimatedStartAt = addWorkingTime(placedAt, 0, settings);
  const estimatedCompletionAt = addWorkingTime(placedAt, totalMinutes, settings);

  return {
    estimatedStartAt,
    estimatedCompletionAt,
    // The deadline starts equal to the estimate; admin can move it later.
    deadlineAt: estimatedCompletionAt,
    deliveryDueAt: addCalendarDays(estimatedCompletionAt, settings.deliveryBufferDays),
  };
}

/**
 * Creates the ProductionOrder + ProductionStage rows for every line of an
 * order, inside the caller's transaction so an order never exists without its
 * production plan.
 *
 * Returns the latest completion date across all lines, which the caller rolls
 * up onto the order.
 */
export async function createProductionPlans(
  tx: PrismaNS.TransactionClient,
  orderId: string,
  placedAt: Date,
): Promise<{ requiredBy: Date | null; deliveryDueAt: Date | null }> {
  const settings = await getSettings();

  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { id: true, productId: true, quantity: true },
  });

  let latestCompletion: Date | null = null;
  let latestDelivery: Date | null = null;

  for (const item of items) {
    const processes = (await tx.productProcess.findMany({
      where: { productId: item.productId },
      include: {
        stage: {
          select: { id: true, name: true, defaultDuration: true, defaultCost: true, isActive: true },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })) as unknown as ProductProcessWithStage[];

    const stages = resolveStages(processes);
    const estimate = estimatePlan(stages, item.quantity);

    // A product with no configured processes still gets a plan, using the
    // fallback duration, so nothing falls off the production board.
    const totalMinutes =
      stages.length > 0
        ? estimate.totalMinutes
        : settings.defaultProcessDuration * item.quantity;

    const schedule = schedulePlan(placedAt, totalMinutes, settings);

    await tx.productionOrder.create({
      data: {
        orderId,
        orderItemId: item.id,
        productId: item.productId,
        quantity: item.quantity,
        status: 'NOT_STARTED',
        estimatedMinutes: totalMinutes,
        estimatedCost: estimate.totalCost,
        estimatedStartAt: schedule.estimatedStartAt,
        estimatedCompletionAt: schedule.estimatedCompletionAt,
        deadlineAt: schedule.deadlineAt,
        stages: {
          create: stages.map((s, index) => ({
            stageId: s.stageId,
            // Snapshotted: renaming or archiving the stage later must not
            // rewrite the record of work already done.
            name: s.name,
            sortOrder: index,
            status: 'PENDING',
            estimatedMinutes: s.minutes * item.quantity,
            cost: s.cost.mul(item.quantity),
            isMandatory: s.isMandatory,
          })),
        },
      },
    });

    if (!latestCompletion || schedule.estimatedCompletionAt > latestCompletion) {
      latestCompletion = schedule.estimatedCompletionAt;
    }
    if (!latestDelivery || schedule.deliveryDueAt > latestDelivery) {
      latestDelivery = schedule.deliveryDueAt;
    }
  }

  return { requiredBy: latestCompletion, deliveryDueAt: latestDelivery };
}

/** Completed stages ÷ total stages, as a whole percentage. */
export function progressOf(stages: { status: string }[]): number {
  if (stages.length === 0) return 0;
  const done = stages.filter((s) => s.status === 'COMPLETED' || s.status === 'SKIPPED').length;
  return Math.round((done / stages.length) * 100);
}

/**
 * The stage the workshop is on: whatever is in progress, else the first thing
 * blocked, else the next thing waiting.
 *
 * Structurally typed on just the fields it reads, so callers can select as
 * few columns as they need.
 */
export function currentStageOf<T extends { status: string; sortOrder: number }>(
  stages: T[],
): T | null {
  const ordered = stages.slice().sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    ordered.find((s) => s.status === 'IN_PROGRESS') ??
    ordered.find((s) => s.status === 'BLOCKED') ??
    ordered.find((s) => s.status === 'PENDING') ??
    null
  );
}

/** Estimated minutes still outstanding across unfinished stages. */
export function remainingMinutesOf(
  stages: { status: string; estimatedMinutes: number }[],
): number {
  return stages
    .filter((s) => s.status !== 'COMPLETED' && s.status !== 'SKIPPED')
    .reduce((sum, s) => sum + s.estimatedMinutes, 0);
}

export interface DeadlineView {
  isOverdue: boolean;
  isDueSoon: boolean;
  /** Whole days until the deadline; negative once it has passed. */
  daysRemaining: number | null;
}

/**
 * Deadline state for one plan. A completed plan is never overdue — the work
 * landed, whenever it landed.
 */
export function deadlineView(
  plan: { deadlineAt: Date | null; status: string; actualCompletionAt: Date | null },
  settings: Settings,
  now = new Date(),
): DeadlineView {
  if (!plan.deadlineAt) return { isOverdue: false, isDueSoon: false, daysRemaining: null };

  const finished = plan.status === 'COMPLETED' || plan.status === 'CANCELLED';
  const daysRemaining = Math.ceil((plan.deadlineAt.getTime() - now.getTime()) / DAY_MS);

  return {
    isOverdue: !finished && plan.deadlineAt.getTime() < now.getTime(),
    isDueSoon:
      !finished &&
      plan.deadlineAt.getTime() >= now.getTime() &&
      daysRemaining <= settings.productionWarningDays,
    daysRemaining,
  };
}

/** Minutes between two instants, floored at zero. */
export const minutesBetween = (from: Date, to: Date): number =>
  Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
