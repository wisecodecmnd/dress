import { prisma } from '../../config/prisma.js';
import { asyncHandler } from '../../utils/http.js';
import { serialize } from '../../utils/serialize.js';
import { env, paymentMode, paymentReturnOrigin } from '../../config/env.js';
import { providerStatuses } from '../../services/payments/registry.js';
import { nextStatuses } from '../../services/payments/state.js';

/**
 * Read-only payment configuration for admin.
 *
 * Secrets are configured server-side through the environment and are never
 * writable or readable here. What this returns is the *shape* of the
 * configuration — which providers are enabled, which are ready, and the name of
 * anything still missing. Never a key, salt, secret or webhook secret value.
 */
export const getPaymentConfig = asyncHandler(async (_req, res) => {
  const statuses = providerStatuses();

  const [byStatus, recentEvents] = await Promise.all([
    prisma.payment.groupBy({
      by: ['status', 'provider'],
      _count: { _all: true },
      _sum: { amount: true, refundedAmount: true },
    }),
    prisma.paymentEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        provider: true,
        type: true,
        result: true,
        detail: true,
        createdAt: true,
        payment: { select: { order: { select: { id: true, number: true } } } },
      },
    }),
  ]);

  res.json(
    serialize({
      // `env.PAYMENT_PROVIDER` is a list of provider *names* — configuration,
      // not credentials.
      selection: env.PAYMENT_PROVIDER,
      mode: paymentMode,
      returnOrigin: paymentReturnOrigin,
      providers: statuses.map((status) => ({
        ...status,
        webhookUrl: status.capabilities.webhooks
          ? new URL(`/api/payments/webhooks/${status.id}`, paymentReturnOrigin).toString()
          : null,
      })),
      // Lets admin see which manual transitions are legal before trying one.
      transitions: {
        PENDING: nextStatuses('PENDING'),
        AUTHORIZED: nextStatuses('AUTHORIZED'),
        CAPTURED: nextStatuses('CAPTURED'),
        FAILED: nextStatuses('FAILED'),
        PARTIALLY_REFUNDED: nextStatuses('PARTIALLY_REFUNDED'),
        REFUNDED: nextStatuses('REFUNDED'),
      },
      totals: byStatus.map((row) => ({
        status: row.status,
        provider: row.provider,
        count: row._count._all,
        amount: row._sum.amount,
        refunded: row._sum.refundedAmount,
      })),
      recentEvents: recentEvents.map((event) => ({
        id: event.id,
        provider: event.provider,
        type: event.type,
        result: event.result,
        detail: event.detail,
        createdAt: event.createdAt,
        orderId: event.payment?.order.id ?? null,
        orderNumber: event.payment?.order.number ?? null,
      })),
    }),
  );
});
