import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler } from '../../utils/http.js';
import { serialize } from '../../utils/serialize.js';
import { getSettings } from '../../services/settings.js';
import { contains, paged, paginationSchema, skipTake } from './shared.js';
import { cartTotals } from '../../services/cart.js';

/**
 * Live cart activity.
 *
 * A cart is only visible here because the customer's *persisted* cart holds
 * rows — this is the same server cart the storefront writes to on add/update.
 * There is no realtime transport in this stack, so the admin UI revalidates on
 * an interval; nothing here pretends to be a push feed.
 *
 * Status is derived, not stored:
 *   ACTIVE     — has items, touched within the abandonment window
 *   ABANDONED  — has items, untouched for longer than the window
 *   CONVERTED  — empty now, but the customer has placed an order
 */
export type CartActivityStatus = 'ACTIVE' | 'ABANDONED' | 'CONVERTED';

export const listQuerySchema = paginationSchema.extend({
  status: z.enum(['all', 'active', 'abandoned', 'converted']).default('all'),
});

export const listCarts = asyncHandler(async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listQuerySchema>;
  const settings = await getSettings();

  const cutoff = new Date(Date.now() - settings.cartAbandonedAfterMinutes * 60_000);

  // CONVERTED carts are empty, every other status requires items — so the
  // "has items" predicate is part of the SQL filter, not a JS pass.
  const wantsEmpty = query.status === 'converted';

  const where: Prisma.CartWhereInput = {
    ...(wantsEmpty
      ? { items: { none: {} }, user: { orders: { some: {} } } }
      : { items: { some: {} } }),
    ...(query.status === 'active' ? { updatedAt: { gte: cutoff } } : {}),
    ...(query.status === 'abandoned' ? { updatedAt: { lt: cutoff } } : {}),
    ...(query.q
      ? {
          user: {
            OR: [
              { email: contains(query.q) },
              { firstName: contains(query.q) },
              { lastName: contains(query.q) },
            ],
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.cart.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      ...skipTake(query),
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            _count: { select: { orders: true } },
          },
        },
        items: {
          orderBy: { id: 'asc' },
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
    }),
    prisma.cart.count({ where }),
  ]);

  const items = rows.map((cart) => {
    const value = cart.items.reduce(
      (sum, i) => sum.add(i.product.price.mul(i.quantity)),
      new Prisma.Decimal(0),
    );

    const status: CartActivityStatus =
      cart.items.length === 0
        ? 'CONVERTED'
        : cart.updatedAt < cutoff
          ? 'ABANDONED'
          : 'ACTIVE';

    return {
      id: cart.id,
      status,
      customer: {
        id: cart.user.id,
        email: cart.user.email,
        firstName: cart.user.firstName,
        lastName: cart.user.lastName,
        phone: cart.user.phone,
        orderCount: cart.user._count.orders,
      },
      items: cart.items,
      itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
      value,
      createdAt: cart.createdAt,
      updatedAt: cart.updatedAt,
    };
  });

  res.json(
    serialize({
      ...paged(items, total, query),
      abandonedAfterMinutes: settings.cartAbandonedAfterMinutes,
    }),
  );
});

/** Headline counters for the dashboard's cart panel. */
export const cartSummary = asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  const cutoff = new Date(Date.now() - settings.cartAbandonedAfterMinutes * 60_000);

  const [active, abandoned, totals] = await Promise.all([
    prisma.cart.count({ where: { items: { some: {} }, updatedAt: { gte: cutoff } } }),
    prisma.cart.count({ where: { items: { some: {} }, updatedAt: { lt: cutoff } } }),
    cartTotals(),
  ]);

  res.json(
    serialize({
      activeCarts: active,
      abandonedCarts: abandoned,
      cartsWithItems: active + abandoned,
      totalItems: totals.totalItems,
      estimatedValue: totals.estimatedValue,
    }),
  );
});
