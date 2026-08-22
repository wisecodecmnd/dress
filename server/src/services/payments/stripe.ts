import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentStatus } from '@prisma/client';
import { env, paymentMode } from '../../config/env.js';
import { gatewayFetch } from './http.js';
import { SignatureError, type PaymentOutcome, type PaymentProvider } from './types.js';

/**
 * Stripe, against the documented REST API (api.stripe.com/v1), form-encoded
 * with a Bearer secret key.
 *
 *   Session      POST /v1/checkout/sessions
 *   Session read GET  /v1/checkout/sessions/{id}?expand[]=payment_intent.latest_charge
 *   Intent read  GET  /v1/payment_intents/{id}?expand[]=latest_charge
 *   Refund       POST /v1/refunds
 *
 * The webhook is authoritative. A browser returning to `success_url` proves
 * nothing — the return leg here re-reads the session from Stripe, and the
 * capture that matters is the one `checkout.session.completed` /
 * `payment_intent.succeeded` delivers with a valid `Stripe-Signature`.
 */
const API = 'https://api.stripe.com/v1';

/** Stripe's own default tolerance for replayed webhook timestamps. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

const form = (fields: Record<string, string | number | undefined>): string =>
  Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

function headers(idempotencyKey?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
}

interface StripeCharge {
  amount_refunded?: number;
  refunded?: boolean;
}

interface StripeIntent {
  id?: string;
  status?: string;
  amount?: number;
  amount_received?: number;
  currency?: string;
  last_payment_error?: { message?: string };
  latest_charge?: string | StripeCharge | null;
}

interface StripeSession {
  id?: string;
  status?: string;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
  client_reference_id?: string | null;
  url?: string;
  payment_intent?: string | StripeIntent | null;
}

const chargeOf = (intent: StripeIntent | null | undefined): StripeCharge | null =>
  intent && intent.latest_charge && typeof intent.latest_charge === 'object'
    ? intent.latest_charge
    : null;

const intentOf = (session: StripeSession): StripeIntent | null =>
  session.payment_intent && typeof session.payment_intent === 'object'
    ? session.payment_intent
    : null;

const intentIdOf = (session: StripeSession): string | null => {
  if (typeof session.payment_intent === 'string') return session.payment_intent;
  return intentOf(session)?.id ?? null;
};

/** PaymentIntent status (+ refund state) → our payment status. */
function mapIntentStatus(intent: StripeIntent): PaymentStatus {
  const charge = chargeOf(intent);
  const refunded = charge?.amount_refunded ?? 0;

  switch (intent.status) {
    case 'succeeded': {
      if (refunded <= 0) return 'CAPTURED';
      const total = intent.amount_received ?? intent.amount ?? 0;
      return refunded >= total && total > 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    }
    case 'requires_capture':
      return 'AUTHORIZED';
    case 'canceled':
      return 'FAILED';
    // requires_payment_method / requires_confirmation / requires_action /
    // processing — the customer has not finished.
    default:
      return 'PENDING';
  }
}

function outcomeFromIntent(intent: StripeIntent): PaymentOutcome {
  const status = mapIntentStatus(intent);
  const charge = chargeOf(intent);

  return {
    status,
    providerPaymentId: intent.id ?? null,
    amountMinor:
      typeof intent.amount_received === 'number' && intent.amount_received > 0
        ? intent.amount_received
        : typeof intent.amount === 'number'
          ? intent.amount
          : null,
    currency: intent.currency ? intent.currency.toUpperCase() : null,
    refundedMinor: typeof charge?.amount_refunded === 'number' ? charge.amount_refunded : null,
    failureReason:
      status === 'FAILED'
        ? (intent.last_payment_error?.message ?? 'Stripe reported a cancelled or failed payment')
        : null,
    raw: {
      id: intent.id,
      status: intent.status,
      amount: intent.amount,
      amount_received: intent.amount_received,
      currency: intent.currency,
      amount_refunded: charge?.amount_refunded,
    },
  };
}

function outcomeFromSession(session: StripeSession): PaymentOutcome {
  const intent = intentOf(session);

  if (intent) {
    const outcome = outcomeFromIntent(intent);
    return { ...outcome, providerOrderId: session.id ?? null };
  }

  // Unexpanded session: `payment_status` is still trustworthy, and the amount
  // comes from `amount_total`, which is what Stripe actually charged.
  const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
  const expired = session.status === 'expired';

  return {
    status: paid ? 'CAPTURED' : expired ? 'FAILED' : 'PENDING',
    providerOrderId: session.id ?? null,
    providerPaymentId: intentIdOf(session),
    amountMinor: typeof session.amount_total === 'number' ? session.amount_total : null,
    currency: session.currency ? session.currency.toUpperCase() : null,
    failureReason: expired ? 'The Stripe checkout session expired' : null,
    raw: {
      id: session.id,
      status: session.status,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      currency: session.currency,
    },
  };
}

const fetchSession = (sessionId: string) =>
  gatewayFetch<StripeSession>({
    providerId: 'stripe',
    url: `${API}/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent.latest_charge`,
    headers: headers(),
  });

const fetchIntent = (intentId: string) =>
  gatewayFetch<StripeIntent>({
    providerId: 'stripe',
    url: `${API}/payment_intents/${encodeURIComponent(intentId)}?expand[]=latest_charge`,
    headers: headers(),
  });

/**
 * Verifies a `Stripe-Signature` header against the raw body. Follows Stripe's
 * documented scheme: signed payload is `${timestamp}.${body}`, HMAC-SHA256 with
 * the endpoint secret, hex, and any of the `v1=` entries may match (Stripe
 * sends several while a secret is being rotated).
 */
function verifyStripeSignature(body: Buffer, signatureHeader: string, secret: string): void {
  const parts = signatureHeader.split(',').map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
  const candidates = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));

  if (!timestamp || candidates.length === 0) {
    throw new SignatureError('Stripe-Signature header is malformed');
  }

  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > SIGNATURE_TOLERANCE_SECONDS) {
    // Blocks replay of a captured request long after the fact, independently of
    // the event-id ledger.
    throw new SignatureError('Stripe webhook timestamp is outside the tolerance window');
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest();

  const matched = candidates.some((candidate) => {
    const received = Buffer.from(candidate, 'hex');
    return received.length === expected.length && timingSafeEqual(expected, received);
  });

  if (!matched) throw new SignatureError('Stripe webhook signature does not match');
}

export const stripeProvider: PaymentProvider = {
  id: 'stripe',
  label: 'Stripe',
  capabilities: { refunds: true, webhooks: true, statusFetch: true },

  configErrors() {
    const errors: string[] = [];
    if (!env.STRIPE_SECRET_KEY) errors.push('STRIPE_SECRET_KEY is not set');
    if (!env.STRIPE_WEBHOOK_SECRET) errors.push('STRIPE_WEBHOOK_SECRET is not set');

    const modeOf = (key: string | undefined, live: string, test: string) =>
      !key ? null : key.startsWith(live) ? 'live' : key.startsWith(test) ? 'test' : null;

    const secretMode = modeOf(env.STRIPE_SECRET_KEY, 'sk_live_', 'sk_test_');
    if (secretMode && secretMode !== paymentMode) {
      errors.push(`STRIPE_SECRET_KEY is a ${secretMode} key but PAYMENT_MODE is ${paymentMode}`);
    }

    const publishableMode = modeOf(env.STRIPE_PUBLISHABLE_KEY, 'pk_live_', 'pk_test_');
    if (publishableMode && secretMode && publishableMode !== secretMode) {
      errors.push('STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY are from different modes');
    }
    return errors;
  },

  // Only the publishable key, which Stripe designs to be shipped to browsers.
  publicConfig: (): Record<string, string> =>
    env.STRIPE_PUBLISHABLE_KEY ? { publishableKey: env.STRIPE_PUBLISHABLE_KEY } : {},

  async createPayment({ reference, amountMinor, currency, orderNumber, email, returnUrl }) {
    const success = new URL(returnUrl);
    success.searchParams.set('provider', 'stripe');
    const cancel = new URL(returnUrl);
    cancel.searchParams.set('provider', 'stripe');
    cancel.searchParams.set('cancelled', '1');

    const session = await gatewayFetch<StripeSession>({
      providerId: 'stripe',
      url: `${API}/checkout/sessions`,
      method: 'POST',
      // Keyed on our merchant reference, so a double-clicked Pay button reuses
      // the same session instead of opening a second one.
      headers: headers(`session_${reference}`),
      body: form({
        mode: 'payment',
        client_reference_id: reference,
        customer_email: email,
        success_url: success.toString(),
        cancel_url: cancel.toString(),
        'line_items[0][quantity]': 1,
        'line_items[0][price_data][currency]': currency.toLowerCase(),
        // Server-computed total. The browser never supplies an amount.
        'line_items[0][price_data][unit_amount]': amountMinor,
        'line_items[0][price_data][product_data][name]': `DENIMQUE order ${orderNumber}`,
        'metadata[orderNumber]': orderNumber,
        'metadata[reference]': reference,
      }),
    });

    if (!session.url || !session.id) {
      throw new Error('Stripe did not return a checkout session URL');
    }

    return {
      handoff: 'redirect',
      providerOrderId: session.id,
      redirectUrl: session.url,
      raw: { id: session.id, amount_total: session.amount_total, currency: session.currency },
    };
  },

  // A return from `success_url` is not evidence of anything, so the session is
  // re-read from Stripe. Identical to getPaymentStatus by design.
  verifyPayment(input) {
    return stripeProvider.getPaymentStatus(input);
  },

  async getPaymentStatus({ providerOrderId, providerPaymentId }) {
    if (providerOrderId?.startsWith('cs_')) {
      return outcomeFromSession(await fetchSession(providerOrderId));
    }
    if (providerPaymentId?.startsWith('pi_')) {
      return outcomeFromIntent(await fetchIntent(providerPaymentId));
    }
    return { status: 'PENDING' };
  },

  async parseWebhook({ body, headers: requestHeaders }) {
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new SignatureError('Stripe webhook secret is not configured');

    const signature = headerValue(requestHeaders, 'stripe-signature');
    if (!signature) throw new SignatureError('Stripe-Signature header is missing');

    verifyStripeSignature(body, signature, secret);

    const event = JSON.parse(body.toString('utf8')) as {
      id?: string;
      type?: string;
      data?: { object?: Record<string, unknown> };
    };

    const eventId = event.id;
    if (!eventId) throw new SignatureError('Stripe event has no id');
    const type = event.type ?? 'unknown';
    const object = event.data?.object ?? {};

    if (type.startsWith('checkout.session.')) {
      const session = object as StripeSession;
      // The webhook body's session is not expanded, so refund state and the
      // final intent status come from a fresh read.
      const full = session.id ? await fetchSession(session.id) : session;
      return {
        eventId,
        type,
        reference: full.client_reference_id ?? session.client_reference_id ?? null,
        providerOrderId: full.id ?? null,
        providerPaymentId: intentIdOf(full),
        outcome: outcomeFromSession(full),
      };
    }

    if (type.startsWith('payment_intent.') || type.startsWith('charge.')) {
      const intentId =
        typeof object.id === 'string' && object.id.startsWith('pi_')
          ? object.id
          : typeof object.payment_intent === 'string'
            ? object.payment_intent
            : null;

      if (!intentId) return { eventId, type, outcome: null };

      const intent = await fetchIntent(intentId);
      return {
        eventId,
        type,
        providerPaymentId: intentId,
        outcome: outcomeFromIntent(intent),
      };
    }

    // Recorded but carries no verdict, so a redelivery stays a no-op.
    return { eventId, type, outcome: null };
  },

  async refundPayment({ providerPaymentId, amountMinor, reference }) {
    await gatewayFetch<{ id?: string; amount?: number }>({
      providerId: 'stripe',
      url: `${API}/refunds`,
      method: 'POST',
      // Stripe's documented idempotency: a replayed refund with the same key
      // returns the original refund instead of issuing a second one.
      headers: headers(`refund_${reference}`),
      body: form({ payment_intent: providerPaymentId, amount: amountMinor }),
    });

    const intent = await fetchIntent(providerPaymentId);
    const charge = chargeOf(intent);

    return {
      refundedMinor:
        typeof charge?.amount_refunded === 'number' ? charge.amount_refunded : amountMinor,
      raw: { amount_refunded: charge?.amount_refunded },
    };
  },
};

function headerValue(
  requestHeaders: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = requestHeaders[name] ?? requestHeaders[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Exported for the deterministic signature fixtures in scripts/verify.mjs. */
export const __stripeInternals = { verifyStripeSignature, mapIntentStatus };
