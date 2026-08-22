import type { NextFunction, Request, Response } from 'express';
import { corsOrigins } from '../config/env.js';
import { HttpError } from '../utils/http.js';

/**
 * Defence in depth against CSRF on cookie-authenticated admin mutations.
 *
 * The session cookie is already SameSite=Lax, which blocks cross-site form
 * posts, and every admin endpoint requires a JSON content type (so a browser
 * must preflight, which CORS then refuses). This adds an explicit origin check
 * on top: a state-changing admin request must either carry no Origin/Referer
 * (server-to-server) or one that is on the allowlist.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function verifyOrigin(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // Non-browser callers (curl, CI, health probes) send neither header.
  if (!origin && !referer) return next();

  const candidate = origin ?? safeOrigin(referer);
  if (candidate && corsOrigins.includes(candidate)) return next();

  next(HttpError.forbidden('Request origin is not allowed'));
}

function safeOrigin(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
