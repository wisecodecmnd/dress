import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { HttpError } from '../utils/http.js';
import { isProd } from '../config/env.js';
import { GatewayError } from '../services/payments/http.js';
import { ProviderUnavailableError, SignatureError } from '../services/payments/types.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(HttpError.notFound(`No route for ${req.method} ${req.path}`));
}

/**
 * Single exit point for errors. Client messages stay generic for unexpected
 * failures; the full error is logged server-side only.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, details: err.details });
  }

  // ── Payments ──────────────────────────────────────────────────────────────
  // A provider that is selected but unconfigured is a 503 with an actionable
  // message, never a fake success and never a 500. The reasons name the missing
  // variable, never its value.
  if (err instanceof ProviderUnavailableError) {
    console.error(`[payments] unavailable: ${err.message}`);
    return res.status(503).json({
      message: 'Online payment is unavailable right now. No charge was made.',
      details: { provider: err.providerId },
    });
  }

  if (err instanceof SignatureError) {
    return res.status(400).json({ message: 'Payment could not be verified' });
  }

  // The gateway itself failed or timed out. Its own message is logged, not
  // returned — it can carry account detail.
  if (err instanceof GatewayError) {
    console.error(`[payments] gateway error (${err.providerId}/${err.httpStatus}): ${err.message}`);
    return res.status(502).json({
      message: 'The payment provider could not be reached. No charge was made.',
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'That value is already taken' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Not found' });
    }
    // Restrict/SetNull violations — something still references the row.
    if (err.code === 'P2003' || err.code === 'P2014') {
      return res
        .status(409)
        .json({ message: 'Other records still reference this one, so it cannot be changed' });
    }
  }

  // A malformed body that got past Zod, or a JSON parse failure from
  // express.json — a client problem, not a server fault worth a 500.
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ message: 'Request body is not valid JSON' });
  }

  console.error('[api] unhandled error', err);

  return res.status(500).json({
    message: 'Something went wrong on our side',
    ...(isProd ? {} : { debug: err instanceof Error ? err.message : String(err) }),
  });
}
