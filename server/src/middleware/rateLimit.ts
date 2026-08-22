import rateLimit from 'express-rate-limit';

const shared = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests — slow down and try again shortly' },
};

/** Broad ceiling for the whole API. */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  ...shared,
});

/** Credential endpoints: tight, to make brute force impractical. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  ...shared,
});

/** Unauthenticated writes that cost us something (email, order creation). */
export const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  ...shared,
});

/**
 * Provider webhooks. Generous, because a gateway legitimately bursts — one
 * order can produce several events, and a backlog is redelivered all at once.
 * Rate-limiting a real webhook only delays a payment being recorded, so the
 * ceiling is set to stop abuse rather than to shape traffic. Forged requests
 * are cheap to reject: the signature check runs before any database work.
 */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  ...shared,
});
