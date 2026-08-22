import { randomBytes } from 'node:crypto';
import { Prisma, type OrderStatus, type PaymentStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { paymentMode, paymentReturnOrigin } from '../../config/env.js';
import { HttpError } from '../../utils/http.js';
import { fromMinor, toMinor } from './money.js';
import { providerForPayment, resolveProvider } from './registry.js';
import {
  SETTLED_STATUSES,
  canTransition,
  orderStatusAfterCapture,
  orderStatusAfterRefund,
  transitionError,
} from './state.js';
import type {
  PaymentOutcome,
  PaymentProvider,
  RawWebhook,
  WebhookEvent,
} from './types.js';

/**
 * PaymentService — the only place a payment record is allowed to move.
 *
 * Everything a gateway tells us passes through `applyOutcome`, which:
 *
 *   1. claims an idempotency key, so a replayed or concurrent delivery of the
 *      same event applies exactly once;
 *   2. re-derives the authoritative amount from the *order* and refuses a
 *      settlement whose amount or currency disagrees;
 *   3. checks the payment state machine, so FAILED never becomes CAPTURED and
 *      REFUNDED is terminal;
 *   4. writes conditionally on the status it read, so two callbacks racing each
 *      other cannot both capture;
 *   5. and only then translates the settlement into the one order transition it
 *      implies.
 *
 * Stock, production plans and revenue need no protection here by construction:
 * stock is reserved and plans are built when the order is created, and revenue
 * is a query over settled payments rather than a running total. There is no
 * counter for a duplicate webhook to increment.
 */

export type ApplyReason =
  | 'applied'
  | 'duplicate'
  | 'no-change'
  | 'raced'
  | 'blocked'
  | 'amount-mismatch'
  | 'provider-mismatch';

export interface ApplyResult {
  applied: boolean;
  reason: ApplyReason;
  status: PaymentStatus;
  detail?: string;
}

/** How a callback identifies the payment it concerns. */
export interface PaymentLocator {
  orderId?: string | null;
  reference?: string | null;
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
}

const REFERENCE_PREFIX = 'DQP';

/** Merchant-side transaction id: unique per attempt, no customer data in it. */
const newReference = () =>
  `${REFERENCE_PREFIX}${Date.now().toString(36).toUpperCase()}${randomBytes(5).toString('hex').toUpperCase()}`;

const webhookUrlFor = (providerId: string) =>
  new URL(`/api/payments/webhooks/${providerId}`, paymentReturnOrigin).toString();

const returnUrlFor = (orderId: string) =>
  new URL(`/order-success/${orderId}`, paymentReturnOrigin).toString();

// ── Opening a charge ────────────────────────────────────────────────────────

export interface OpenPaymentResult {
  provider: string;
  mode: 'test' | 'live';
  orderId: string;
  reference: string;
  amount: string;
  currency: string;
  handoff: string;
  redirectUrl?: string;
  sdk?: Record<string, string | number>;
}

/**
 * Opens a charge for an order. Never marks anything paid; the returned handoff
 * is how the browser reaches the gateway, and the gateway's own callback is
 * what settles it.
 */
export async function openPayment(input: {
  orderId: string;
  requestedProvider?: string | null;
}): Promise<OpenPaymentResult> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      number: true,
      total: true,
      currency: true,
      email: true,
      phone: true,
      status: true,
      payment: true,
    },
  });

  if (!order) throw HttpError.notFound('Order not found');

  if (['CANCELLED', 'REFUNDED'].includes(order.status)) {
    throw HttpError.badRequest('This order can no longer be paid');
  }
  if (order.payment && SETTLED_STATUSES.includes(order.payment.status)) {
    throw HttpError.conflict('This order has already been paid');
  }
  if (order.payment?.status === 'AUTHORIZED') {
    throw HttpError.conflict('A payment for this order is already in progress');
  }

  // Reuse the provider that already opened this payment unless the customer
  // explicitly picks a different one — a repeated Pay click must not orphan the
  // charge that is already open.
  const provider = resolveProvider(
    input.requestedProvider ?? liveProviderOf(order.payment?.provider),
  );

  // The one authoritative amount: recomputed from the order row, never from the
  // request body.
  const amountMinor = toMinor(order.total, order.currency);
  const reference = newReference();

  const result = await provider.createPayment({
    orderId: order.id,
    orderNumber: order.number,
    reference,
    amountMinor,
    currency: order.currency,
    email: order.email,
    phone: order.phone,
    returnUrl: returnUrlFor(order.id),
    webhookUrl: webhookUrlFor(provider.id),
  });

  // The row is (re)opened as PENDING under the new reference. Only a PENDING or
  // FAILED payment can get here, and FAILED → PENDING is a legal transition.
  await prisma.payment.update({
    where: { orderId: order.id },
    data: {
      provider: provider.id,
      status: 'PENDING',
      mode: paymentMode,
      amount: order.total,
      currency: order.currency,
      reference,
      providerOrderId: result.providerOrderId ?? null,
      providerPaymentId: null,
      failureReason: null,
      rawPayload: (result.raw ?? null) as Prisma.InputJsonValue,
    },
  });

  return {
    provider: provider.id,
    mode: paymentMode,
    orderId: order.id,
    reference,
    amount: order.total.toFixed(2),
    currency: order.currency,
    handoff: result.handoff,
    redirectUrl: result.redirectUrl,
    sdk: result.sdk,
  };
}

/** `pending` is the placeholder an order is created with, not a real provider. */
const liveProviderOf = (name: string | undefined) =>
  !name || name === 'pending' ? null : name;

// ── Return leg ──────────────────────────────────────────────────────────────

/**
 * Verification driven by the browser coming back from the gateway. The payload
 * is only ever used as *evidence* — a signature to check, or ids to look up.
 * Every provider here either verifies a signature it could not have forged or
 * re-reads the status from the gateway's API.
 */
export async function verifyReturnLeg(input: {
  orderId: string;
  payload?: unknown;
}): Promise<ApplyResult> {
  const payment = await prisma.payment.findUnique({
    where: { orderId: input.orderId },
    select: {
      provider: true,
      status: true,
      reference: true,
      providerOrderId: true,
      providerPaymentId: true,
    },
  });

  if (!payment) throw HttpError.notFound('No payment has been opened for that order');

  // Already settled: nothing to verify, and re-reading the gateway on every
  // page load of the confirmation screen would be pointless traffic.
  if (SETTLED_STATUSES.includes(payment.status)) {
    return { applied: false, reason: 'no-change', status: payment.status };
  }

  const providerName = liveProviderOf(payment.provider);
  if (!providerName) {
    return { applied: false, reason: 'no-change', status: payment.status };
  }

  const provider = providerForPayment(providerName);

  const outcome = await provider.verifyPayment({
    reference: payment.reference ?? '',
    providerOrderId: payment.providerOrderId,
    providerPaymentId: payment.providerPaymentId,
    payload: input.payload,
  });

  return applyOutcome({
    provider,
    locator: { orderId: input.orderId },
    outcome,
    source: 'return-leg',
  });
}

// ── Webhooks ────────────────────────────────────────────────────────────────

export interface WebhookResult extends ApplyResult {
  eventType: string;
}

/**
 * Verifies, records and applies one provider callback. The signature is checked
 * before anything is read out of the body — an unsigned or badly signed request
 * never reaches the database.
 */
export async function handleWebhook(
  providerName: string,
  raw: RawWebhook,
): Promise<WebhookResult> {
  const provider = providerForPayment(providerName);

  // Throws SignatureError on a forged or replayed request.
  const event: WebhookEvent = await provider.parseWebhook(raw);

  const locator: PaymentLocator = {
    reference: event.reference ?? null,
    providerOrderId: event.providerOrderId ?? null,
    providerPaymentId: event.providerPaymentId ?? null,
  };

  if (!event.outcome) {
    // Informational event: recorded so a redelivery is a no-op, applied to
    // nothing.
    const recorded = await recordEventOnly(provider.id, event, locator);
    return { ...recorded, eventType: event.type };
  }

  const result = await applyOutcome({
    provider,
    locator,
    outcome: event.outcome,
    event: { id: event.eventId, type: event.type },
    source: 'webhook',
  });

  return { ...result, eventType: event.type };
}

async function recordEventOnly(
  providerId: string,
  event: WebhookEvent,
  locator: PaymentLocator,
): Promise<ApplyResult> {
  const payment = await findPayment(prisma, locator);
  try {
    await prisma.paymentEvent.create({
      data: {
        provider: providerId,
        eventId: event.eventId,
        type: event.type,
        paymentId: payment?.id ?? null,
        result: 'ignored',
        detail: 'event carries no payment verdict',
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { applied: false, reason: 'duplicate', status: payment?.status ?? 'PENDING' };
    }
    throw error;
  }
  return { applied: false, reason: 'no-change', status: payment?.status ?? 'PENDING' };
}

// ── The one write path ──────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

interface PaymentRow {
  id: string;
  orderId: string;
  provider: string;
  status: PaymentStatus;
  amount: Prisma.Decimal;
  currency: string;
  refundedAmount: Prisma.Decimal;
  reference: string | null;
  order: { id: string; number: string; status: OrderStatus };
}

const PAYMENT_SELECT = {
  id: true,
  orderId: true,
  provider: true,
  status: true,
  amount: true,
  currency: true,
  refundedAmount: true,
  reference: true,
  order: { select: { id: true, number: true, status: true } },
} as const;

/**
 * Resolves a callback to a payment. Order id first (unambiguous), then our own
 * merchant reference, then the gateway's handles — all of which are unique
 * columns, so none of them can match two payments.
 */
async function findPayment(
  client: Prisma.TransactionClient | typeof prisma,
  locator: PaymentLocator,
): Promise<PaymentRow | null> {
  if (locator.orderId) {
    return client.payment.findUnique({
      where: { orderId: locator.orderId },
      select: PAYMENT_SELECT,
    });
  }
  if (locator.reference) {
    const found = await client.payment.findUnique({
      where: { reference: locator.reference },
      select: PAYMENT_SELECT,
    });
    if (found) return found;
  }
  if (locator.providerOrderId) {
    const found = await client.payment.findFirst({
      where: { providerOrderId: locator.providerOrderId },
      select: PAYMENT_SELECT,
    });
    if (found) return found;
  }
  if (locator.providerPaymentId) {
    return client.payment.findFirst({
      where: { providerPaymentId: locator.providerPaymentId },
      select: PAYMENT_SELECT,
    });
  }
  return null;
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Normalises a provider's verdict against what we know. A refund total decides
 * REFUNDED vs PARTIALLY_REFUNDED locally rather than trusting the provider's
 * own labelling of a partial.
 */
function resolveStatus(outcome: PaymentOutcome, payment: PaymentRow): PaymentStatus {
  const refundedMinor = outcome.refundedMinor ?? 0;
  if (refundedMinor <= 0) return outcome.status;

  const total = toMinor(payment.amount, payment.currency);
  return refundedMinor >= total ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
}

export async function applyOutcome(input: {
  provider: PaymentProvider;
  locator: PaymentLocator;
  outcome: PaymentOutcome;
  event?: { id: string; type: string };
  source: 'webhook' | 'return-leg' | 'admin';
  actorEmail?: string | null;
}): Promise<ApplyResult> {
  const { provider, outcome, event, source } = input;

  return prisma.$transaction(async (tx) => {
    const payment = await findPayment(tx, input.locator);

    if (!payment) {
      // A signed event we cannot match is recorded, not retried forever, and
      // not treated as an error the provider should keep redelivering.
      if (event) {
        await claimEvent(tx, provider.id, event, null, 'ignored', 'no matching payment');
      }
      return { applied: false, reason: 'no-change' as const, status: 'PENDING' as PaymentStatus };
    }

    // Claimed *before* any work, so two identical deliveries serialise on the
    // unique index and the loser rolls back having changed nothing.
    if (event) {
      const claimed = await claimEvent(tx, provider.id, event, payment.id, 'applied');
      if (!claimed) {
        return { applied: false, reason: 'duplicate' as const, status: payment.status };
      }
    }

    // A payment opened by one gateway is never settled by another.
    if (payment.provider !== provider.id && payment.provider !== 'pending') {
      await noteEvent(tx, event, payment.id, 'rejected', `payment belongs to ${payment.provider}`);
      return {
        applied: false,
        reason: 'provider-mismatch' as const,
        status: payment.status,
        detail: `This payment was opened with ${payment.provider}`,
      };
    }

    const target = resolveStatus(outcome, payment);

    // ── State machine, before anything else ───────────────────────────────
    // This has to come first. A late event contradicting a settled payment is
    // simply not permitted, and must not be able to reach the amount check —
    // where a mismatch would otherwise force a CAPTURED payment to FAILED and
    // step around the machine entirely.
    if (!canTransition(payment.status, target)) {
      const detail = transitionError(payment.status, target);
      await noteEvent(tx, event, payment.id, 'rejected', detail);
      return { applied: false, reason: 'blocked' as const, status: payment.status, detail };
    }

    // ── Amount and currency, re-derived from the order ─────────────────────
    const settling = SETTLED_STATUSES.includes(target) || target === 'REFUNDED';

    if (settling) {
      const expectedMinor = toMinor(payment.amount, payment.currency);
      const mismatch =
        outcome.amountMinor != null && outcome.amountMinor !== expectedMinor
          ? `provider reported ${outcome.amountMinor} minor units, order is ${expectedMinor}`
          : outcome.currency && outcome.currency.toUpperCase() !== payment.currency.toUpperCase()
            ? `provider reported ${outcome.currency}, order is ${payment.currency}`
            : null;

      if (mismatch) {
        // An underpayment *and* an overpayment are both refused: neither is the
        // amount this order is for.
        const failed = await recordAmountMismatch(tx, payment, mismatch);
        await noteEvent(tx, event, payment.id, 'rejected', mismatch);
        return {
          applied: false,
          reason: 'amount-mismatch' as const,
          status: failed ? ('FAILED' as PaymentStatus) : payment.status,
          detail: mismatch,
        };
      }
    }

    // ── Duplicate-payment protection ──────────────────────────────────────
    // One gateway payment id settles exactly one order. Checked here rather
    // than left to the unique index, because a constraint violation would abort
    // the transaction and lose the rejection record along with it.
    if (outcome.providerPaymentId) {
      const claimedElsewhere = await tx.payment.findFirst({
        where: {
          provider: provider.id,
          providerPaymentId: outcome.providerPaymentId,
          id: { not: payment.id },
        },
        select: { orderId: true },
      });

      if (claimedElsewhere) {
        const detail = `${provider.id} payment ${outcome.providerPaymentId} already settled another order`;
        await noteEvent(tx, event, payment.id, 'rejected', detail);
        return { applied: false, reason: 'blocked' as const, status: payment.status, detail };
      }
    }

    if (payment.status === target && !outcome.providerPaymentId) {
      await noteEvent(tx, event, payment.id, 'ignored', 'no change');
      return { applied: false, reason: 'no-change' as const, status: payment.status };
    }

    const now = new Date();
    const refundedMinor = outcome.refundedMinor ?? 0;

    // ── Conditional write: only the caller that read this status may move it ─
    const written = await tx.payment.updateMany({
      where: { id: payment.id, status: payment.status },
      data: {
        status: target,
        ...(outcome.providerPaymentId ? { providerPaymentId: outcome.providerPaymentId } : {}),
        ...(outcome.providerOrderId ? { providerOrderId: outcome.providerOrderId } : {}),
        ...(target === 'FAILED'
          ? { failureReason: outcome.failureReason ?? 'The payment did not complete' }
          : { failureReason: null }),
        // Stamped once, on the transition into a settled state, so a later
        // refund event does not rewrite when the money actually arrived.
        ...(target === 'CAPTURED' && payment.status !== 'CAPTURED' ? { paidAt: now } : {}),
        ...(refundedMinor > 0
          ? {
              refundedAmount: fromMinor(refundedMinor, payment.currency),
              refundedAt: now,
            }
          : {}),
        rawPayload: (outcome.raw ?? null) as Prisma.InputJsonValue,
      },
    });

    if (written.count === 0) {
      // Someone else moved the row between the read and the write.
      await noteEvent(tx, event, payment.id, 'ignored', 'lost a concurrent update');
      return { applied: false, reason: 'raced' as const, status: payment.status };
    }

    // ── The order transition this settlement implies ──────────────────────
    await advanceOrder(tx, payment, target, refundedMinor, input.actorEmail ?? null, source);

    await noteEvent(tx, event, payment.id, 'applied', `${payment.status} → ${target}`);

    return { applied: true, reason: 'applied' as const, status: target };
  });
}

/**
 * Inserts the idempotency row. Returns false when the key is already claimed,
 * which is the entire duplicate-webhook defence.
 */
async function claimEvent(
  tx: Tx,
  providerId: string,
  event: { id: string; type: string },
  paymentId: string | null,
  result: string,
  detail?: string,
): Promise<boolean> {
  try {
    await tx.paymentEvent.create({
      data: {
        provider: providerId,
        eventId: event.id,
        type: event.type,
        paymentId,
        result,
        detail: detail ?? null,
      },
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/** Updates the claimed row's verdict once the outcome is known. */
async function noteEvent(
  tx: Tx,
  event: { id: string; type: string } | undefined,
  paymentId: string,
  result: string,
  detail: string,
): Promise<void> {
  if (!event) return;
  await tx.paymentEvent.updateMany({
    where: { eventId: event.id, paymentId },
    data: { result, detail },
  });
}

/**
 * An amount that disagrees with the order is a hard failure, not a capture.
 *
 * The payment is only moved to FAILED when that is a legal transition — a
 * settled payment stays settled, and the mismatch is recorded on the timeline
 * either way so it is visible in admin. Returns whether the status moved.
 */
async function recordAmountMismatch(
  tx: Tx,
  payment: PaymentRow,
  detail: string,
): Promise<boolean> {
  const reason = `Amount mismatch — ${detail}`;
  const canFail = canTransition(payment.status, 'FAILED');

  if (canFail) {
    await tx.payment.updateMany({
      where: { id: payment.id, status: payment.status },
      data: { status: 'FAILED', failureReason: reason },
    });
  } else {
    // Record the reason without touching a status the machine protects.
    await tx.payment.updateMany({
      where: { id: payment.id, status: payment.status },
      data: { failureReason: reason },
    });
  }

  await tx.orderEvent.create({
    data: { orderId: payment.orderId, label: 'Payment rejected', detail: reason },
  });

  return canFail;
}

async function advanceOrder(
  tx: Tx,
  payment: PaymentRow,
  target: PaymentStatus,
  refundedMinor: number,
  actorEmail: string | null,
  source: string,
): Promise<void> {
  const current = payment.order.status;

  if (SETTLED_STATUSES.includes(target) && refundedMinor === 0) {
    const next = orderStatusAfterCapture(current);
    if (next) {
      // Conditional on the status we read, so a webhook and a return leg
      // arriving together produce one transition, not two.
      await tx.order.updateMany({ where: { id: payment.orderId, status: current }, data: { status: next } });
    }
    await tx.orderEvent.create({
      data: {
        orderId: payment.orderId,
        label: 'Payment received',
        detail: `${payment.provider} · ${source}`,
        actorEmail,
      },
    });
    return;
  }

  if (target === 'REFUNDED' || target === 'PARTIALLY_REFUNDED') {
    const next = orderStatusAfterRefund(current, target === 'REFUNDED');
    if (next) {
      await tx.order.updateMany({ where: { id: payment.orderId, status: current }, data: { status: next } });
    }
    await tx.orderEvent.create({
      data: {
        orderId: payment.orderId,
        label: target === 'REFUNDED' ? 'Payment refunded' : 'Payment partially refunded',
        detail: `${payment.provider} · ${source}`,
        actorEmail,
      },
    });
    return;
  }

  if (target === 'FAILED') {
    await tx.orderEvent.create({
      data: {
        orderId: payment.orderId,
        label: 'Payment failed',
        detail: `${payment.provider} · ${source}`,
        actorEmail,
      },
    });
  }
}

// ── Refunds ─────────────────────────────────────────────────────────────────

/**
 * Refunds through the gateway that took the money, then applies the result
 * through the same guarded path. The amount is validated against what is still
 * refundable, so a repeated request cannot over-refund.
 */
export async function refundPayment(input: {
  orderId: string;
  amount?: string | number | null;
  actorEmail: string | null;
}): Promise<ApplyResult> {
  const payment = await prisma.payment.findUnique({
    where: { orderId: input.orderId },
    select: {
      provider: true,
      status: true,
      amount: true,
      currency: true,
      refundedAmount: true,
      reference: true,
      providerPaymentId: true,
    },
  });

  if (!payment) throw HttpError.notFound('That order has no payment to refund');
  if (!SETTLED_STATUSES.includes(payment.status)) {
    throw HttpError.badRequest(`A ${payment.status} payment cannot be refunded`);
  }

  const totalMinor = toMinor(payment.amount, payment.currency);
  const alreadyMinor = toMinor(payment.refundedAmount, payment.currency);
  const remainingMinor = totalMinor - alreadyMinor;

  if (remainingMinor <= 0) throw HttpError.badRequest('This payment is already fully refunded');

  const requestedMinor =
    input.amount == null ? remainingMinor : toMinor(input.amount, payment.currency);

  if (requestedMinor <= 0) throw HttpError.badRequest('A refund must be greater than zero');
  if (requestedMinor > remainingMinor) {
    throw HttpError.badRequest(
      `At most ${fromMinor(remainingMinor, payment.currency).toFixed(2)} ${payment.currency} can still be refunded`,
    );
  }

  const provider = providerForPayment(payment.provider);
  if (!provider.capabilities.refunds) {
    throw HttpError.badRequest(`${provider.label} does not support refunds through the API`);
  }

  const refundReference = `${payment.reference ?? input.orderId}-R${alreadyMinor + requestedMinor}`;

  const result = await provider.refundPayment({
    providerPaymentId: payment.providerPaymentId ?? payment.reference ?? '',
    originalReference: payment.reference ?? '',
    amountMinor: requestedMinor,
    currency: payment.currency,
    reference: refundReference,
  });

  // Cumulative total, so a provider that only reports this one refund still
  // lands on the right figure.
  const refundedMinor = Math.max(result.refundedMinor, alreadyMinor + requestedMinor);

  return applyOutcome({
    provider,
    locator: { orderId: input.orderId },
    outcome: {
      status: refundedMinor >= totalMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      refundedMinor,
      raw: result.raw ?? null,
    },
    // The refund reference doubles as the idempotency key: the same cumulative
    // refund cannot be recorded twice.
    event: { id: `refund:${refundReference}`, type: 'refund' },
    source: 'admin',
    actorEmail: input.actorEmail,
  });
}

/**
 * Admin-driven status change (reconciling a bank transfer, writing off a failed
 * charge). Goes through the same state machine as everything else — an admin
 * cannot invent FAILED → CAPTURED either — and is audit-logged by its caller.
 */
export async function setPaymentStatusAsAdmin(input: {
  orderId: string;
  status: PaymentStatus;
  reference?: string | null;
  actorEmail: string | null;
}): Promise<ApplyResult> {
  const payment = await prisma.payment.findUnique({
    where: { orderId: input.orderId },
    select: { provider: true, status: true, amount: true, currency: true },
  });
  if (!payment) throw HttpError.notFound('That order has no payment record');

  if (!canTransition(payment.status, input.status)) {
    throw HttpError.badRequest(transitionError(payment.status, input.status));
  }

  // Gateway payments are settled by the gateway. Letting an admin hand-capture
  // one would put the books out of step with the processor.
  const gatewayBacked = payment.provider !== 'manual' && payment.provider !== 'pending';
  if (gatewayBacked && SETTLED_STATUSES.includes(input.status)) {
    throw HttpError.badRequest(
      `${payment.provider} payments are captured by the provider — use the refund action or let the webhook settle it`,
    );
  }

  const provider = providerForPayment(gatewayBacked ? payment.provider : 'manual');
  const refundedMinor =
    input.status === 'REFUNDED' ? toMinor(payment.amount, payment.currency) : 0;

  return applyOutcome({
    provider,
    locator: { orderId: input.orderId },
    outcome: { status: input.status, refundedMinor: refundedMinor || null },
    source: 'admin',
    actorEmail: input.actorEmail,
  });
}
