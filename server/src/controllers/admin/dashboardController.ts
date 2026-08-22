import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { asyncHandler } from '../../utils/http.js';
import { serialize } from '../../utils/serialize.js';
import { getSettings } from '../../services/settings.js';
import { currentStageOf, deadlineView, progressOf } from '../../services/production.js';
import { runLimited } from '../../utils/concurrency.js';
import { addDays, businessDayWindows, startOfBusinessDay } from '../../utils/time.js';
import { cartTotals } from '../../services/cart.js';

/**
 * Revenue is only counted from orders whose payment actually captured. If no
 * payment provider is configured, `manual` orders stay PENDING and these
 * figures are legitimately zero — the dashboard reports what the database
 * knows and invents nothing.
 */
const CAPTURED: Prisma.OrderWhereInput = {
  payment: { status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } },
  status: { notIn: ['CANCELLED'] },
};

export const getDashboard = asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  const now = new Date();
  // Day boundaries come from the business timezone, so "today" on the dashboard
  // means the same thing whatever timezone the server runs in.
  const { today, tomorrow, dayAfter } = businessDayWindows(now);
  const weekAgo = startOfBusinessDay(addDays(today, -7));
  const monthAgo = startOfBusinessDay(addDays(today, -30));
  const warnUntil = startOfBusinessDay(addDays(today, settings.productionWarningDays + 1));
  const cartCutoff = new Date(now.getTime() - settings.cartAbandonedAfterMinutes * 60_000);

  const liveProduction: Prisma.ProductionOrderWhereInput = {
    status: { notIn: ['COMPLETED', 'CANCELLED'] },
  };

  const {
    customersTotal,
    customersToday,
    customersWeek,
    customersMonth,
    productsTotal,
    productsActive,
    productsFeatured,
    productsOutOfStock,
    categoriesTotal,
    categoriesActive,
    activeCarts,
    abandonedCarts,
    cartValue,
    ordersByStatus,
    ordersToday,
    revenueToday,
    revenueWeek,
    revenueMonth,
    revenueTotal,
    inProduction,
    notStarted,
    dueToday,
    dueTomorrow,
    overdueCount,
    dueSoonCount,
    completedToday,
  } = await runLimited({
    customersTotal: () => prisma.user.count({ where: { role: 'CUSTOMER' } }),
    customersToday: () =>
      prisma.user.count({ where: { role: 'CUSTOMER', createdAt: { gte: today } } }),
    customersWeek: () =>
      prisma.user.count({ where: { role: 'CUSTOMER', createdAt: { gte: weekAgo } } }),
    customersMonth: () =>
      prisma.user.count({ where: { role: 'CUSTOMER', createdAt: { gte: monthAgo } } }),

    productsTotal: () => prisma.product.count({ where: { archivedAt: null } }),
    productsActive: () => prisma.product.count({ where: { archivedAt: null, isActive: true } }),
    productsFeatured: () => prisma.product.count({ where: { archivedAt: null, isFeatured: true } }),
    productsOutOfStock: () =>
      prisma.product.count({
        where: {
          archivedAt: null,
          inventory: { some: {} },
          NOT: { inventory: { some: { quantity: { gt: 0 } } } },
        },
      }),

    categoriesTotal: () => prisma.category.count({ where: { archivedAt: null } }),
    categoriesActive: () =>
      prisma.category.count({ where: { archivedAt: null, isActive: true } }),

    activeCarts: () =>
      prisma.cart.count({ where: { items: { some: {} }, updatedAt: { gte: cartCutoff } } }),
    abandonedCarts: () =>
      prisma.cart.count({ where: { items: { some: {} }, updatedAt: { lt: cartCutoff } } }),
    cartValue: () => cartTotals(),

    ordersByStatus: () => prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
    ordersToday: () => prisma.order.count({ where: { createdAt: { gte: today } } }),

    revenueToday: () =>
      prisma.order.aggregate({
        where: { ...CAPTURED, createdAt: { gte: today } },
        _sum: { total: true },
      }),
    revenueWeek: () =>
      prisma.order.aggregate({
        where: { ...CAPTURED, createdAt: { gte: weekAgo } },
        _sum: { total: true },
      }),
    revenueMonth: () =>
      prisma.order.aggregate({
        where: { ...CAPTURED, createdAt: { gte: monthAgo } },
        _sum: { total: true },
      }),
    revenueTotal: () => prisma.order.aggregate({ where: CAPTURED, _sum: { total: true } }),

    inProduction: () => prisma.productionOrder.count({ where: { status: 'IN_PROGRESS' } }),
    notStarted: () => prisma.productionOrder.count({ where: { status: 'NOT_STARTED' } }),
    dueToday: () =>
      prisma.productionOrder.count({
        where: { ...liveProduction, deadlineAt: { gte: today, lt: tomorrow } },
      }),
    dueTomorrow: () =>
      prisma.productionOrder.count({
        where: { ...liveProduction, deadlineAt: { gte: tomorrow, lt: dayAfter } },
      }),
    overdueCount: () =>
      prisma.productionOrder.count({ where: { ...liveProduction, deadlineAt: { lt: now } } }),
    dueSoonCount: () =>
      prisma.productionOrder.count({
        where: { ...liveProduction, deadlineAt: { gte: now, lt: warnUntil } },
      }),
    completedToday: () =>
      prisma.productionOrder.count({
        where: { status: 'COMPLETED', actualCompletionAt: { gte: today, lt: tomorrow } },
      }),
  });

  const byStatus: Record<string, number> = {};
  for (const row of ordersByStatus) byStatus[row.status] = row._count._all;
  const ordersTotal = ordersByStatus.reduce((sum, r) => sum + r._count._all, 0);

  // ── Priority alert lists (the part the admin actually acts on) ────────────
  const planSelect = {
    id: true,
    status: true,
    deadlineAt: true,
    actualCompletionAt: true,
    quantity: true,
    order: {
      select: {
        id: true,
        number: true,
        email: true,
        user: { select: { firstName: true, lastName: true } },
      },
    },
    product: { select: { id: true, name: true } },
    stages: { select: { status: true, name: true, sortOrder: true }, orderBy: { sortOrder: 'asc' as const } },
  };

  const { overduePlans, dueSoonPlans, activePlans, newOrders, newCustomers } = await runLimited({
    overduePlans: () =>
      prisma.productionOrder.findMany({
        where: { ...liveProduction, deadlineAt: { lt: now } },
        orderBy: { deadlineAt: 'asc' },
        take: 8,
        select: planSelect,
      }),
    dueSoonPlans: () =>
      prisma.productionOrder.findMany({
        where: { ...liveProduction, deadlineAt: { gte: now, lt: warnUntil } },
        orderBy: { deadlineAt: 'asc' },
        take: 8,
        select: planSelect,
      }),
    activePlans: () =>
      prisma.productionOrder.findMany({
        where: { status: 'IN_PROGRESS' },
        orderBy: { deadlineAt: 'asc' },
        take: 8,
        select: planSelect,
      }),
    newOrders: () =>
      prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          currency: true,
          email: true,
          createdAt: true,
          user: { select: { firstName: true, lastName: true } },
          _count: { select: { items: true } },
          payment: { select: { status: true } },
        },
      }),
    newCustomers: () =>
      prisma.user.findMany({
        where: { role: 'CUSTOMER' },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          createdAt: true,
          _count: { select: { orders: true } },
        },
      }),
  });

  const shapePlan = (p: (typeof overduePlans)[number]) => {
    const current = currentStageOf(p.stages);

    return {
      id: p.id,
      orderId: p.order.id,
      orderNumber: p.order.number,
      customer:
        [p.order.user?.firstName, p.order.user?.lastName].filter(Boolean).join(' ') ||
        p.order.email,
      product: p.product.name,
      quantity: p.quantity,
      currentStage: current?.name ?? null,
      progress: progressOf(p.stages),
      deadlineAt: p.deadlineAt,
      ...deadlineView(p, settings, now),
    };
  };

  res.json(
    serialize({
      customers: {
        total: customersTotal,
        today: customersToday,
        thisWeek: customersWeek,
        thisMonth: customersMonth,
      },
      products: {
        total: productsTotal,
        active: productsActive,
        inactive: productsTotal - productsActive,
        featured: productsFeatured,
        outOfStock: productsOutOfStock,
      },
      categories: { total: categoriesTotal, active: categoriesActive },
      carts: {
        active: activeCarts,
        abandoned: abandonedCarts,
        withItems: activeCarts + abandonedCarts,
        totalItems: cartValue.totalItems,
        estimatedValue: cartValue.estimatedValue,
      },
      orders: { total: ordersTotal, today: ordersToday, byStatus },
      production: {
        inProduction,
        notStarted,
        dueToday,
        dueTomorrow,
        overdue: overdueCount,
        dueSoon: dueSoonCount,
        completedToday,
        warningDays: settings.productionWarningDays,
      },
      revenue: {
        // Zero here means no captured payments exist, not missing data.
        today: revenueToday._sum.total ?? new Prisma.Decimal(0),
        thisWeek: revenueWeek._sum.total ?? new Prisma.Decimal(0),
        thisMonth: revenueMonth._sum.total ?? new Prisma.Decimal(0),
        total: revenueTotal._sum.total ?? new Prisma.Decimal(0),
        currency: settings.currency,
        basis: 'captured payments only',
      },
      alerts: {
        overdue: overduePlans.map(shapePlan),
        dueSoon: dueSoonPlans.map(shapePlan),
        activeProduction: activePlans.map(shapePlan),
        newOrders: newOrders.map(({ _count, ...o }) => ({ ...o, itemCount: _count.items })),
        newCustomers: newCustomers.map(({ _count, ...c }) => ({ ...c, orderCount: _count.orders })),
      },
    }),
  );
});
