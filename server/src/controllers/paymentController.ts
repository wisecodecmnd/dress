import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { asyncHandler, HttpError } from '../utils/http.js';
import { serialize } from '../utils/serialize.js';
import { getPaymentProvider } from '../services/payment.js';

export const intentSchema = z.object({ orderId: z.string().min(1) });

export const confirmSchema = z.object({
  orderId: z.string().min(1),
  reference: z.string().min(1),
  payload: z.unknown().optional(),
});

/** Opens a charge with the configured provider. Does not change order status. */
export const createIntent = asyncHandler(async (req, res) => {
  const { orderId } = req.body as z.infer<typeof intentSchema>;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, number: true, total: true, currency: true, email: true, status: true, userId: true },
  });

  if (!order) throw HttpError.notFound('Order not found');
  if (order.userId && order.userId !== req.auth?.sub) throw HttpError.forbidden();
  if (order.status !== 'PENDING') throw HttpError.badRequest('This order is already settled');

  const provider = getPaymentProvider();

  const intent = await provider.createIntent({
    orderId: order.id,
    orderNumber: order.number,
    amount: order.total,
    currency: order.currency,
    email: order.email,
  });

  await prisma.payment.update({
    where: { orderId: order.id },
    data: { provider: provider.name, reference: intent.reference, status: 'PENDING' },
  });

  res.json({
    provider: provider.name,
    orderId: order.id,
    amount: intent.amount,
    currency: intent.currency,
    clientSecret: intent.clientSecret,
  });
});

/**
 * Provider callback. The order only becomes PAID if the provider's own
 * verification succeeds — there is no path here that trusts the caller.
 */
export const confirmPayment = asyncHandler(async (req, res) => {
  const { orderId, reference, payload } = req.body as z.infer<typeof confirmSchema>;

  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true },
  });
  if (!existing) throw HttpError.notFound('Order not found');

  const provider = getPaymentProvider();
  const verified = await provider.verify({ reference, payload });

  if (!verified) {
    await prisma.payment.update({
      where: { orderId },
      data: { status: 'FAILED', reference, rawPayload: payload as never },
    });
    throw HttpError.badRequest('Payment could not be verified');
  }

  const order = await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { orderId },
      data: {
        status: 'CAPTURED',
        reference,
        provider: provider.name,
        rawPayload: payload as never,
      },
    });

    return tx.order.update({
      where: { id: orderId },
      data: { status: 'PAID' },
      include: {
        items: true,
        address: true,
        payment: {
          select: { id: true, provider: true, status: true, amount: true, reference: true },
        },
      },
    });
  });

  res.json(serialize({ order }));
});
