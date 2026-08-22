import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { corsOrigins, isProd } from './config/env.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { verifyOrigin } from './middleware/csrf.js';
import { HttpError } from './utils/http.js';
import routes from './routes/index.js';
import webhookRoutes from './routes/webhooks.js';
import { reportPaymentConfiguration } from './services/payments/registry.js';

export function createApp() {
  // States on boot which gateways are actually usable, and why any selected one
  // is not. A misconfigured provider degrades to "payment unavailable" rather
  // than taking the API down — so this line is how it stays visible.
  reportPaymentConfiguration();

  const app = express();

  // Behind a proxy in production, so rate limiting and secure cookies see the
  // real client IP and protocol.
  if (isProd) app.set('trust proxy', 1);

  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin and server-to-server calls arrive without an Origin header.
        if (!origin || corsOrigins.includes(origin)) return callback(null, true);
        // A disallowed origin is a 403, not a 500 — a plain Error here would
        // fall through to the unhandled branch of the error handler.
        callback(HttpError.forbidden('Origin is not allowed'));
      },
      credentials: true,
    }),
  );

  app.use(morgan(isProd ? 'combined' : 'dev'));

  // Provider webhooks come first and deliberately bypass express.json and the
  // origin check: signatures are computed over the exact bytes delivered, and a
  // gateway can send neither a CSRF token nor an allowlisted Origin. Each
  // handler verifies the provider's signature before reading the body, so these
  // routes are authenticated cryptographically rather than by session — and the
  // CSRF posture of every *other* route is untouched.
  app.use(
    '/api/payments/webhooks',
    express.raw({ type: '*/*', limit: '256kb' }),
    webhookRoutes,
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  // Origin allowlisting for every state-changing request, not just admin ones.
  // Cookie auth means a customer's session is as forgeable as an admin's.
  app.use('/api', generalLimiter, verifyOrigin, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
