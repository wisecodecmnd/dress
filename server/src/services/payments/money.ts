import { Prisma } from '@prisma/client';

/**
 * Gateways quote money in the currency's smallest unit. The database stores
 * Decimal(10,2), so the conversion has to be exact — never
 * `Math.round(Number(x) * 100)` on a float, which drifts on values like 23.605.
 *
 * Currencies with no minor unit are listed explicitly (ISO 4217 exponent 0);
 * they are the currencies where multiplying by 100 would overcharge by 100×.
 */
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
  'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/** ISO 4217 exponent for a currency: 0 or 2. */
export const minorUnitExponent = (currency: string): number =>
  ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;

/**
 * Decimal → integer minor units. Throws rather than rounding, because a value
 * that cannot be represented exactly means the order total and the amount we
 * would charge disagree.
 */
export function toMinor(amount: Prisma.Decimal | string | number, currency: string): number {
  const exponent = minorUnitExponent(currency);
  const decimal = amount instanceof Prisma.Decimal ? amount : new Prisma.Decimal(amount);
  const scaled = decimal.mul(new Prisma.Decimal(10).pow(exponent));

  if (!scaled.isInteger()) {
    throw new Error(
      `Amount ${decimal.toString()} cannot be expressed in ${currency} minor units`,
    );
  }
  if (!scaled.isFinite() || scaled.isNegative()) {
    throw new Error(`Amount ${decimal.toString()} is not a chargeable value`);
  }

  return scaled.toNumber();
}

/** Integer minor units → Decimal, for writing refunded totals back. */
export function fromMinor(minor: number, currency: string): Prisma.Decimal {
  return new Prisma.Decimal(minor).div(new Prisma.Decimal(10).pow(minorUnitExponent(currency)));
}
