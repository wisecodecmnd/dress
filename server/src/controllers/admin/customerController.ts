import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { serialize } from '../../utils/serialize.js';
import { logActivity } from '../../services/activity.js';
import { actor, contains, orderBy, paged, paginationSchema, skipTake } from './shared.js';

const SORTABLE = ['createdAt', 'email', 'lastLoginAt'] as const;

export const listQuerySchema = paginationSchema.extend({
  status: z.enum(['all', 'active', 'suspended']).default('all'),
  /** Only customers who currently have something in their cart. */
  hasCart: z.enum(['all', 'yes']).default('all'),
  hasOrders: z.enum(['all', 'yes', 'no']).default('all'),
});

/**
 * Money spent is summed over non-cancelled orders only. Kept as a grouped
 * aggregate rather than a per-row query so the list stays one round trip.
 */
const EXCLUDED_FROM_SPEND: Prisma.EnumOrderStatusFilter = {
  notIn: ['CANCELLED', 'REFUNDED'],
};

export const listCustomers = asyncHandler(async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listQuerySchema>;

  const where: Prisma.UserWhereInput = {
    role: 'CUSTOMER',
    ...(query.status === 'active' ? { isActive: true } : {}),
    ...(query.status === 'suspended' ? { isActive: false } : {}),
    ...(query.hasCart === 'yes' ? { cart: { items: { some: {} } } } : {}),
    ...(query.hasOrders === 'yes' ? { orders: { some: {} } } : {}),
    ...(query.hasOrders === 'no' ? { orders: { none: {} } } : {}),
    ...(query.q
      ? {
          OR: [
            { email: contains(query.q) },
            { firstName: contains(query.q) },
            { lastName: contains(query.q) },
            { phone: contains(query.q) },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: orderBy(query, SORTABLE, { createdAt: 'desc' }),
      ...skipTake(query),
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
        _count: { select: { orders: true } },
        cart: {
          select: {
            updatedAt: true,
            items: {
              select: { quantity: true, product: { select: { price: true } } },
            },
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  // Spend for exactly the customers on this page.
  const ids = rows.map((r) => r.id);
  const spend = ids.length
    ? await prisma.order.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, status: EXCLUDED_FROM_SPEND },
        _sum: { total: true },
      })
    : [];
  const spendBy = new Map(spend.map((s) => [s.userId, s._sum.total]));

  const items = rows.map(({ _count, cart, ...u }) => {
    const cartItems = cart?.items ?? [];
    return {
      ...u,
      orderCount: _count.orders,
      totalSpent: spendBy.get(u.id) ?? new Prisma.Decimal(0),
      cartItemCount: cartItems.reduce((sum, i) => sum + i.quantity, 0),
      cartValue: cartItems.reduce(
        (sum, i) => sum.add(i.product.price.mul(i.quantity)),
        new Prisma.Decimal(0),
      ),
      cartUpdatedAt: cart?.updatedAt ?? null,
    };
  });

  res.json(serialize(paged(items, total, query)));
});

export const getCustomer = asyncHandler(async (req, res) => {
  const customer = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      lastLoginAt: true,
      addresses: true,
      cart: {
        select: {
          id: true,
          updatedAt: true,
          items: {
            select: {
              id: true,
              size: true,
              quantity: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  price: true,
                  images: { orderBy: { position: 'asc' }, take: 1 },
                },
              },
            },
          },
        },
      },
      orders: {
        orderBy: { createdAt: 'desc' },
        // The detail page shows a recent-orders panel, not a full ledger. The
        // authoritative counts and spend come from the aggregates below.
        take: 50,
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          currency: true,
          createdAt: true,
          requiredBy: true,
          _count: { select: { items: true } },
          payment: { select: { status: true } },
        },
      },
      wishlist: {
        select: {
          items: {
            take: 50,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              createdAt: true,
              product: { select: { id: true, name: true, slug: true, price: true } },
            },
          },
        },
      },
    },
  });

  if (!customer) throw HttpError.notFound('Customer not found');

  const cartItems = customer.cart?.items ?? [];
  const cartValue = cartItems.reduce(
    (sum, i) => sum.add(i.product.price.mul(i.quantity)),
    new Prisma.Decimal(0),
  );

  // Aggregated over *every* order, not just the page of recent ones above.
  const [spend, orderCount, activity] = await Promise.all([
    prisma.order.aggregate({
      where: { userId: customer.id, status: EXCLUDED_FROM_SPEND },
      _sum: { total: true },
    }),
    prisma.order.count({ where: { userId: customer.id } }),
    // Activity timeline: audit rows that name this customer, newest first.
    prisma.activityLog.findMany({
      where: { OR: [{ actorId: customer.id }, { entity: 'Customer', entityId: customer.id }] },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ]);

  const totalSpent = spend._sum.total ?? new Prisma.Decimal(0);

  res.json(
    serialize({
      customer: {
        ...customer,
        orders: customer.orders.map(({ _count, ...o }) => ({ ...o, itemCount: _count.items })),
      },
      stats: {
        orderCount,
        totalSpent,
        cartItemCount: cartItems.reduce((sum, i) => sum + i.quantity, 0),
        cartValue,
      },
      activity,
    }),
  );
});

export const updateSchema = z.object({
  isActive: z.coerce.boolean().optional(),
  phone: z.string().trim().max(20).nullish(),
});

/**
 * Admin may suspend an account or correct a phone number. Deliberately cannot
 * touch email, password or role — credential changes are not an admin action.
 */
export const updateCustomer = asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof updateSchema>;

  const existing = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, email: true, role: true },
  });
  if (!existing) throw HttpError.notFound('Customer not found');
  if (existing.role === 'ADMIN') throw HttpError.forbidden('Admin accounts cannot be edited here');

  const customer = await prisma.user.update({
    where: { id: existing.id },
    data: {
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
    },
    select: { id: true, email: true, isActive: true, phone: true },
  });

  await logActivity({
    ...actor(req),
    action: input.isActive === false ? 'customer.suspend' : 'customer.update',
    entity: 'Customer',
    entityId: customer.id,
    summary:
      input.isActive === false
        ? `Suspended customer ${customer.email}`
        : input.isActive === true
          ? `Reactivated customer ${customer.email}`
          : `Updated customer ${customer.email}`,
  });

  res.json(serialize({ customer }));
});
