const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** Money for display. Accepts the API's string decimals as well as numbers. */
export const formatPrice = (value: string | number, currency = 'INR') => {
  const amount = Number(value) || 0;
  if (currency === 'INR') return inr.format(amount);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );

/** Order totals live in one place so cart, checkout and the API agree. */
export const FREE_SHIPPING_THRESHOLD = 10_000;
export const SHIPPING_FLAT = 500;
export const TAX_RATE = 0.18;

export function orderTotals(subtotal: number) {
  const shipping = subtotal >= FREE_SHIPPING_THRESHOLD || subtotal === 0 ? 0 : SHIPPING_FLAT;
  const tax = Math.round(subtotal * TAX_RATE);
  return { subtotal, shipping, tax, total: subtotal + shipping + tax };
}
