/**
 * Payments facade.
 *
 *   PaymentService  (services/payments/service.ts)
 *        ↓
 *   Provider registry  (services/payments/registry.ts)
 *        ├── Manual     — no credentials, reconciled off-platform
 *        ├── Razorpay   — REST + HMAC signature + webhook
 *        ├── PhonePe    — REST (v1 salt / v2 OAuth) + callback verification
 *        └── Stripe     — REST + Checkout Session + signed webhook
 *
 * Adding a gateway touches two files: the provider itself and one line in the
 * registry. Checkout, the order lifecycle, the admin panel and the webhook
 * plumbing are all provider-agnostic.
 */
export * from './payments/types.js';
export * from './payments/registry.js';
export * from './payments/service.js';
export { toMinor, fromMinor, minorUnitExponent } from './payments/money.js';
export {
  SETTLED_STATUSES,
  canTransition,
  nextStatuses,
  orderStatusAfterCapture,
  orderStatusAfterRefund,
  transitionError,
} from './payments/state.js';
