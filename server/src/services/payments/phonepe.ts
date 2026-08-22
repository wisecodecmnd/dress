import { createHash, timingSafeEqual } from 'node:crypto';
import type { PaymentStatus } from '@prisma/client';
import { env, paymentMode } from '../../config/env.js';
import { gatewayFetch } from './http.js';
import {
  SignatureError,
  type PaymentOutcome,
  type PaymentProvider,
  type RawWebhook,
  type WebhookEvent,
} from './types.js';

/**
 * PhonePe.
 *
 * PhonePe runs two generations of its PG API and onboards each merchant onto
 * one of them, so neither the version, the base URL nor the credential *shape*
 * can be hard-coded. `PHONEPE_API_VERSION` selects the integration and both
 * base URLs are overridable:
 *
 *   v2 — PG Standard Checkout. OAuth client-credentials token, then
 *        `O-Bearer` on every call.
 *          POST {auth}/v1/oauth/token
 *          POST {base}/checkout/v2/pay
 *          GET  {base}/checkout/v2/order/{merchantOrderId}/status
 *          POST {base}/payments/v2/refund
 *        Callback authenticity: SHA-256 of `username:password` compared against
 *        the request's `Authorization` header.
 *
 *   v1 — Legacy salt-key PG. Base64 request envelope with an `X-VERIFY`
 *        checksum of `payload + path + saltKey`, suffixed `###saltIndex`.
 *          POST {base}/pg/v1/pay
 *          GET  {base}/pg/v1/status/{merchantId}/{merchantTransactionId}
 *          POST {base}/pg/v1/refund
 *        Callback authenticity: `X-VERIFY` = SHA-256 of `base64Response + saltKey`.
 *
 * Both are redirect flows: PhonePe never returns a success verdict to the
 * browser that we act on. The return leg triggers a server-side status read,
 * and the callback is verified before it is applied.
 */
const DEFAULT_BASE: Record<'v1' | 'v2', Record<'test' | 'live', string>> = {
  v1: {
    test: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
    live: 'https://api.phonepe.com/apis/hermes',
  },
  v2: {
    test: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
    live: 'https://api.phonepe.com/apis/pg',
  },
};

const DEFAULT_AUTH_BASE: Record<'test' | 'live', string> = {
  test: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
  live: 'https://api.phonepe.com/apis/identity-manager',
};

const version = () => env.PHONEPE_API_VERSION;
const baseUrl = () => (env.PHONEPE_BASE_URL ?? DEFAULT_BASE[version()][paymentMode]).replace(/\/$/, '');
const authBaseUrl = () =>
  (env.PHONEPE_AUTH_BASE_URL ?? DEFAULT_AUTH_BASE[paymentMode]).replace(/\/$/, '');

const sha256Hex = (input: string) => createHash('sha256').update(input, 'utf8').digest('hex');

function hexMatches(expectedHex: string, receivedHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const received = Buffer.from(receivedHex.trim().toLowerCase(), 'hex');
  if (expected.length === 0 || expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/** `X-VERIFY` for the v1 API: sha256(payload + path + salt) + '###' + index. */
const xVerify = (payload: string, path: string) =>
  `${sha256Hex(`${payload}${path}${env.PHONEPE_SALT_KEY}`)}###${env.PHONEPE_SALT_INDEX}`;

/** PhonePe transaction state → our payment status. Identical across versions. */
function mapState(state: string | undefined): PaymentStatus {
  switch ((state ?? '').toUpperCase()) {
    case 'COMPLETED':
    case 'PAYMENT_SUCCESS':
    case 'SUCCESS':
      return 'CAPTURED';
    case 'FAILED':
    case 'PAYMENT_ERROR':
    case 'PAYMENT_DECLINED':
    case 'TIMED_OUT':
    case 'PAYMENT_CANCELLED':
      return 'FAILED';
    // PENDING / PAYMENT_PENDING / anything unrecognised: not settled, so the
    // payment stays where it is rather than guessing.
    default:
      return 'PENDING';
  }
}

// ── v2: OAuth token, cached until shortly before it expires ─────────────────
let cachedToken: { value: string; expiresAtMs: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs > Date.now()) return cachedToken.value;

  const body = new URLSearchParams({
    client_id: env.PHONEPE_CLIENT_ID!,
    client_version: env.PHONEPE_CLIENT_VERSION ?? '1',
    client_secret: env.PHONEPE_CLIENT_SECRET!,
    grant_type: 'client_credentials',
  }).toString();

  const token = await gatewayFetch<{ access_token?: string; expires_at?: number }>({
    providerId: 'phonepe',
    url: `${authBaseUrl()}/v1/oauth/token`,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!token.access_token) throw new Error('PhonePe did not return an access token');

  // `expires_at` is epoch seconds. Renew a minute early so an in-flight call
  // never races the expiry.
  const expiresAtMs = token.expires_at
    ? token.expires_at * 1000 - 60_000
    : Date.now() + 4 * 60_000;

  cachedToken = { value: token.access_token, expiresAtMs };
  return token.access_token;
}

const v2Headers = async () => ({
  Authorization: `O-Bearer ${await accessToken()}`,
  'Content-Type': 'application/json',
});

interface V2PaymentDetail {
  transactionId?: string;
  state?: string;
  amount?: number;
  errorCode?: string;
  detailedErrorCode?: string;
}

interface V2Status {
  orderId?: string;
  state?: string;
  amount?: number;
  errorCode?: string;
  paymentDetails?: V2PaymentDetail[];
}

/** Picks the attempt that decided the order: a completed one, else the last. */
const decisiveDetail = (details: V2PaymentDetail[] | undefined): V2PaymentDetail | null => {
  if (!details || details.length === 0) return null;
  return (
    details.find((d) => (d.state ?? '').toUpperCase() === 'COMPLETED') ??
    details[details.length - 1] ??
    null
  );
};

function outcomeFromV2(status: V2Status): PaymentOutcome {
  const detail = decisiveDetail(status.paymentDetails);
  const mapped = mapState(status.state);

  return {
    status: mapped,
    providerOrderId: status.orderId ?? null,
    providerPaymentId: detail?.transactionId ?? null,
    amountMinor: typeof status.amount === 'number' ? status.amount : (detail?.amount ?? null),
    // PhonePe PG is INR-only; the amount is in paise.
    currency: 'INR',
    failureReason:
      mapped === 'FAILED'
        ? (detail?.detailedErrorCode ??
          detail?.errorCode ??
          status.errorCode ??
          'PhonePe reported a failed payment')
        : null,
    raw: {
      orderId: status.orderId,
      state: status.state,
      amount: status.amount,
      transactionId: detail?.transactionId,
      errorCode: detail?.errorCode ?? status.errorCode,
    },
  };
}

interface V1StatusData {
  merchantTransactionId?: string;
  transactionId?: string;
  amount?: number;
  state?: string;
  responseCode?: string;
}

function outcomeFromV1(response: { code?: string; message?: string; data?: V1StatusData }): PaymentOutcome {
  const data = response.data ?? {};
  const mapped = mapState(data.state ?? response.code);

  return {
    status: mapped,
    providerPaymentId: data.transactionId ?? null,
    amountMinor: typeof data.amount === 'number' ? data.amount : null,
    currency: 'INR',
    failureReason:
      mapped === 'FAILED'
        ? (data.responseCode ?? response.code ?? 'PhonePe reported a failed payment')
        : null,
    raw: {
      code: response.code,
      state: data.state,
      transactionId: data.transactionId,
      amount: data.amount,
      responseCode: data.responseCode,
    },
  };
}

async function readStatus(reference: string): Promise<PaymentOutcome> {
  if (version() === 'v2') {
    const status = await gatewayFetch<V2Status>({
      providerId: 'phonepe',
      url: `${baseUrl()}/checkout/v2/order/${encodeURIComponent(reference)}/status?details=true`,
      headers: await v2Headers(),
    });
    return outcomeFromV2(status);
  }

  const path = `/pg/v1/status/${env.PHONEPE_MERCHANT_ID}/${reference}`;
  const response = await gatewayFetch<{ code?: string; data?: V1StatusData }>({
    providerId: 'phonepe',
    url: `${baseUrl()}${path}`,
    headers: {
      'Content-Type': 'application/json',
      'X-VERIFY': xVerify('', path),
      'X-MERCHANT-ID': env.PHONEPE_MERCHANT_ID!,
    },
  });
  return outcomeFromV1(response);
}

/**
 * Idempotency key for a callback. PhonePe sends no event id, so one is derived
 * from what identifies the event: which order reached which state on which
 * transaction. A redelivery of the same verdict produces the same key.
 */
const eventKey = (reference: string, state: string, transactionId: string) =>
  sha256Hex(`${reference}|${state}|${transactionId}`);

// ── Callback verification ───────────────────────────────────────────────────
function verifyV2Callback({ body, headers }: RawWebhook): WebhookEvent {
  const username = env.PHONEPE_CALLBACK_USERNAME;
  const password = env.PHONEPE_CALLBACK_PASSWORD;
  if (!username || !password) {
    throw new SignatureError('PhonePe callback credentials are not configured');
  }

  const received = headerValue(headers, 'authorization');
  if (!received) throw new SignatureError('PhonePe callback Authorization header is missing');

  // PhonePe hashes the dashboard-configured username:password pair and sends
  // the digest as the Authorization header value.
  const expected = sha256Hex(`${username}:${password}`);
  if (!hexMatches(expected, received.replace(/^SHA256\s*/i, ''))) {
    throw new SignatureError('PhonePe callback credentials do not match');
  }

  const event = JSON.parse(body.toString('utf8')) as {
    event?: string;
    payload?: V2Status & { merchantOrderId?: string };
  };

  const payload = event.payload ?? {};
  const reference = payload.merchantOrderId ?? '';
  const detail = decisiveDetail(payload.paymentDetails);

  return {
    eventId: eventKey(reference, payload.state ?? '', detail?.transactionId ?? ''),
    type: event.event ?? 'checkout.order.status',
    reference: reference || null,
    providerOrderId: payload.orderId ?? null,
    providerPaymentId: detail?.transactionId ?? null,
    outcome: outcomeFromV2(payload),
  };
}

function verifyV1Callback({ body, headers }: RawWebhook): WebhookEvent {
  if (!env.PHONEPE_SALT_KEY || !env.PHONEPE_SALT_INDEX) {
    throw new SignatureError('PhonePe salt key/index are not configured');
  }

  const received = headerValue(headers, 'x-verify');
  if (!received) throw new SignatureError('PhonePe X-VERIFY header is missing');

  const envelope = JSON.parse(body.toString('utf8')) as { response?: string };
  const encoded = envelope.response;
  if (!encoded) throw new SignatureError('PhonePe callback has no response payload');

  // v1 signs the base64 envelope plus the salt — no path component.
  const expectedHash = sha256Hex(`${encoded}${env.PHONEPE_SALT_KEY}`);
  const [receivedHash] = received.split('###');
  if (!receivedHash || !hexMatches(expectedHash, receivedHash)) {
    throw new SignatureError('PhonePe X-VERIFY checksum does not match');
  }

  const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as {
    code?: string;
    data?: V1StatusData;
  };

  const reference = decoded.data?.merchantTransactionId ?? '';
  const outcome = outcomeFromV1(decoded);

  return {
    eventId: eventKey(reference, decoded.data?.state ?? decoded.code ?? '', decoded.data?.transactionId ?? ''),
    type: decoded.code ?? 'PAYMENT_STATUS',
    reference: reference || null,
    providerPaymentId: decoded.data?.transactionId ?? null,
    outcome,
  };
}

export const phonepeProvider: PaymentProvider = {
  id: 'phonepe',
  label: 'PhonePe',
  capabilities: { refunds: true, webhooks: true, statusFetch: true },

  configErrors() {
    const errors: string[] = [];

    if (version() === 'v2') {
      if (!env.PHONEPE_CLIENT_ID) errors.push('PHONEPE_CLIENT_ID is not set');
      if (!env.PHONEPE_CLIENT_SECRET) errors.push('PHONEPE_CLIENT_SECRET is not set');
      if (!env.PHONEPE_CLIENT_VERSION) {
        errors.push('PHONEPE_CLIENT_VERSION is not set (PhonePe issues this per environment)');
      }
      if (!env.PHONEPE_CALLBACK_USERNAME || !env.PHONEPE_CALLBACK_PASSWORD) {
        errors.push('PHONEPE_CALLBACK_USERNAME/PHONEPE_CALLBACK_PASSWORD are not set');
      }
    } else {
      if (!env.PHONEPE_MERCHANT_ID) errors.push('PHONEPE_MERCHANT_ID is not set');
      if (!env.PHONEPE_SALT_KEY) errors.push('PHONEPE_SALT_KEY is not set');
      if (!env.PHONEPE_SALT_INDEX) errors.push('PHONEPE_SALT_INDEX is not set');
    }

    // PhonePe issues separate sandbox and production credentials against
    // different hosts, so a live mode with no explicit base URL and only the
    // sandbox default would silently point production at the sandbox.
    if (paymentMode === 'live' && !env.PHONEPE_BASE_URL) {
      errors.push('PHONEPE_BASE_URL must be set explicitly in live mode');
    }
    return errors;
  },

  // Nothing PhonePe needs in the browser: it is a pure server-to-server
  // redirect flow.
  publicConfig: () => ({}),

  async createPayment({ reference, amountMinor, orderNumber, phone, returnUrl, webhookUrl }) {
    const redirect = new URL(returnUrl);
    redirect.searchParams.set('provider', 'phonepe');

    if (version() === 'v2') {
      const response = await gatewayFetch<{ orderId?: string; redirectUrl?: string }>({
        providerId: 'phonepe',
        url: `${baseUrl()}/checkout/v2/pay`,
        method: 'POST',
        headers: await v2Headers(),
        body: JSON.stringify({
          merchantOrderId: reference,
          // Server-computed paise. The browser never supplies an amount.
          amount: amountMinor,
          metaInfo: { udf1: orderNumber },
          paymentFlow: {
            type: 'PG_CHECKOUT',
            message: `DENIMQUE order ${orderNumber}`,
            merchantUrls: { redirectUrl: redirect.toString() },
          },
        }),
      });

      if (!response.redirectUrl) throw new Error('PhonePe did not return a redirect URL');

      return {
        handoff: 'redirect',
        providerOrderId: response.orderId ?? undefined,
        redirectUrl: response.redirectUrl,
        raw: { orderId: response.orderId },
      };
    }

    const payload = Buffer.from(
      JSON.stringify({
        merchantId: env.PHONEPE_MERCHANT_ID,
        merchantTransactionId: reference,
        merchantUserId: `order_${orderNumber}`,
        amount: amountMinor,
        redirectUrl: redirect.toString(),
        redirectMode: 'REDIRECT',
        callbackUrl: webhookUrl,
        ...(phone ? { mobileNumber: phone.replace(/\D/g, '').slice(-10) } : {}),
        paymentInstrument: { type: 'PAY_PAGE' },
      }),
    ).toString('base64');

    const response = await gatewayFetch<{
      data?: { instrumentResponse?: { redirectInfo?: { url?: string } } };
    }>({
      providerId: 'phonepe',
      url: `${baseUrl()}/pg/v1/pay`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': xVerify(payload, '/pg/v1/pay'),
      },
      body: JSON.stringify({ request: payload }),
    });

    const url = response.data?.instrumentResponse?.redirectInfo?.url;
    if (!url) throw new Error('PhonePe did not return a redirect URL');

    return { handoff: 'redirect', redirectUrl: url };
  },

  // A browser coming back from PhonePe carries no verdict we would trust, so
  // the return leg is a server-side status read against our own reference.
  verifyPayment: ({ reference }) => readStatus(reference),
  getPaymentStatus: ({ reference }) => readStatus(reference),

  parseWebhook: async (raw) =>
    version() === 'v2' ? verifyV2Callback(raw) : verifyV1Callback(raw),

  async refundPayment({ providerPaymentId, originalReference, amountMinor, reference }) {
    if (version() === 'v2') {
      await gatewayFetch<{ refundId?: string; state?: string }>({
        providerId: 'phonepe',
        url: `${baseUrl()}/payments/v2/refund`,
        method: 'POST',
        headers: await v2Headers(),
        body: JSON.stringify({
          // Our own unique refund id — PhonePe rejects a repeat of it, which is
          // the duplicate-refund guard on their side.
          merchantRefundId: reference,
          // v2 refunds address the original *merchant* order id, not PhonePe's
          // transaction id.
          originalMerchantOrderId: originalReference,
          amount: amountMinor,
        }),
      });
      return { refundedMinor: amountMinor };
    }

    const payload = Buffer.from(
      JSON.stringify({
        merchantId: env.PHONEPE_MERCHANT_ID,
        merchantUserId: `refund_${reference}`,
        originalTransactionId: providerPaymentId,
        merchantTransactionId: reference,
        amount: amountMinor,
      }),
    ).toString('base64');

    await gatewayFetch<{ success?: boolean }>({
      providerId: 'phonepe',
      url: `${baseUrl()}/pg/v1/refund`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': xVerify(payload, '/pg/v1/refund'),
      },
      body: JSON.stringify({ request: payload }),
    });

    return { refundedMinor: amountMinor };
  },
};

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Exported for the deterministic checksum fixtures in scripts/verify.mjs. */
export const __phonepeInternals = { sha256Hex, hexMatches, mapState, eventKey };
