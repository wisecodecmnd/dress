import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';

/**
 * Aggregate value of everything sitting in customers' carts.
 *
 * Cart value needs a unit price per line, so it can't be a single `_sum`. It is
 * still bounded work: quantities are summed per product in SQL, and only the
 * distinct products involved have their prices read. The naive version pulled
 * every cart line in the database into memory, which is fine with ten carts and
 * not with ten thousand.
 */
export async function cartTotals(): Promise<{ totalItems: number; estimatedValue: Prisma.Decimal }> {
  const grouped = await prisma.cartItem.groupBy({
    by: ['productId'],
    _sum: { quantity: true },
  });

  if (grouped.length === 0) {
    return { totalItems: 0, estimatedValue: new Prisma.Decimal(0) };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: grouped.map((g) => g.productId) } },
    select: { id: true, price: true },
  });
  const priceOf = new Map(products.map((p) => [p.id, p.price]));

  let totalItems = 0;
  let estimatedValue = new Prisma.Decimal(0);

  for (const row of grouped) {
    const quantity = row._sum.quantity ?? 0;
    totalItems += quantity;
    const price = priceOf.get(row.productId);
    if (price) estimatedValue = estimatedValue.add(price.mul(quantity));
  }

  return { totalItems, estimatedValue };
}
