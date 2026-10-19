/**
 * ZeptoMail REST transport
 *
 * POSTs to the ZeptoMail v1.1 API with the platform `fetch` (undici).
 * Replaces the `zeptomail` SDK: its node-fetch@2 transport parses request
 * URLs with the legacy `url.parse()`, which Node flags with a DEP0169
 * DeprecationWarning on every email-sending serverless invocation once the
 * dependency is bundled for deployment (bundled code loses the
 * inside-node_modules warning suppression that hides it in local dev).
 *
 * Error contract, kept compatible with the SDK the callers were written for:
 * - non-2xx with a JSON body rejects with the parsed body
 *   (`{ error: { code, message, details } }` — ZeptoMail's error shape)
 * - network / timeout / non-JSON failures reject with an `Error`
 */

const ZEPTOMAIL_API_BASE_URL = 'https://api.zeptomail.com/v1.1/';

// A send is never retried on timeout — the request may already have been
// accepted server-side, and retrying would risk duplicate customer email —
// so the window can be generous enough for invoice-attachment uploads.
const ZEPTOMAIL_REQUEST_TIMEOUT_MS = 30_000;

export const ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN_CODE =
  'ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN';

class ZeptoMailDeliveryOutcomeUnknownError extends Error {
  readonly code = ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN_CODE;
}

const DEFINITE_PRE_SEND_NETWORK_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function getNetworkErrorCode(error: unknown): string | undefined {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return undefined;
}

export type ZeptoMailEndpoint =
  | 'email'
  | 'email/template'
  | 'email/template/batch';

export interface ZeptoMailApiResponse {
  request_id?: string;
  message?: string;
  data?: unknown;
}

export async function zeptoMailRequest(
  endpoint: ZeptoMailEndpoint,
  payload: Record<string, unknown>,
  token: string,
  signal?: AbortSignal
): Promise<ZeptoMailApiResponse> {
  let response: Response;
  try {
    response = await fetch(`${ZEPTOMAIL_API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        // ZEPTOMAIL_TOKEN already carries the full "Zoho-enczapikey …" value.
        Authorization: token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: signal
        ? AbortSignal.any([
            signal,
            AbortSignal.timeout(ZEPTOMAIL_REQUEST_TIMEOUT_MS),
          ])
        : AbortSignal.timeout(ZEPTOMAIL_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw describeTransportFailure(error);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    // Only ZeptoMail's documented error shape passes through as-is (callers
    // read error.code for retry decisions). Anything else becomes a
    // descriptive Error so the audit trail never records "[object Object]".
    if (isZeptoMailErrorBody(body)) {
      throw body;
    }
    const bodySnippet =
      body === null ? '' : `: ${JSON.stringify(body).slice(0, 200)}`;
    throw new Error(
      `ZeptoMail request failed with HTTP ${response.status}${bodySnippet}`
    );
  }

  return (body ?? {}) as ZeptoMailApiResponse;
}

function isZeptoMailErrorBody(body: unknown): boolean {
  return (
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'error' in body
  );
}

function describeTransportFailure(error: unknown): Error {
  // AbortSignal.timeout() rejects with a DOMException named TimeoutError
  // whose generic message would hide what actually happened.
  if (
    error !== null &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name?: unknown }).name === 'TimeoutError'
  ) {
    return new ZeptoMailDeliveryOutcomeUnknownError(
      `ZeptoMail request timed out after ${ZEPTOMAIL_REQUEST_TIMEOUT_MS}ms`
    );
  }
  if (error instanceof Error) {
    // undici wraps the underlying socket/DNS failure in `cause`; merge it so
    // audit rows record more than a bare "fetch failed".
    const cause = error.cause;
    if (cause instanceof Error && cause.message) {
      if (
        DEFINITE_PRE_SEND_NETWORK_CODES.has(getNetworkErrorCode(cause) ?? '')
      ) {
        return new Error(`${error.message}: ${cause.message}`);
      }
      return new ZeptoMailDeliveryOutcomeUnknownError(
        `${error.message}: ${cause.message}`
      );
    }
    return new ZeptoMailDeliveryOutcomeUnknownError(error.message);
  }
  return new ZeptoMailDeliveryOutcomeUnknownError(String(error));
}
