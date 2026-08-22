import 'dotenv/config';
import { z } from 'zod';

/**
 * Fail fast on boot rather than at the first request. Secrets live only here —
 * nothing in this object is ever sent to the client.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_DOMAIN: z.string().optional(),
  /**
   * `lax` is right when the API and the storefront share a registrable domain
   * (denimque.com + api.denimque.com). Only a genuinely cross-site deployment
   * needs `none`, and that requires HTTPS.
   */
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  /** IANA zone every server-side "today"/day-boundary calculation uses. */
  BUSINESS_TIMEZONE: z.string().trim().min(1).max(64).default('Asia/Kolkata'),

  // ── Payments ──────────────────────────────────────────────────────────────
  /**
   * Which gateways may be offered. `auto` (the default) enables every provider
   * whose credentials are actually present, and falls back to `manual` when
   * none are. Naming providers explicitly (`razorpay`, or `razorpay,stripe`)
   * restricts the list to those — a named provider that is missing credentials
   * is reported as unavailable rather than crashing the process.
   */
  PAYMENT_PROVIDER: z
    .string()
    .trim()
    .toLowerCase()
    .default('auto')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .refine((list) => list.length > 0, 'PAYMENT_PROVIDER cannot be empty')
    .refine(
      (list) => list.every((p) => ['auto', 'manual', 'razorpay', 'phonepe', 'stripe'].includes(p)),
      'PAYMENT_PROVIDER may only name auto, manual, razorpay, phonepe or stripe',
    ),
  /**
   * Guards against pointing sandbox keys at real customers, and vice versa.
   * Defaults to `live` in production and `test` everywhere else; a provider
   * whose key shape disagrees with this is treated as misconfigured.
   */
  PAYMENT_MODE: z.enum(['test', 'live']).optional(),
  /** Origin the gateway sends the customer back to. Defaults to CORS_ORIGIN[0]. */
  PAYMENT_RETURN_ORIGIN: z.string().trim().url().optional(),

  RAZORPAY_KEY_ID: z.string().trim().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().trim().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().trim().min(1).optional(),

  /**
   * `v2` = PG Standard Checkout (OAuth client credentials + O-Bearer).
   * `v1` = the older salt-key/X-VERIFY PG API. Both are configurable rather
   * than hard-coded because merchants are onboarded onto one or the other.
   */
  PHONEPE_API_VERSION: z.enum(['v1', 'v2']).default('v2'),
  PHONEPE_BASE_URL: z.string().trim().url().optional(),
  PHONEPE_AUTH_BASE_URL: z.string().trim().url().optional(),
  PHONEPE_MERCHANT_ID: z.string().trim().min(1).optional(),
  PHONEPE_CLIENT_ID: z.string().trim().min(1).optional(),
  PHONEPE_CLIENT_SECRET: z.string().trim().min(1).optional(),
  PHONEPE_CLIENT_VERSION: z.string().trim().min(1).optional(),
  PHONEPE_SALT_KEY: z.string().trim().min(1).optional(),
  PHONEPE_SALT_INDEX: z.string().trim().min(1).optional(),
  /** `username:password` pair PhonePe hashes into the callback Authorization header. */
  PHONEPE_CALLBACK_USERNAME: z.string().trim().min(1).optional(),
  PHONEPE_CALLBACK_PASSWORD: z.string().trim().min(1).optional(),

  STRIPE_SECRET_KEY: z.string().trim().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().trim().min(1).optional(),
  /** Safe to expose; the storefront needs it to mount Stripe's own UI. */
  STRIPE_PUBLISHABLE_KEY: z.string().trim().min(1).optional(),

  // Email
  EMAIL_PROVIDER: z.enum(['log', 'resend', 'smtp']).default('log'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('DENIMQUE <hello@denimque.com>'),
  CONTACT_INBOX: z.string().default('hello@denimque.com'),
});

/** The literal placeholder shipped in .env.example — never a real secret. */
const PLACEHOLDER_SECRET = 'replace-me-with-a-long-random-string-at-least-32-chars';

/**
 * Extra rules that only bite in production. Development keeps its convenient
 * defaults; a production boot has to be configured explicitly.
 */
const productionRules = schema.superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return;

  const fail = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  if (value.JWT_SECRET === PLACEHOLDER_SECRET) {
    fail('JWT_SECRET', 'JWT_SECRET is still the .env.example placeholder');
  }
  if (!process.env.CORS_ORIGIN) {
    fail('CORS_ORIGIN', 'CORS_ORIGIN must list the production storefront origin(s)');
  }
  if (value.COOKIE_SAMESITE === 'none' && !process.env.COOKIE_DOMAIN) {
    // SameSite=None cookies are only accepted over HTTPS, and a cross-site
    // deployment needs the domain pinned or the cookie won't be sent back.
    fail('COOKIE_DOMAIN', 'COOKIE_SAMESITE=none also requires COOKIE_DOMAIN');
  }
  // Gateway credentials are deliberately *not* checked here. A provider that
  // is selected but unconfigured must degrade to "payment unavailable" (see
  // services/payments/registry.ts), never take the whole API down — otherwise
  // rotating a key out turns into an outage of the storefront as a whole.
  if (value.EMAIL_PROVIDER === 'resend' && !value.RESEND_API_KEY) {
    fail('RESEND_API_KEY', 'EMAIL_PROVIDER=resend requires RESEND_API_KEY');
  }
});

const parsed = productionRules.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === 'production';

/** Origins allowed to send credentialed requests. */
export const corsOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

/**
 * Explicit test/live switch for every gateway. Production defaults to `live`
 * and everything else to `test`, so neither direction happens by accident.
 */
export const paymentMode: 'test' | 'live' = env.PAYMENT_MODE ?? (isProd ? 'live' : 'test');

/** Where a redirect-based gateway sends the customer back to. */
export const paymentReturnOrigin =
  env.PAYMENT_RETURN_ORIGIN ?? corsOrigins[0] ?? 'http://localhost:5173';
