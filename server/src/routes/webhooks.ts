import { Router } from 'express';
import { webhookLimiter } from '../middleware/rateLimit.js';
import * as webhooks from '../controllers/webhookController.js';

/**
 * One route per provider, so a signature scheme is never guessed from the body
 * and a provider we do not use has no reachable endpoint at all.
 *
 *   POST /api/payments/webhooks/razorpay
 *   POST /api/payments/webhooks/phonepe
 *   POST /api/payments/webhooks/stripe
 *
 * Mounted in app.ts with a raw body parser, ahead of express.json and the
 * origin check. See controllers/webhookController.ts for why.
 */
const router = Router();

router.post('/razorpay', webhookLimiter, webhooks.razorpayWebhook);
router.post('/phonepe', webhookLimiter, webhooks.phonepeWebhook);
router.post('/stripe', webhookLimiter, webhooks.stripeWebhook);

export default router;
