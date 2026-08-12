import { Prisma } from '@prisma/client';

/**
 * Order arithmetic lives here and only here. The client shows the same numbers
 * (src/utils/format.ts) but the server's result is the one that's charged.
 */
export const FREE_SHIPPING_THRESHOLD = new Prisma.Decimal(10_000);
export const SHIPPING_FLAT = new Prisma.Decimal(500);
export const TAX_RATE = new Prisma.Decimal(0.18);

export interface LinePrice {
  productId: string;
  name: string;
  image: string | null;
  size: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
}

export function computeTotals(lines: LinePrice[]) {
  const subtotal = lines.reduce(
    (sum, line) => sum.add(line.unitPrice.mul(line.quantity)),
    new Prisma.Decimal(0),
  );

  const shipping =
    subtotal.isZero() || subtotal.gte(FREE_SHIPPING_THRESHOLD)
      ? new Prisma.Decimal(0)
      : SHIPPING_FLAT;

  // Rounded to whole rupees, matching the storefront display.
  const tax = subtotal.mul(TAX_RATE).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const total = subtotal.add(shipping).add(tax);

  return { subtotal, shipping, tax, total };
}

/** Human-readable, sortable, and unguessable enough for a URL. */
export function orderNumber(): string {
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const rand = Math.floor(Math.random() * 46_656)
    .toString(36)
    .toUpperCase()
    .padStart(3, '0');
  return `DQ${stamp}${rand}`;
}
