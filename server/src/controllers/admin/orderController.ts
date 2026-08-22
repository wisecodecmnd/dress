import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { serialize } from '../../utils/serialize.js';
import { logActivity } from '../../services/activity.js';
import {
  currentStageOf,
  deadlineView,
  progressOf,
  remainingMinutesOf,
} from '../../services/production.js';
import { getSettings } from '../../services/settings.js';
import { refundPayment, setPaymentStatusAsAdmin } from '../../services/payments/service.js';
import { actor, contains, dateFilter, orderBy, paged, paginationSchema, skipTake } from './shared.js';

const SORTABLE = ['createdAt', 'total', 'number', 'requiredBy', 'status'] as const;

const ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PAID',
  'PROCESSING',
  'IN_PRODUCTION',
  'QUALITY_CHECK',
  'READY',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
] as const;

const PAYMENT_STATUSES = [
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;

export const listQuerySchema = paginationSchema.extend({
  status: z.enum(['all', ...ORDER_STATUSES]).default('all'),
  paymentStatus: z.enum(['all', ...PAYMENT_STATUSES]).default('all'),
  productionStatus: z
    .enum(['all', 'NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'])
    .default('all'),
  priority: z.enum(['all', 'LOW', 'NORMAL', 'HIGH', 'URGENT']).default('all'),
  overdue: z.enum(['all', 'yes']).default('all'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const listOrders = asyncHandler(async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listQuerySchema>;
  const settings = await getSettings();
  const now = new Date();

  const created = dateFilter({ from: query.from, to: query.to });

  const where: Prisma.OrderWhereInput = {
    ...(query.status !== 'all' ? { status: query.status } : {}),
    ...(query.priority !== 'all' ? { priority: query.priority } : {}),
    ...(created ? { createdAt: created } : {}),
    ...(query.paymentStatus !== 'all' ? { payment: { status: query.paymentStatus } } : {}),
    ...(query.productionStatus !== 'all'
      ? { productionOrders: { some: { status: query.productionStatus } } }
      : {}),
    // Overdue = a live production plan whose deadline has passed.
    ...(query.overdue === 'yes'
      ? {
          productionOrders: {
            some: {
              deadlineAt: { lt: now },
              status: { notIn: ['COMPLETED', 'CANCELLED'] },
            },
          },
        }
      : {}),
    ...(query.q
      ? {
          OR: [
            { number: contains(query.q) },
            { email: contains(query.q) },
            { phone: contains(query.q) },
            { user: { firstName: contains(query.q) } },
            { user: { lastName: contains(query.q) } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: orderBy(query, SORTABLE, { createdAt: 'desc' }),
      ...skipTake(query),
      select: {
        id: true,
        number: true,
        status: true,
        priority: true,
        email: true,
        phone: true,
        total: true,
        currency: true,
        createdAt: true,
        requiredBy: true,
        deliveryDueAt: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        payment: { select: { status: true, provider: true, reference: true } },
        _count: { select: { items: true } },
        productionOrders: {
          select: {
            id: true,
            status: true,
            deadlineAt: true,
            actualCompletionAt: true,
            stages: { select: { status: true } },
          },
        },
      },
    }),
    prisma.order.count({ where }),
  ]);

  const items = rows.map(({ _count, productionOrders, ...o }) => {
    const views = productionOrders.map((p) => deadlineView(p, settings, now));

    return {
      ...o,
      itemCount: _count.items,
      productionStatus: rollUpProduction(productionOrders.map((p) => p.status)),
      productionProgress:
        productionOrders.length === 0
          ? 0
          : Math.round(
              productionOrders.reduce((sum, p) => sum + progressOf(p.stages), 0) /
                productionOrders.length,
            ),
      isOverdue: views.some((v) => v.isOverdue),
      isDueSoon: views.some((v) => v.isDueSoon),
    };
  });

  res.json(serialize(paged(items, total, query)));
});

/** One production status for the whole order, from its per-line plans. */
function rollUpProduction(statuses: string[]): string {
  if (statuses.length === 0) return 'NONE';
  if (statuses.every((s) => s === 'COMPLETED')) return 'COMPLETED';
  if (statuses.every((s) => s === 'CANCELLED')) return 'CANCELLED';
  if (statuses.some((s) => s === 'ON_HOLD')) return 'ON_HOLD';
  if (statuses.some((s) => s === 'IN_PROGRESS')) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

export const getOrder = asyncHandler(async (req, res) => {
  const settings = await getSettings();

  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      items: {
        include: {
          production: { include: { stages: { orderBy: { sortOrder: 'asc' } } } },
          product: { select: { id: true, name: true, slug: true } },
        },
      },
      address: true,
      payment: true,
      coupon: { select: { code: true, percentOff: true, amountOff: true } },
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          createdAt: true,
          _count: { select: { orders: true } },
        },
      },
      events: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!order) throw HttpError.notFound('Order not found');

  const items = order.items.map((item) => {
    if (!item.production) return { ...item, production: null };

    const stages = item.production.stages;
    const current = currentStageOf(stages);

    return {
      ...item,
      production: {
        ...item.production,
        progress: progressOf(stages),
        // Same derived shape the production board returns, so the plan panel
        // renders identically wherever it appears.
        currentStage: current
          ? { id: current.id, name: current.name, status: current.status }
          : null,
        remainingMinutes: remainingMinutesOf(stages),
        ...deadlineView(item.production, settings),
      },
    };
  });

  res.json(
    serialize({
      order: { ...order, items },
      productionStatus: rollUpProduction(
        order.items.flatMap((i) => (i.production ? [i.production.status] : [])),
      ),
    }),
  );
});

export const updateSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  paymentReference: z.string().trim().max(120).nullish(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  requiredBy: z.coerce.date().nullish(),
  deliveryDueAt: z.coerce.date().nullish(),
  adminNotes: z.string().trim().max(2000).nullish(),
});

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Order pending',
  CONFIRMED: 'Order confirmed',
  PAID: 'Payment received',
  PROCESSING: 'Processing started',
  IN_PRODUCTION: 'Production started',
  QUALITY_CHECK: 'Quality check',
  READY: 'Ready for dispatch',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Order cancelled',
  REFUNDED: 'Order refunded',
};

export const updateOrder = asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof updateSchema>;

  const existing = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { payment: true },
  });
  if (!existing) throw HttpError.notFound('Order not found');

  const admin = actor(req);

  // Payment status is *not* a free-text field on the order. It goes through the
  // same state machine, amount checks and audit trail as a provider callback —
  // so an admin cannot invent FAILED → CAPTURED, and cannot hand-capture a
  // gateway payment that the gateway has not actually settled.
  if (input.paymentStatus !== undefined) {
    if (!existing.payment) {
      // Guest and legacy orders may predate their payment row.
      await prisma.payment.create({
        data: {
          orderId: existing.id,
          provider: 'manual',
          amount: existing.total,
          currency: existing.currency,
          status: 'PENDING',
        },
      });
    }

    await setPaymentStatusAsAdmin({
      orderId: existing.id,
      status: input.paymentStatus,
      actorEmail: admin.actorEmail,
    });
  }

  if (input.paymentReference !== undefined) {
    await prisma.payment.update({
      where: { orderId: existing.id },
      data: { reference: input.paymentReference ?? null },
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: existing.id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.requiredBy !== undefined ? { requiredBy: input.requiredBy } : {}),
        ...(input.deliveryDueAt !== undefined ? { deliveryDueAt: input.deliveryDueAt } : {}),
        ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}),
        ...(input.status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
      },
    });

    // Cancelling an order cancels the work still outstanding on it.
    if (input.status === 'CANCELLED') {
      await tx.productionOrder.updateMany({
        where: { orderId: existing.id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        data: { status: 'CANCELLED' },
      });
    }

    const events: { label: string; detail?: string }[] = [];

    if (input.status && input.status !== existing.status) {
      events.push({
        label: STATUS_LABEL[input.status] ?? input.status,
        detail: `Moved from ${existing.status} to ${input.status}`,
      });
    }
    // The payment transition itself is timelined by the payment service, so
    // only the reference is worth a row here.
    if (input.paymentReference) {
      events.push({ label: 'Payment reference recorded', detail: input.paymentReference });
    }
    if (input.requiredBy !== undefined) {
      events.push({
        label: 'Completion date updated',
        detail: input.requiredBy ? input.requiredBy.toISOString() : 'cleared',
      });
    }

    for (const event of events) {
      await tx.orderEvent.create({
        data: {
          orderId: existing.id,
          label: event.label,
          detail: event.detail ?? null,
          actorEmail: admin.actorEmail,
        },
      });
    }
  });

  await logActivity({
    ...admin,
    action:
      input.status === 'CANCELLED'
        ? 'order.cancel'
        : input.paymentStatus === 'CAPTURED'
          ? 'order.payment'
          : 'order.update',
    entity: 'Order',
    entityId: existing.id,
    summary:
      input.status && input.status !== existing.status
        ? `Moved order ${existing.number} to ${input.status}`
        : input.paymentStatus
          ? `Set order ${existing.number} payment to ${input.paymentStatus}`
          : `Updated order ${existing.number}`,
    meta: { changes: Object.keys(input) },
  });

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: existing.id },
    include: { payment: true, events: { orderBy: { createdAt: 'asc' } } },
  });

  res.json(serialize({ order }));
});

export const refundSchema = z.object({
  /** Omit for a full refund of whatever is still refundable. */
  amount: z.coerce.number().positive().optional(),
});

/**
 * Refunds through the gateway that took the money. The refundable amount is
 * recomputed from the payment row, so a repeated or oversized request is
 * rejected rather than over-refunding, and the result is applied through the
 * same guarded path a webhook uses.
 */
export const refundOrder = asyncHandler(async (req, res) => {
  const { amount } = req.body as z.infer<typeof refundSchema>;
  const admin = actor(req);

  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    select: { id: true, number: true, currency: true },
  });
  if (!order) throw HttpError.notFound('Order not found');

  const result = await refundPayment({
    orderId: order.id,
    amount: amount ?? null,
    actorEmail: admin.actorEmail,
  });

  await logActivity({
    ...admin,
    action: 'order.refund',
    entity: 'Order',
    entityId: order.id,
    summary: `Refunded ${amount ? `${order.currency} ${amount.toFixed(2)} of ` : ''}order ${order.number}`,
    meta: { outcome: result.reason, status: result.status },
  });

  const updated = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { payment: true, events: { orderBy: { createdAt: 'asc' } } },
  });

  res.json(serialize({ order: updated, outcome: result.reason }));
});

/** Counts per order status, for the dashboard and the list's filter chips. */
export const orderSummary = asyncHandler(async (_req, res) => {
  const grouped = await prisma.order.groupBy({
    by: ['status'],
    _count: { _all: true },
    _sum: { total: true },
  });

  const byStatus: Record<string, number> = {};
  for (const status of ORDER_STATUSES) byStatus[status] = 0;
  for (const row of grouped) byStatus[row.status] = row._count._all;

  res.json(
    serialize({
      byStatus,
      total: grouped.reduce((sum, r) => sum + r._count._all, 0),
    }),
  );
});
