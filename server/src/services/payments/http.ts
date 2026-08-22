/**
 * Shared HTTP helper for gateway calls. No SDKs are pulled in: every provider
 * here talks to its documented REST API over `fetch`, which keeps the
 * dependency surface (and the supply-chain surface) of a payment path as small
 * as it can be.
 *
 * Every call is time-boxed. A gateway that hangs must surface as "payment
 * unavailable" rather than holding an Express worker until the client gives up.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

export class GatewayError extends Error {
  readonly status = 502;
  constructor(
    readonly providerId: string,
    readonly httpStatus: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export interface GatewayRequest {
  providerId: string;
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/**
 * Performs the call and parses JSON. Non-2xx becomes a GatewayError carrying
 * the provider's own message — which is logged, not returned to the customer.
 */
export async function gatewayFetch<T>(request: GatewayRequest): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method ?? 'GET',
      headers: { Accept: 'application/json', ...request.headers },
      body: request.body,
      signal: controller.signal,
    });
  } catch (cause) {
    const reason = controller.signal.aborted ? 'timed out' : 'could not be reached';
    throw new GatewayError(request.providerId, 504, `${request.providerId} ${reason}`, cause);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }

  if (!response.ok) {
    throw new GatewayError(
      request.providerId,
      response.status,
      `${request.providerId} returned ${response.status}: ${describe(parsed) ?? text.slice(0, 300)}`,
      parsed,
    );
  }

  return parsed as T;
}

/** Pulls the message out of the shapes the three gateways use for errors. */
function describe(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;

  // Razorpay: { error: { code, description } } — Stripe: { error: { message } }
  const error = record.error;
  if (error && typeof error === 'object') {
    const inner = error as Record<string, unknown>;
    const message = inner.description ?? inner.message ?? inner.reason;
    if (typeof message === 'string') return message;
  }
  // PhonePe: { code, message }
  if (typeof record.message === 'string') return record.message;
  if (typeof record.code === 'string') return record.code;
  return null;
}
