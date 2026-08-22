import type { PaymentProvider } from './types.js';

/**
 * Bank transfer / cash on delivery. The order is reserved with a PENDING
 * payment and a human reconciles it off-platform.
 *
 * There is no self-confirming success path anywhere in this file: `verifyPayment`
 * reports the payment as still PENDING, so the storefront cannot advance it. The
 * only way a manual payment becomes CAPTURED is an authenticated admin acting
 * through PATCH /api/admin/orders/:id, which is audit-logged and still subject
 * to the state machine.
 */
export const manualProvider: PaymentProvider = {
  id: 'manual',
  label: 'Bank transfer / pay on delivery',
  capabilities: { refunds: true, webhooks: false, statusFetch: false },

  // Always available: it needs no credentials, which is exactly why it is the
  // fallback when no gateway is configured.
  configErrors: () => [],
  publicConfig: () => ({}),

  createPayment: async () => ({ handoff: 'none' }),

  verifyPayment: async () => ({
    status: 'PENDING',
    failureReason: null,
  }),

  getPaymentStatus: async () => ({ status: 'PENDING' }),

  parseWebhook: async () => {
    throw new Error('Manual payments have no webhook endpoint');
  },

  /**
   * Recording only. The money moves through the bank, not through us, so this
   * reports the refund the admin says they made and the amount is validated
   * against the payment by the caller.
   */
  refundPayment: async ({ amountMinor }) => ({ refundedMinor: amountMinor }),
};
