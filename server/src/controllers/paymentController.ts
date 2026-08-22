import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { asyncHandler, HttpError } from '../utils/http.js';
import { serialize } from '../utils/serialize.js';
import { PROVIDER_IDS } from '../services/payments/types.js';
import { paymentMethods } from '../services/payments/registry.js';
import { openPayment, verifyReturnLeg, type ApplyReason } from '../services/payments/service.js';

export const intentSchema = z.object({
  orderId: z.string().min(1),
  /** Optional: which of the enabled providers to use. */
  provider: z.enum(PROVIDER_IDS).optional(),
});

export const confirmSchema = z.object({
  orderId: z.string().min(1),
  /**
   * Whatever the gateway's return leg carried. Treated purely as evidence to
   * verify — never as an assertion of success, an amount or a status.
   */
  payload: z.unknown().optional(),
});

/**
 * The payment methods this deployment can actually take money with. Only
 * providers that are both enabled and fully configured appear, and only their
 * publishable metadata is included — no secret, salt or webhook secret is
 * reachable through this endpoint.
 */
export const listMethods = asyncHandler(async (_req, res) => {
  res.json(paymentMethods());
});

/** Opens a charge with the chosen provider. Does not change payment status. */
export const createIntent = asyncHandler(async (req, res) => {
  const { orderId, provider } = req.body as z.infer<typeof intentSchema>;

  await assertOwnership(orderId, req.auth?.sub);

  const result = await openPayment({ orderId, requestedProvider: provider ?? null });
  res.json(result);
});

/**
 * Return leg from the gateway. The provider verifies a signature it could not
 * have forged, or re-reads the payment from the gateway's API; the order only
 * becomes PAID if that verification says the money arrived for the right
 * amount. There is no path here that trusts the caller.
 */
export const confirmPayment = asyncHandler(async (req, res) => {
  const { orderId, payload } = req.body as z.infer<typeof confirmSchema>;

  await assertOwnership(orderId, req.auth?.sub);

  const result = await verifyReturnLeg({ orderId, payload });
  const order = await loadOrder(orderId);

  // A verification that did not settle is not an error the customer can fix, but
  // it must never read as success either.
  res.json(serialize({ order, payment: { status: result.status }, outcome: describe(result.reason) }));
});

/** Customer-facing wording for each outcome. Never leaks provider internals. */
function describe(reason: ApplyReason): string {
  switch (reason) {
    case 'applied':
      return 'confirmed';
    case 'duplicate':
    case 'raced':
    case 'no-change':
      return 'already-recorded';
    case 'amount-mismatch':
      return 'amount-mismatch';
    case 'blocked':
    case 'provider-mismatch':
      return 'not-permitted';
    default:
      return 'pending';
  }
}

/**
 * Guest orders are reachable by their unguessable id — that is the link in the
 * confirmation email. An order owned by an account requires that account, the
 * same rule GET /orders/:id applies.
 */
async function assertOwnership(orderId: string, callerId: string | undefined) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { userId: true },
  });
  if (!order) throw HttpError.notFound('Order not found');
  if (order.userId && order.userId !== callerId) {
    throw HttpError.forbidden('That order belongs to another account');
  }
}

const orderInclude = {
  items: true,
  address: true,
  payment: {
    select: {
      id: true,
      provider: true,
      status: true,
      amount: true,
      currency: true,
      reference: true,
      paidAt: true,
    },
  },
} as const;

const loadOrder = (orderId: string) =>
  prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
