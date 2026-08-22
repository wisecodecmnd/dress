import type { PaymentStatus } from '@prisma/client';

/**
 * The payment provider boundary.
 *
 * Nothing an implementation of this interface returns is trusted as-is. The
 * orchestrator in `apply.ts` re-checks the amount against the order, enforces
 * the payment state machine and claims an idempotency key before any row moves.
 * A provider's job is narrower than it looks: open a charge, and answer
 * "did this actually succeed?" in a way that cannot be forged by a browser.
 */
export const PROVIDER_IDS = ['manual', 'razorpay', 'phonepe', 'stripe'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** How the storefront hands off once a charge is open. */
export type HandoffKind =
  /** Nothing to do — settled off-platform, order stays awaiting payment. */
  | 'none'
  /** Send the browser to `redirectUrl`. */
  | 'redirect'
  /** Mount the provider's own JS checkout with `sdk`. */
  | 'sdk';

export interface CreatePaymentInput {
  orderId: string;
  orderNumber: string;
  /** Merchant-side transaction id we generate; unique per attempt. */
  reference: string;
  /** Authoritative amount in the currency's minor unit, computed server-side. */
  amountMinor: number;
  currency: string;
  email: string;
  phone: string | null;
  /** Where the provider should send the customer back to. */
  returnUrl: string;
  /** This provider's server-to-server callback endpoint on our API. */
  webhookUrl: string;
}

export interface CreatePaymentResult {
  handoff: HandoffKind;
  providerOrderId?: string;
  redirectUrl?: string;
  /**
   * Non-secret values the provider's browser SDK needs (publishable key,
   * gateway order id). Never a secret key, salt or webhook secret.
   */
  sdk?: Record<string, string | number>;
  raw?: unknown;
}

/**
 * A provider's verdict on one payment. `status` is the provider's reading; the
 * orchestrator decides whether the payment record is allowed to move there.
 */
export interface PaymentOutcome {
  status: PaymentStatus;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  /** Minor units, as reported by the provider. Compared against the order. */
  amountMinor?: number | null;
  currency?: string | null;
  /** Cumulative refunded amount in minor units, where the provider reports it. */
  refundedMinor?: number | null;
  failureReason?: string | null;
  /** Provider status object, stored for reconciliation. Never card data. */
  raw?: unknown;
}

export interface VerifyPaymentInput {
  reference: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  /** Whatever the return leg carried. Signature-bearing, or ignored entirely. */
  payload?: unknown;
}

export interface RawWebhook {
  /** Exact bytes as delivered; signatures are computed over these, not over a
      re-serialised object. */
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

export interface WebhookEvent {
  /** Stable across redeliveries of the same event — the idempotency key. */
  eventId: string;
  type: string;
  /** Whichever handles the payload carried; used to locate the payment. */
  reference?: string | null;
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
  /**
   * Null for events that carry no payment verdict (informational types). The
   * event is still recorded so a redelivery is a no-op.
   */
  outcome: PaymentOutcome | null;
}

export interface RefundInput {
  /** The gateway's handle for the original charge. */
  providerPaymentId: string;
  /** Our merchant reference for the original charge (PhonePe refunds by this). */
  originalReference: string;
  /** Minor units. */
  amountMinor: number;
  currency: string;
  /** Unique id for *this refund*, so a retry cannot double-refund. */
  reference: string;
}

export interface RefundResult {
  /** Cumulative refunded total in minor units where the provider reports it. */
  refundedMinor: number;
  providerRefundId?: string | null;
  raw?: unknown;
}

export interface PaymentProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly capabilities: {
    refunds: boolean;
    webhooks: boolean;
    /** True when a server-side status fetch is available (redirect return legs). */
    statusFetch: boolean;
  };

  /**
   * Human-readable reasons this provider cannot be used right now — missing
   * credentials, or keys whose shape contradicts PAYMENT_MODE. Empty means
   * ready. Never contains a secret value.
   */
  configErrors(): string[];

  /** Values safe to send to a browser. Publishable keys only. */
  publicConfig(): Record<string, string>;

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  /**
   * Verifies a return leg. Must either check a provider signature or fetch the
   * status from the provider's API — a caller-supplied "it succeeded" is never
   * sufficient.
   */
  verifyPayment(input: VerifyPaymentInput): Promise<PaymentOutcome>;

  /** Authenticates and parses a raw webhook. Throws when the signature fails. */
  parseWebhook(input: RawWebhook): Promise<WebhookEvent>;

  getPaymentStatus(input: VerifyPaymentInput): Promise<PaymentOutcome>;

  refundPayment(input: RefundInput): Promise<RefundResult>;
}

/** Thrown when a provider is asked to do something it is not set up for. */
export class ProviderUnavailableError extends Error {
  readonly status = 503;
  constructor(
    readonly providerId: string,
    readonly reasons: string[],
  ) {
    super(
      `Payment provider "${providerId}" is not available: ${reasons.join('; ')}`,
    );
    this.name = 'ProviderUnavailableError';
  }
}

/** Thrown when a webhook or return leg fails cryptographic verification. */
export class SignatureError extends Error {
  readonly status = 400;
  constructor(message = 'Payment signature verification failed') {
    super(message);
    this.name = 'SignatureError';
  }
}
