import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler, HttpError } from '../../utils/http.js';

/**
 * CSV export for the admin lists. Capped at EXPORT_LIMIT rows so an export can
 * never pull an unbounded table into memory.
 */
const EXPORT_LIMIT = 5000;

export const querySchema = z.object({
  type: z.enum(['orders', 'customers', 'products', 'production']),
});

/**
 * A leading =, +, -, @ or control character makes Excel/Sheets treat the cell as
 * a formula, which turns a customer-supplied product name or address into code
 * that runs when an admin opens the export. Prefixing an apostrophe forces the
 * cell to be read as text; the visible value is unchanged.
 */
const RISKY_PREFIX = /^[=+\-@\t\r]/;

/** RFC 4180 escaping — quote everything, double any embedded quote. */
const cell = (value: unknown): string => {
  if (value === null || value === undefined) return '""';
  const text = value instanceof Date ? value.toISOString() : String(value);
  const safe = RISKY_PREFIX.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

const toCsv = (headers: string[], rows: unknown[][]): string =>
  [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n');

const name = (first: string | null, last: string | null, fallback: string) =>
  [first, last].filter(Boolean).join(' ') || fallback;

export const exportCsv = asyncHandler(async (req, res) => {
  const { type } = req.query as unknown as z.infer<typeof querySchema>;

  let headers: string[] = [];
  let rows: unknown[][] = [];

  if (type === 'orders') {
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMIT,
      include: {
        user: { select: { firstName: true, lastName: true } },
        // Enough to reconcile against a gateway statement: which provider,
        // which payment on their side, what settled and when. No instrument
        // detail — none is stored.
        payment: {
          select: {
            status: true,
            provider: true,
            mode: true,
            reference: true,
            providerPaymentId: true,
            currency: true,
            refundedAmount: true,
            paidAt: true,
            refundedAt: true,
          },
        },
        _count: { select: { items: true } },
      },
    });

    headers = [
      'Order', 'Customer', 'Email', 'Phone', 'Items', 'Subtotal', 'Shipping', 'Tax',
      'Total', 'Currency', 'Order status', 'Payment status', 'Payment provider',
      'Payment mode', 'Merchant reference', 'Provider payment ID', 'Refunded',
      'Paid at', 'Refunded at', 'Priority', 'Placed', 'Required by', 'Delivery due',
    ];
    rows = orders.map((o) => [
      o.number,
      name(o.user?.firstName ?? null, o.user?.lastName ?? null, 'Guest'),
      o.email, o.phone, o._count.items,
      o.subtotal.toFixed(2), o.shipping.toFixed(2), o.tax.toFixed(2), o.total.toFixed(2),
      o.currency, o.status, o.payment?.status ?? '', o.payment?.provider ?? '',
      o.payment?.mode ?? '', o.payment?.reference ?? '', o.payment?.providerPaymentId ?? '',
      o.payment?.refundedAmount.toFixed(2) ?? '',
      o.payment?.paidAt ?? null, o.payment?.refundedAt ?? null,
      o.priority, o.createdAt, o.requiredBy, o.deliveryDueAt,
    ]);
  } else if (type === 'customers') {
    const customers = await prisma.user.findMany({
      where: { role: 'CUSTOMER' },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMIT,
      include: {
        _count: { select: { orders: true } },
        cart: { select: { items: { select: { quantity: true } } } },
      },
    });

    // Spend as one grouped aggregate rather than every order row of every
    // exported customer.
    const spend = customers.length
      ? await prisma.order.groupBy({
          by: ['userId'],
          where: {
            userId: { in: customers.map((c) => c.id) },
            status: { notIn: ['CANCELLED', 'REFUNDED'] },
          },
          _sum: { total: true },
        })
      : [];
    const spendBy = new Map(spend.map((s) => [s.userId, s._sum.total]));

    headers = ['Email', 'Name', 'Phone', 'Registered', 'Last login', 'Orders', 'Total spent', 'Cart items', 'Status'];
    rows = customers.map((c) => [
      c.email,
      name(c.firstName, c.lastName, ''),
      c.phone, c.createdAt, c.lastLoginAt, c._count.orders,
      // Decimal arithmetic, not float — summing Number(total) loses paise.
      (spendBy.get(c.id) ?? new Prisma.Decimal(0)).toFixed(2),
      (c.cart?.items ?? []).reduce((sum, i) => sum + i.quantity, 0),
      c.isActive ? 'Active' : 'Suspended',
    ]);
  } else if (type === 'products') {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMIT,
      include: {
        category: { select: { name: true } },
        inventory: { select: { quantity: true } },
        _count: { select: { orderItems: true, processes: true } },
      },
    });

    headers = ['Name', 'Slug', 'SKU', 'Category', 'Price', 'Compare price', 'Currency', 'Stock', 'Status', 'Featured', 'Limited', 'Process stages', 'Times ordered', 'Created'];
    rows = products.map((p) => [
      p.name, p.slug, p.sku, p.category?.name ?? '',
      p.price.toFixed(2), p.comparePrice?.toFixed(2) ?? '', p.currency,
      p.inventory.length === 0 ? 'Unlimited' : p.inventory.reduce((s, i) => s + i.quantity, 0),
      p.archivedAt ? 'Archived' : p.isActive ? 'Active' : 'Disabled',
      p.isFeatured ? 'Yes' : 'No', p.isLimited ? 'Yes' : 'No',
      p._count.processes, p._count.orderItems, p.createdAt,
    ]);
  } else {
    const plans = await prisma.productionOrder.findMany({
      orderBy: { deadlineAt: 'asc' },
      take: EXPORT_LIMIT,
      include: {
        order: { select: { number: true, email: true, user: { select: { firstName: true, lastName: true } } } },
        product: { select: { name: true } },
        stages: { orderBy: { sortOrder: 'asc' }, select: { name: true, status: true } },
      },
    });

    const now = Date.now();
    headers = ['Order', 'Customer', 'Product', 'Qty', 'Status', 'Current stage', 'Progress %', 'Estimated hours', 'Started', 'Completed', 'Deadline', 'Overdue'];
    rows = plans.map((p) => {
      const done = p.stages.filter((s) => s.status === 'COMPLETED' || s.status === 'SKIPPED').length;
      const current = p.stages.find((s) => s.status === 'IN_PROGRESS') ?? p.stages.find((s) => s.status === 'PENDING');
      const live = p.status !== 'COMPLETED' && p.status !== 'CANCELLED';

      return [
        p.order.number,
        name(p.order.user?.firstName ?? null, p.order.user?.lastName ?? null, p.order.email),
        p.product.name, p.quantity, p.status, current?.name ?? '',
        p.stages.length ? Math.round((done / p.stages.length) * 100) : 0,
        (p.estimatedMinutes / 60).toFixed(2),
        p.actualStartAt, p.actualCompletionAt, p.deadlineAt,
        live && p.deadlineAt && p.deadlineAt.getTime() < now ? 'YES' : 'No',
      ];
    });
  }

  if (headers.length === 0) throw HttpError.badRequest('Nothing to export');

  const filename = `denimque-${type}-${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // Excel needs a BOM to read UTF-8 correctly.
  res.send('﻿' + toCsv(headers, rows));
});
