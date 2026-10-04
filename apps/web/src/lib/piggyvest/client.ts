import 'server-only';
import z from 'zod';

/**
 * PiggyVest Business API base client (sandbox-gated, no live calls).
 *
 * Latest-docs patterns applied:
 * - Bearer token auth on every request.
 * - Envelope `{ status, message, data }`; `status: false` is a typed
 *   provider error, never an exception with a body attached.
 * - Amounts cross the boundary as integer kobo only.
 * - No request/response bodies, tokens, or signatures are ever logged.
 */

export const PIGGYVEST_API_BASE_URL = 'https://api.piggyvest.business';

const REQUEST_TIMEOUT_MS = 30_000;

export interface PiggyvestClientConfig {
  baseUrl?: string;
  token: string;
}

export class PiggyvestApiError extends Error {
  readonly code:
    | 'PIGGYVEST_AUTH_ERROR'
    | 'PIGGYVEST_REQUEST_ERROR'
    | 'PIGGYVEST_NETWORK_ERROR';
  readonly status: number | null;

  constructor(
    code: PiggyvestApiError['code'],
    message: string,
    status: number | null = null
  ) {
    super(message);
    this.name = 'PiggyvestApiError';
    this.code = code;
    this.status = status;
  }
}

const providerEnvelopeSchema = z.object({
  status: z.boolean(),
  message: z.string(),
});

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | undefined>
): string {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function piggyvestRequest<Data>(
  config: PiggyvestClientConfig,
  dataSchema: z.ZodType<Data>,
  path: string,
  options: {
    body?: Record<string, unknown>;
    method?: 'GET' | 'POST' | 'PATCH';
    query?: Record<string, string | undefined>;
  } = {}
): Promise<Data> {
  const token = config.token?.trim();
  if (!token) {
    throw new PiggyvestApiError(
      'PIGGYVEST_AUTH_ERROR',
      'PiggyVest API token is not configured'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      buildUrl(config.baseUrl ?? PIGGYVEST_API_BASE_URL, path, options.query),
      {
        body: options.body ? JSON.stringify(options.body) : undefined,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: options.method ?? (options.body ? 'POST' : 'GET'),
        signal: controller.signal,
      }
    );
  } catch (error) {
    throw new PiggyvestApiError(
      'PIGGYVEST_NETWORK_ERROR',
      error instanceof Error ? error.message : 'PiggyVest request failed'
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) {
    throw new PiggyvestApiError(
      'PIGGYVEST_AUTH_ERROR',
      'PiggyVest rejected the API credentials',
      response.status
    );
  }

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch (error) {
    // The abort timer stays armed through the body read: a provider that
    // stalls mid-body aborts into NETWORK_ERROR (which still triggers the
    // timed-out create reconciliation), not into a request-shape error.
    if (controller.signal.aborted) {
      throw new PiggyvestApiError(
        'PIGGYVEST_NETWORK_ERROR',
        error instanceof Error ? error.message : 'PiggyVest response timed out'
      );
    }
    throw new PiggyvestApiError(
      'PIGGYVEST_REQUEST_ERROR',
      'PiggyVest returned a non-JSON response',
      response.status
    );
  }

  const header = providerEnvelopeSchema.safeParse(envelope);
  if (!header.success || !header.data.status) {
    const message =
      header.success && typeof header.data.message === 'string'
        ? header.data.message
        : `PiggyVest request failed with status ${response.status}`;
    throw new PiggyvestApiError(
      'PIGGYVEST_REQUEST_ERROR',
      message,
      response.status
    );
  }

  const data = dataSchema.safeParse((envelope as Record<string, unknown>).data);
  if (!data.success) {
    throw new PiggyvestApiError(
      'PIGGYVEST_REQUEST_ERROR',
      'PiggyVest returned an unexpected response shape',
      response.status
    );
  }
  return data.data;
}
