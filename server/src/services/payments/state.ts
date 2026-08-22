import type { OrderStatus, PaymentStatus } from '@prisma/client';

/**
 * The payment state machine.
 *
 * Payment status and order status stay separate concepts: this file governs
 * only the money, and `orderStatusAfterCapture` / `orderStatusAfterRefund`
 * translate a settled payment into the one order transition it implies. An
 * order already in production is never dragged back to PAID.
 *
 * The existing PaymentStatus enum is reused rather than extended. AUTHORIZED is
 * the "processing" state — the gateway holds the funds but has not captured.
 *
 *   PENDING     → AUTHORIZED | CAPTURED | FAILED
 *   AUTHORIZED  → CAPTURED | FAILED
 *   CAPTURED    → PARTIALLY_REFUNDED | REFUNDED
 *   FAILED      → PENDING          (a *new* attempt reopens the row)
 *   PARTIALLY_REFUNDED → REFUNDED
 *   REFUNDED    → (terminal)
 *
 * FAILED → CAPTURED is deliberately absent. A payment that failed can only
 * reach CAPTURED by going through PENDING again, which only `createPayment`
 * does, and which mints a fresh merchant reference.
 */
const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ['AUTHORIZED', 'CAPTURED', 'FAILED'],
  AUTHORIZED: ['CAPTURED', 'FAILED'],
  CAPTURED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  FAILED: ['PENDING'],
  PARTIALLY_REFUNDED: ['REFUNDED'],
  REFUNDED: [],
};

/** Statuses that count as money actually received. */
export const SETTLED_STATUSES: readonly PaymentStatus[] = ['CAPTURED', 'PARTIALLY_REFUNDED'];

/** A no-op restatement of the current status is always allowed and never writes. */
export const canTransition = (from: PaymentStatus, to: PaymentStatus): boolean =>
  from === to || TRANSITIONS[from].includes(to);

export const nextStatuses = (from: PaymentStatus): readonly PaymentStatus[] => TRANSITIONS[from];

export function transitionError(from: PaymentStatus, to: PaymentStatus): string {
  const allowed = TRANSITIONS[from];
  return allowed.length === 0
    ? `Payment is ${from}, which is final — it cannot become ${to}`
    : `A ${from} payment cannot become ${to} (allowed: ${allowed.join(', ')})`;
}

/**
 * Order statuses a captured payment is allowed to advance from. Anything
 * further along the fulfilment chain already implies payment and is left
 * untouched, so a late webhook cannot rewind a shipped order.
 */
const CAPTURE_ADVANCES_FROM: readonly OrderStatus[] = ['PENDING', 'CONFIRMED'];

/** The order transition a capture implies, or null to leave the order alone. */
export function orderStatusAfterCapture(current: OrderStatus): OrderStatus | null {
  return CAPTURE_ADVANCES_FROM.includes(current) ? 'PAID' : null;
}

/**
 * A full refund moves the order to REFUNDED unless it is already there or was
 * cancelled. A partial refund never changes the order status — the goods may
 * still be owed.
 */
export function orderStatusAfterRefund(
  current: OrderStatus,
  full: boolean,
): OrderStatus | null {
  if (!full) return null;
  if (current === 'REFUNDED' || current === 'CANCELLED') return null;
  return 'REFUNDED';
}
