import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { HttpError } from '../utils/http.js';

type Source = 'body' | 'query' | 'params';

/**
 * Validates and *replaces* the request segment with the parsed result, so
 * handlers always work with coerced, trusted values.
 */
export const validate =
  <S extends ZodTypeAny>(schema: S, source: Source = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return next(
        HttpError.badRequest(
          result.error.issues[0]?.message ?? 'Invalid request',
          result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        ),
      );
    }

    Object.defineProperty(req, source, { value: result.data, writable: true });
    next();
  };

export type Infer<S extends ZodTypeAny> = z.infer<S>;
