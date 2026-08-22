import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentStatus } from '@prisma/client';
import { env, paymentMode } from '../../config/env.js';
import { gatewayFetch } from './http.js';
import { SignatureError, type PaymentOutcome, type PaymentProvider } from './types.js';

/**
 * Razorpay, against the documented REST API (api.razorpay.com/v1).
 *
 *   Orders            POST /v1/orders                    (HTTP Basic key:secret)
 *   Payment lookup    GET  /v1/payments/{payment_id}
 *   Order's payments  GET  /v1/orders/{order_id}/payments
 *   Refund            POST /v1/payments/{payment_id}/refund
 *
 * Two independent verification paths, both server-side:
 *
 *  1. Return leg — Checkout hands the browser `razorpay_order_id`,
 *     `razorpay_payment_id` and `razorpay_signature`. The signature is
 *     HMAC-SHA256 of `order_id|payment_id` keyed with the *secret*, so a
 *     browser cannot forge it. On top of that we re-fetch the payment from
 *     Razorpay, because a valid signature only proves the ids are genuinely
 *     ours — it does not prove the charge succeeded or its amount.
 *  2. Webhook — `X-Razorpay-Signature` is HMAC-SHA256 of the raw request body
 *     keyed with the *webhook* secret (a different secret from the API one).
 */
const API = 'https://api.razorpay.com/v1';

function authHeader(): string {
  const encoded = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString(
    'base64',
  );
  return `Basic ${encoded}`;
}

/** Constant-time hex comparison; a length mismatch is a mismatch. */
function hmacMatches(expectedHex: string, receivedHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const received = Buffer.from(receivedHex.trim().toLowerCase(), 'hex');
  if (expected.length === 0 || expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

const sign = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

/** Razorpay payment entity → our payment status. */
function mapStatus(status: string | undefined, amountRefunded: number | undefined): PaymentStatus {
  switch (status) {
    case 'captured':
      if (amountRefunded && amountRefunded > 0) return 'PARTIALLY_REFUNDED';
      return 'CAPTURED';
    case 'refunded':
      return 'REFUNDED';
    case 'authorized':
      return 'AUTHORIZED';
    case 'failed':
      return 'FAILED';
    // `created` — Checkout opened but the customer has not paid.
    default:
      return 'PENDING';
  }
}

interface RazorpayPayment {
  id?: string;
  order_id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  amount_refunded?: number;
  error_description?: string;
  error_reason?: string;
}

function toOutcome(payment: RazorpayPayment): PaymentOutcome {
  const status = mapStatus(payment.status, payment.amount_refunded);

  return {
    status,
    providerPaymentId: payment.id ?? null,
    providerOrderId: payment.order_id ?? null,
    amountMinor: typeof payment.amount === 'number' ? payment.amount : null,
    currency: payment.currency ?? null,
    refundedMinor:
      typeof payment.amount_refunded === 'number' ? payment.amount_refunded : null,
    failureReason:
      status === 'FAILED'
        ? (payment.error_description ?? payment.error_reason ?? 'Razorpay reported a failed payment')
        : null,
    // The payment entity holds no card data — Razorpay returns only the
    // network, last4-free method summary — but we keep just the fields we read.
    raw: {
      id: payment.id,
      order_id: payment.order_id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      amount_refunded: payment.amount_refunded,
    },
  };
}

const fetchPayment = (paymentId: string) =>
  gatewayFetch<RazorpayPayment>({
    providerId: 'razorpay',
    url: `${API}/payments/${encodeURIComponent(paymentId)}`,
    headers: { Authorization: authHeader() },
  });

export const razorpayProvider: PaymentProvider = {
  id: 'razorpay',
  label: 'Razorpay',
  capabilities: { refunds: true, webhooks: true, statusFetch: true },

  configErrors() {
    const errors: string[] = [];
    if (!env.RAZORPAY_KEY_ID) errors.push('RAZORPAY_KEY_ID is not set');
    if (!env.RAZORPAY_KEY_SECRET) errors.push('RAZORPAY_KEY_SECRET is not set');
    // Without it a webhook cannot be authenticated, and an unauthenticated
    // webhook is worse than none — so the provider stays unavailable.
    if (!env.RAZORPAY_WEBHOOK_SECRET) errors.push('RAZORPAY_WEBHOOK_SECRET is not set');

    const keyId = env.RAZORPAY_KEY_ID;
    if (keyId) {
      const keyMode = keyId.startsWith('rzp_live_')
        ? 'live'
        : keyId.startsWith('rzp_test_')
          ? 'test'
          : null;
      if (keyMode && keyMode !== paymentMode) {
        errors.push(`RAZORPAY_KEY_ID is a ${keyMode} key but PAYMENT_MODE is ${paymentMode}`);
      }
    }
    return errors;
  },

  // key_id is Razorpay's publishable identifier — it is required by
  // checkout.js and is safe in a browser. The secret never leaves the server.
  publicConfig: (): Record<string, string> =>
    env.RAZORPAY_KEY_ID ? { keyId: env.RAZORPAY_KEY_ID } : {},

  async createPayment({ reference, amountMinor, currency, orderNumber, email, phone }) {
    const order = await gatewayFetch<{ id: string; amount: number; currency: string }>({
      providerId: 'razorpay',
      url: `${API}/orders`,
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Server-computed. The browser never supplies an amount.
        amount: amountMinor,
        currency,
        receipt: reference,
        notes: { orderNumber, email, ...(phone ? { phone } : {}) },
      }),
    });

    return {
      handoff: 'sdk',
      providerOrderId: order.id,
      sdk: {
        keyId: env.RAZORPAY_KEY_ID!,
        razorpayOrderId: order.id,
        amount: order.amount,
        currency: order.currency,
      },
      raw: { id: order.id, amount: order.amount, currency: order.currency },
    };
  },

  async verifyPayment({ providerOrderId, providerPaymentId, payload }) {
    const body = (payload ?? {}) as Record<string, unknown>;
    const orderId = String(body.razorpay_order_id ?? providerOrderId ?? '');
    const paymentId = String(body.razorpay_payment_id ?? providerPaymentId ?? '');
    const signature = typeof body.razorpay_signature === 'string' ? body.razorpay_signature : '';

    if (!orderId || !paymentId) {
      throw new SignatureError('Razorpay verification needs both an order id and a payment id');
    }
    if (!signature) throw new SignatureError('Razorpay signature is missing');

    const expected = sign(`${orderId}|${paymentId}`, env.RAZORPAY_KEY_SECRET!);
    if (!hmacMatches(expected, signature)) {
      throw new SignatureError('Razorpay signature does not match');
    }

    // The signature proves the ids are ours. Only Razorpay can say whether the
    // money arrived, and for how much.
    const payment = await fetchPayment(paymentId);
    if (payment.order_id && payment.order_id !== orderId) {
      throw new SignatureError('Razorpay payment belongs to a different order');
    }
    return toOutcome(payment);
  },

  async getPaymentStatus({ providerOrderId, providerPaymentId }) {
    if (providerPaymentId) return toOutcome(await fetchPayment(providerPaymentId));

    if (!providerOrderId) return { status: 'PENDING' };

    const list = await gatewayFetch<{ items?: RazorpayPayment[] }>({
      providerId: 'razorpay',
      url: `${API}/orders/${encodeURIComponent(providerOrderId)}/payments`,
      headers: { Authorization: authHeader() },
    });

    const items = list.items ?? [];
    // Prefer a settled attempt over an abandoned one: several attempts against
    // one order is normal when a customer retries.
    const best =
      items.find((p) => p.status === 'captured' || p.status === 'refunded') ??
      items.find((p) => p.status === 'authorized') ??
      items.find((p) => p.status === 'failed');

    return best ? toOutcome(best) : { status: 'PENDING' };
  },

  async parseWebhook({ body, headers }) {
    const secret = env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw new SignatureError('Razorpay webhook secret is not configured');

    const received = header(headers, 'x-razorpay-signature');
    if (!received) throw new SignatureError('X-Razorpay-Signature header is missing');

    // Signed over the exact bytes delivered, so the raw buffer is used here —
    // re-serialising a parsed object would change the signature.
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    if (!hmacMatches(expected, received)) {
      throw new SignatureError('Razorpay webhook signature does not match');
    }

    const event = JSON.parse(body.toString('utf8')) as {
      event?: string;
      payload?: { payment?: { entity?: RazorpayPayment }; refund?: { entity?: unknown } };
      created_at?: number;
    };

    const type = event.event ?? 'unknown';
    const entity = event.payload?.payment?.entity;

    // Razorpay sends a stable event id header; falling back to a digest of the
    // signed body keeps the key stable across redeliveries either way.
    const eventId =
      header(headers, 'x-razorpay-event-id') ??
      createHmac('sha256', secret).update(body).digest('hex');

    // Refund events carry a refund entity whose `payment_id` points at the
    // charge; the payment entity is the authoritative source for the refunded
    // total, so those are resolved by re-fetching rather than trusted inline.
    if (type.startsWith('refund.') && !entity) {
      const refund = (event.payload?.refund as { entity?: { payment_id?: string } } | undefined)
        ?.entity;
      const paymentId = refund?.payment_id;
      if (!paymentId) return { eventId, type, outcome: null };

      return {
        eventId,
        type,
        providerPaymentId: paymentId,
        outcome: toOutcome(await fetchPayment(paymentId)),
      };
    }

    if (!entity) return { eventId, type, outcome: null };

    return {
      eventId,
      type,
      providerPaymentId: entity.id ?? null,
      providerOrderId: entity.order_id ?? null,
      outcome: toOutcome(entity),
    };
  },

  async refundPayment({ providerPaymentId, amountMinor, reference }) {
    const refund = await gatewayFetch<{ id?: string; amount?: number }>({
      providerId: 'razorpay',
      url: `${API}/payments/${encodeURIComponent(providerPaymentId)}/refund`,
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      // `receipt` is our own unique handle for this refund, so a duplicate
      // request is identifiable on the Razorpay side too.
      body: JSON.stringify({ amount: amountMinor, receipt: reference }),
    });

    // Re-read the payment so `refundedMinor` is Razorpay's cumulative total
    // rather than just this one refund.
    const payment = await fetchPayment(providerPaymentId);

    return {
      refundedMinor:
        typeof payment.amount_refunded === 'number' ? payment.amount_refunded : amountMinor,
      providerRefundId: refund.id ?? null,
      raw: { refundId: refund.id, amount: refund.amount },
    };
  },
};

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Exported for the deterministic signature fixtures in scripts/verify.mjs. */
export const __razorpayInternals = { sign, hmacMatches, mapStatus };
