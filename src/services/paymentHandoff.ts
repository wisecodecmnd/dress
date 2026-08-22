import type { PaymentIntent } from '../types';

/**
 * The browser side of the gateway handoff.
 *
 * Deliberately thin: this file gets the customer to the gateway and brings back
 * whatever the gateway hands over. It never decides that a payment succeeded —
 * the result is passed to POST /api/payments/confirm, and the server verifies
 * it against the provider before any order changes.
 */
export type HandoffResult =
  /** The gateway took a payment attempt; `payload` is its evidence to verify. */
  | { kind: 'submitted'; payload?: unknown }
  /** The browser is leaving for the gateway; nothing more happens here. */
  | { kind: 'redirecting' }
  /** Settled off-platform — the order is reserved and awaiting payment. */
  | { kind: 'offline' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

interface RazorpayInstance {
  open(): void;
  on(event: string, handler: (payload: unknown) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const RAZORPAY_SDK = 'https://checkout.razorpay.com/v1/checkout.js';

/** Loads a provider script once; concurrent callers share the same promise. */
const scripts = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const existing = scripts.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const element = document.createElement('script');
    element.src = src;
    element.async = true;
    element.onload = () => resolve();
    element.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever.
      scripts.delete(src);
      reject(new Error('The payment provider could not be loaded'));
    };
    document.head.appendChild(element);
  });

  scripts.set(src, promise);
  return promise;
}

/**
 * Opens Razorpay Checkout. Resolves with the `razorpay_*` fields, which include
 * a signature the server re-computes with its secret — so a tampered payload is
 * rejected server-side rather than trusted here.
 */
async function openRazorpay(
  intent: PaymentIntent,
  customer: { email: string; phone: string },
): Promise<HandoffResult> {
  await loadScript(RAZORPAY_SDK);
  if (!window.Razorpay) return { kind: 'failed', message: 'Razorpay could not be loaded' };

  const sdk = intent.sdk ?? {};

  return new Promise<HandoffResult>((resolve) => {
    let settled = false;
    const finish = (result: HandoffResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const checkout = new window.Razorpay!({
      key: String(sdk.keyId ?? ''),
      order_id: String(sdk.razorpayOrderId ?? ''),
      // Display only — the charge is bound to the server-created order id, so a
      // tampered value here cannot change what is charged.
      amount: sdk.amount,
      currency: sdk.currency ?? intent.currency,
      name: 'DENIMQUE',
      description: `Order payment · ${intent.currency} ${intent.amount}`,
      prefill: { email: customer.email, contact: customer.phone },
      handler: (payload: unknown) => finish({ kind: 'submitted', payload }),
      modal: { ondismiss: () => finish({ kind: 'cancelled' }) },
    });

    checkout.on('payment.failed', (payload: unknown) => {
      const description = (
        payload as { error?: { description?: string } } | undefined
      )?.error?.description;
      finish({ kind: 'failed', message: description ?? 'The payment was declined' });
    });

    checkout.open();
  });
}

/** Dispatches on the handoff the API asked for, not on the provider name. */
export async function handOffToProvider(
  intent: PaymentIntent,
  customer: { email: string; phone: string },
): Promise<HandoffResult> {
  if (intent.handoff === 'none') return { kind: 'offline' };

  if (intent.handoff === 'redirect') {
    if (!intent.redirectUrl) {
      return { kind: 'failed', message: 'The payment provider did not return a checkout link' };
    }
    window.location.assign(intent.redirectUrl);
    return { kind: 'redirecting' };
  }

  if (intent.provider === 'razorpay') return openRazorpay(intent, customer);

  return { kind: 'failed', message: 'This payment method is not supported in this browser' };
}
