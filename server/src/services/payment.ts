import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';

/**
 * Payment provider boundary.
 *
 * Nothing in this file marks an order as paid. `createIntent` opens a charge
 * with the provider and `verify` checks a callback signature — the order status
 * is only advanced by the payments controller once `verify` returns true.
 *
 * To add Razorpay or Stripe: implement the interface, register it in
 * `providers`, and set PAYMENT_PROVIDER plus the keys. No other file changes.
 */
export interface PaymentIntent {
  provider: string;
  reference: string;
  amount: number;
  currency: string;
  /** Passed to the provider's browser SDK when one is involved. */
  clientSecret?: string;
}

export interface PaymentProvider {
  name: string;
  isConfigured(): boolean;
  createIntent(input: {
    orderId: string;
    orderNumber: string;
    amount: Prisma.Decimal;
    currency: string;
    email: string;
  }): Promise<PaymentIntent>;
  /** Confirms a provider callback is authentic before any status change. */
  verify(input: { reference: string; payload?: unknown }): Promise<boolean>;
}

/**
 * Bank transfer / cash on delivery. The order is reserved as PENDING and a
 * human marks it paid — there is no automatic success path.
 */
const manualProvider: PaymentProvider = {
  name: 'manual',
  isConfigured: () => true,

  createIntent: async ({ orderId, amount, currency }) => ({
    provider: 'manual',
    reference: `manual_${orderId}`,
    amount: Number(amount),
    currency,
  }),

  // Manual payments are reconciled off-platform, so nothing self-confirms.
  verify: async () => false,
};

const razorpayProvider: PaymentProvider = {
  name: 'razorpay',
  isConfigured: () => Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),

  createIntent: async () => {
    // Implementation: POST https://api.razorpay.com/v1/orders with basic auth,
    // return { reference: order.id, clientSecret: undefined }.
    throw new HttpError(
      501,
      'Razorpay is selected but not implemented. Add the order-creation call in services/payment.ts.',
    );
  },

  verify: async () => {
    // Implementation: HMAC-SHA256 of `${razorpay_order_id}|${razorpay_payment_id}`
    // with RAZORPAY_KEY_SECRET, compared against the received signature.
    throw new HttpError(501, 'Razorpay signature verification is not implemented yet.');
  },
};

const stripeProvider: PaymentProvider = {
  name: 'stripe',
  isConfigured: () => Boolean(env.STRIPE_SECRET_KEY),

  createIntent: async () => {
    throw new HttpError(
      501,
      'Stripe is selected but not implemented. Create a PaymentIntent in services/payment.ts.',
    );
  },

  verify: async () => {
    throw new HttpError(501, 'Stripe webhook verification is not implemented yet.');
  },
};

const providers: Record<string, PaymentProvider> = {
  manual: manualProvider,
  razorpay: razorpayProvider,
  stripe: stripeProvider,
};

export function getPaymentProvider(): PaymentProvider {
  const provider = providers[env.PAYMENT_PROVIDER];

  if (!provider) {
    throw new HttpError(500, `Unknown payment provider "${env.PAYMENT_PROVIDER}"`);
  }

  if (!provider.isConfigured()) {
    throw new HttpError(
      500,
      `Payment provider "${provider.name}" is missing its credentials. Check the server environment.`,
    );
  }

  return provider;
}
