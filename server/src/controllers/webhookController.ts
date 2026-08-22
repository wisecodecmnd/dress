import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/http.js';
import { handleWebhook } from '../services/payments/service.js';
import { ProviderUnavailableError, SignatureError, type ProviderId } from '../services/payments/types.js';

/**
 * Provider webhook endpoints.
 *
 * These are mounted before the JSON parser and before the origin check, because
 * a signature is computed over the exact bytes delivered and a gateway cannot
 * send a browser CSRF token or an allowlisted Origin. Authenticity comes from
 * cryptography instead: every handler verifies the provider's signature before
 * a single field of the body is read. Nothing about the normal application's
 * CSRF posture changes.
 *
 * Status codes matter to the sender:
 *
 *   200 — verified and applied, or verified and already applied (a duplicate).
 *         Both mean "stop retrying".
 *   400 — the signature did not verify. Not retried, and deliberately terse:
 *         a forged request learns nothing from the response.
 *   503 — this provider is not configured here.
 *   500 — our fault. The provider *should* retry, and because the outcome is
 *         applied in one transaction with its idempotency claim, the retry is
 *         safe.
 */
function webhook(providerId: ProviderId) {
  return asyncHandler(async (req: Request, res: Response) => {
    // express.raw leaves the exact bytes here. A parsed-and-reserialised body
    // would not produce the same signature.
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');

    try {
      const result = await handleWebhook(providerId, { body, headers: req.headers });

      // Logged without the payload: a webhook body is reconciliation data, and
      // the signature header is a credential.
      console.info(
        `[payments] ${providerId} webhook ${result.eventType} → ${result.reason} (${result.status})`,
      );

      return res.status(200).json({ received: true, outcome: result.reason });
    } catch (error) {
      if (error instanceof SignatureError) {
        console.warn(`[payments] ${providerId} webhook rejected: ${error.message}`);
        return res.status(400).json({ received: false });
      }
      if (error instanceof ProviderUnavailableError) {
        console.warn(`[payments] ${providerId} webhook arrived but the provider is not configured`);
        return res.status(503).json({ received: false });
      }
      throw error;
    }
  });
}

export const razorpayWebhook = webhook('razorpay');
export const phonepeWebhook = webhook('phonepe');
export const stripeWebhook = webhook('stripe');
