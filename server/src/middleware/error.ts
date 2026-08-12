import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { HttpError } from '../utils/http.js';
import { isProd } from '../config/env.js';

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

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'That value is already taken' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Not found' });
    }
  }

  console.error('[api] unhandled error', err);

  return res.status(500).json({
    message: 'Something went wrong on our side',
    ...(isProd ? {} : { debug: err instanceof Error ? err.message : String(err) }),
  });
}
