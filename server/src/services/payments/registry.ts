import { env, paymentMode } from '../../config/env.js';
import { manualProvider } from './manual.js';
import { razorpayProvider } from './razorpay.js';
import { phonepeProvider } from './phonepe.js';
import { stripeProvider } from './stripe.js';
import {
  PROVIDER_IDS,
  ProviderUnavailableError,
  type PaymentProvider,
  type ProviderId,
} from './types.js';

/**
 * The provider registry.
 *
 *   PaymentService → Registry → { Manual, Razorpay, PhonePe, Stripe }
 *
 * Adding a gateway means writing one file and adding one line here. Checkout,
 * the order lifecycle and the webhook plumbing are all provider-agnostic and
 * need no edit.
 *
 * Availability is derived from credentials, not asserted by configuration:
 *
 *  · PAYMENT_PROVIDER=auto (default) — every gateway whose credentials are
 *    present is offered. Manual is offered only when no gateway is, so it never
 *    silently sits alongside a live card option.
 *  · PAYMENT_PROVIDER=razorpay (or a comma list) — the allowlist. A gateway
 *    named here but missing credentials is *unavailable*, with its reasons
 *    reported; it never becomes a fake success and never crashes the process.
 */
const ALL: Record<ProviderId, PaymentProvider> = {
  manual: manualProvider,
  razorpay: razorpayProvider,
  phonepe: phonepeProvider,
  stripe: stripeProvider,
};

const GATEWAYS: ProviderId[] = ['razorpay', 'phonepe', 'stripe'];

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  /** Permitted by PAYMENT_PROVIDER. */
  selected: boolean;
  configured: boolean;
  /** selected && configured — the only combination checkout will use. */
  available: boolean;
  configErrors: string[];
  capabilities: PaymentProvider['capabilities'];
}

/** Which providers PAYMENT_PROVIDER permits, resolving `auto`. */
function selectedIds(): ProviderId[] {
  const configured = env.PAYMENT_PROVIDER;

  if (configured.includes('auto')) {
    const readyGateways = GATEWAYS.filter((id) => ALL[id].configErrors().length === 0);
    // Manual is the floor, not a peer: it only appears when nothing else can
    // take money.
    return readyGateways.length > 0 ? readyGateways : ['manual'];
  }

  // Explicit list. Order is preserved so the first entry is the storefront's
  // default selection.
  return PROVIDER_IDS.filter((id) => configured.includes(id)).sort(
    (a, b) => configured.indexOf(a) - configured.indexOf(b),
  );
}

/** Full picture of every provider, for admin and for the boot-time report. */
export function providerStatuses(): ProviderStatus[] {
  const selected = selectedIds();

  return PROVIDER_IDS.map((id) => {
    const provider = ALL[id];
    const configErrors = provider.configErrors();
    const isSelected = selected.includes(id);

    return {
      id,
      label: provider.label,
      selected: isSelected,
      configured: configErrors.length === 0,
      available: isSelected && configErrors.length === 0,
      configErrors,
      capabilities: provider.capabilities,
    };
  });
}

/** Providers checkout may actually offer, in preference order. */
export function availableProviders(): PaymentProvider[] {
  return providerStatuses()
    .filter((status) => status.available)
    .map((status) => ALL[status.id]);
}

/** Safe metadata for the storefront. Publishable keys only — never a secret. */
export function paymentMethods() {
  return {
    mode: paymentMode,
    methods: availableProviders().map((provider) => ({
      id: provider.id,
      label: provider.label,
      config: provider.publicConfig(),
    })),
  };
}

/** Looked up by id, without the availability check. Internal use only. */
export const providerById = (id: string): PaymentProvider | null =>
  (PROVIDER_IDS as readonly string[]).includes(id) ? ALL[id as ProviderId] : null;

/**
 * Resolves the provider a request may use. Throws ProviderUnavailableError —
 * which the error handler renders as a 503 with a clear message — rather than
 * ever falling back to something that would not really take the money.
 */
export function resolveProvider(requested?: string | null): PaymentProvider {
  const available = availableProviders();

  if (available.length === 0) {
    const reasons = providerStatuses()
      .filter((s) => s.selected)
      .flatMap((s) => s.configErrors);
    throw new ProviderUnavailableError(
      env.PAYMENT_PROVIDER.join(','),
      reasons.length > 0 ? reasons : ['no payment provider is configured'],
    );
  }

  if (!requested) return available[0]!;

  const match = available.find((provider) => provider.id === requested);
  if (match) return match;

  const known = providerById(requested);
  throw new ProviderUnavailableError(
    requested,
    known
      ? known.configErrors().length > 0
        ? known.configErrors()
        : [`${known.label} is not enabled by PAYMENT_PROVIDER`]
      : ['unknown payment provider'],
  );
}

/**
 * The provider that must handle an existing payment row: whatever opened it.
 * A row is never re-verified by a different gateway.
 */
export function providerForPayment(providerName: string): PaymentProvider {
  const provider = providerById(providerName);
  if (!provider) {
    throw new ProviderUnavailableError(providerName, ['this payment was opened by an unknown provider']);
  }
  const errors = provider.configErrors();
  if (errors.length > 0) throw new ProviderUnavailableError(providerName, errors);
  return provider;
}

/**
 * Boot-time report, on stdout only. Names the provider and the reason; never a
 * credential value. Loud, because "payments are quietly unavailable" is the
 * failure mode this whole design exists to make visible.
 */
export function reportPaymentConfiguration(): void {
  const statuses = providerStatuses();
  const available = statuses.filter((s) => s.available).map((s) => s.id);

  if (available.length > 0) {
    console.info(
      `[payments] mode=${paymentMode} available=${available.join(', ')}`,
    );
  } else {
    console.error('[payments] no payment provider is available — checkout will refuse to open a charge');
  }

  for (const status of statuses) {
    if (status.selected && !status.configured) {
      console.error(
        `[payments] ${status.id} is selected but unavailable: ${status.configErrors.join('; ')}`,
      );
    }
  }
}
