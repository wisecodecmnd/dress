import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env, isProd } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../utils/http.js';

export const ACCESS_COOKIE = 'dq_token';

export interface AuthPayload {
  sub: string;
  email: string;
  role: 'CUSTOMER' | 'ADMIN';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export const signToken = (payload: AuthPayload) =>
  jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);

/**
 * httpOnly so the token is never readable from JS, SameSite=Lax by default to
 * blunt CSRF. `none` is only honoured alongside Secure, which the browser
 * requires anyway.
 */
const cookieOptions = () => ({
  httpOnly: true,
  secure: isProd || env.COOKIE_SAMESITE === 'none',
  sameSite: env.COOKIE_SAMESITE,
  domain: env.COOKIE_DOMAIN,
  path: '/',
});

export function setAuthCookie(res: Response, token: string) {
  res.cookie(ACCESS_COOKIE, token, {
    ...cookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

/** Clearing only works when the attributes match the cookie that was set. */
export function clearAuthCookie(res: Response) {
  res.clearCookie(ACCESS_COOKIE, cookieOptions());
}

function readToken(req: Request): string | null {
  const cookie = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
  if (cookie) return cookie;

  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);

  return null;
}

/** Attaches req.auth when a valid token is present; never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return next();

  try {
    req.auth = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
  } catch {
    // Expired or tampered token — treat the caller as a guest.
  }

  next();
}

/** Rejects the request unless a valid token is present. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return next(HttpError.unauthorized());

  try {
    req.auth = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
    next();
  } catch {
    next(HttpError.unauthorized('Your session has expired'));
  }
}

/**
 * Role check, then a database confirmation.
 *
 * The role in the token is a seven-day-old claim. Re-reading the user means a
 * demoted, suspended or deleted admin loses access on their next request rather
 * than when the token happens to expire.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.auth?.role !== 'ADMIN') return next(HttpError.forbidden());

  void prisma.user
    .findUnique({ where: { id: req.auth.sub }, select: { role: true, isActive: true } })
    .then((user) => {
      if (!user || user.role !== 'ADMIN') return next(HttpError.forbidden());
      if (!user.isActive) return next(HttpError.forbidden('This account has been suspended'));
      next();
    })
    .catch(next);
}
