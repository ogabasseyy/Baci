import 'server-only';

import { isAbortError } from '@baci/shared/lib';
import { oxygenLoginResponseSchema } from '@/schemas/oxygen-login';

export type OxygenTransportErrorCode =
  | 'invalid_input'
  | 'auth_failed'
  | 'upstream_error'
  | 'invalid_response'
  | 'network_error'
  | 'timeout';

const ERROR_MESSAGES: Record<OxygenTransportErrorCode, string> = {
  invalid_input: 'Invalid Oxygen partner login input.',
  auth_failed: 'Oxygen partner authentication failed.',
  upstream_error: 'Oxygen partner login failed.',
  invalid_response: 'Invalid Oxygen partner login response.',
  network_error: 'Oxygen partner login network error.',
  timeout: 'Oxygen partner login timed out.',
};

// Carries `code` (+ `status` on non-2xx) only: no `cause`, no logging, and
// static messages, so `reference`, `secret`, `token`, and raw bodies can never
// leak via errors. Callers must resolve credentials server-side from trusted
// config/secret stores (never client input) and authorize before invoking.
export class OxygenTransportError extends Error {
  readonly code: OxygenTransportErrorCode;
  readonly status?: number;

  constructor(code: OxygenTransportErrorCode, status?: number) {
    super(ERROR_MESSAGES[code]);
    this.name = 'OxygenTransportError';
    this.code = code;
    this.status = status;
  }
}

export interface OxygenLoginDeps {
  fetchImpl: typeof fetch;
  // Single injected time source (default Date.now); composition must pass one
  // shared instance to both the transport and the cache.
  now?: () => number;
  timeoutMs?: number;
  signal?: AbortSignal | null;
}

export interface OxygenLoginInput {
  baseUrl: string;
  reference: string;
  secret: string;
}

export interface OxygenPartnerLoginResult {
  token: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const LOGIN_PATH = '/v1/partner/login';

// Shared `isAbortError` misses genuine DOMException aborts in realms where
// DOMException does not extend Error (observed under the jsdom test
// environment), so both shapes are accepted.
function isTimeoutAbort(error: unknown): boolean {
  if (isAbortError(error)) return true;
  return error instanceof DOMException && error.name === 'AbortError';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// Case-sensitive pre-parse check: `new URL` normalizes `HTTPS://` to `https:`,
// so a protocol comparison alone would wrongly accept uppercase schemes.
// Query/fragment/userinfo are rejected: concatenation would post credentials
// to the wrong path on the same host.
function buildLoginUrl(baseUrl: unknown): string | null {
  if (typeof baseUrl !== 'string') return null;
  if (baseUrl !== baseUrl.trim()) return null;
  if (!baseUrl.startsWith('https://')) return null;
  if (baseUrl.includes('?') || baseUrl.includes('#')) return null;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  // String concatenation only: leading-slash `new URL` resolution would drop
  // path-bearing bases.
  return `${baseUrl.replace(/\/+$/, '')}${LOGIN_PATH}`;
}

async function parseLoginBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === '') {
    throw new OxygenTransportError('invalid_response');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new OxygenTransportError('invalid_response');
  }
}

// Reads the body unless the request aborts first. The race (not the
// transport's own abort handling) guarantees the timeout, so injected
// transports whose `text()` ignores signals still time out. Rejects with a
// genuine AbortError DOMException that the caller maps to `timeout`.
function readBodyWithAbort(
  response: Response,
  requestSignal: AbortSignal
): Promise<unknown> {
  if (requestSignal.aborted) {
    return Promise.reject(
      new DOMException('Oxygen partner login body read aborted.', 'AbortError')
    );
  }
  return new Promise<unknown>((resolve, reject) => {
    const onAbort = () => {
      reject(
        new DOMException(
          'Oxygen partner login body read aborted.',
          'AbortError'
        )
      );
    };
    requestSignal.addEventListener('abort', onAbort, { once: true });
    parseLoginBody(response).then(
      (parsed) => {
        requestSignal.removeEventListener('abort', onAbort);
        resolve(parsed);
      },
      (error) => {
        requestSignal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

// Server-only partner login (`POST /v1/partner/login`). One attempt per call,
// no automatic retry. Login is non-financial, so re-attempting after a
// timeout/failure is permitted.
export async function loginOxygenPartner(
  deps: OxygenLoginDeps,
  input: OxygenLoginInput
): Promise<OxygenPartnerLoginResult> {
  // Validate the dependency seams before destructuring so misconfiguration
  // maps to `invalid_input` instead of escaping as a raw TypeError or a
  // misclassified `network_error`.
  if (
    typeof deps !== 'object' ||
    deps === null ||
    typeof deps.fetchImpl !== 'function' ||
    (deps.now !== undefined && typeof deps.now !== 'function') ||
    typeof input !== 'object' ||
    input === null
  ) {
    throw new OxygenTransportError('invalid_input');
  }
  const {
    fetchImpl,
    now = Date.now,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
  } = deps;
  // Node clamps unsupported timer delays to 1ms; reject configuration that
  // would silently change the request deadline.
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 2_147_483_647
  ) {
    throw new OxygenTransportError('invalid_input');
  }
  const url = buildLoginUrl(input.baseUrl);
  if (
    url === null ||
    !isNonEmptyString(input.reference) ||
    !isNonEmptyString(input.secret)
  ) {
    throw new OxygenTransportError('invalid_input');
  }

  // Anchor expiry at request start so RTT cannot extend apparent validity.
  const requestStartMs = now();

  const controller = new AbortController();
  // The timer stays alive through body parsing: headers that resolve promptly
  // must not buy an unbounded body read. Cleared once in the outer finally.
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  // One composed signal for fetch and body read, so external caller
  // cancellation also aborts a stalled body read (mapped to `timeout`).
  const requestSignal = signal
    ? AbortSignal.any([controller.signal, signal])
    : controller.signal;
  let parsed: unknown;
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reference: input.reference,
          secret: input.secret,
        }),
        cache: 'no-store',
        redirect: 'error',
        signal: requestSignal,
      });
    } catch (error) {
      if (isTimeoutAbort(error)) {
        throw new OxygenTransportError('timeout');
      }
      throw new OxygenTransportError('network_error');
    }

    if (response.status === 401 || response.status === 403) {
      throw new OxygenTransportError('auth_failed', response.status);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new OxygenTransportError('upstream_error', response.status);
    }

    // Non-2xx bodies are never read (they may echo credentials); 2xx bodies
    // are parsed defensively — empty/non-JSON is `invalid_response`, never a
    // throw. The read races the abort signal so injected transports whose
    // `text()` ignores signals still time out; an abort during the read is
    // `timeout`, preserving existing parse-error mapping.
    try {
      parsed = await readBodyWithAbort(response, requestSignal);
    } catch (error) {
      if (isTimeoutAbort(error)) {
        throw new OxygenTransportError('timeout');
      }
      if (error instanceof OxygenTransportError) throw error;
      throw new OxygenTransportError('invalid_response');
    }
  } finally {
    clearTimeout(timeout);
  }
  const validated = oxygenLoginResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new OxygenTransportError('invalid_response');
  }
  const expiresAtMs = requestStartMs + validated.data.expires_in * 1000;
  // Network/body latency can consume the whole returned lifetime. Never hand
  // an already-expired token to the first caller, even before cache storage.
  if (now() >= expiresAtMs) {
    throw new OxygenTransportError('invalid_response');
  }
  return {
    token: validated.data.token,
    issuedAtMs: requestStartMs,
    expiresAtMs,
  };
}
