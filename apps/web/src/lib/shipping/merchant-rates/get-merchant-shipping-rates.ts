import { parseStorefrontShippingRatesPayload } from '@/schemas/merchant-shipping-rates';
import type { StorefrontShippingRatesPayload } from './types';

const STOREFRONT_SHIPPING_RATES_RPC = 'get_storefront_shipping_rates';
const MAX_RPC_ATTEMPTS = 2;

const RETRYABLE_RPC_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_SOCKET',
  'PGRST000',
  'PGRST001',
  'PGRST002',
  'PGRST003',
]);

const RETRYABLE_RPC_ERROR_PATTERN =
  /(?:fetch failed|network error|service unavailable|bad gateway|gateway timeout|socket(?:error| hang up)?|other side closed|eai_again|econnreset|etimedout|epipe|und_err_socket|timeout(?:error)?|timed out)/i;
const JWT_RPC_ERROR_PATTERN = /\bPGRST301\b/i;

/**
 * Thrown by {@link getMerchantShippingRatesOrThrow} when the storefront RPC
 * itself fails (RPC / DB / schema-cache error). The order-verification path
 * uses this to tell a transient LOAD FAILURE apart from a genuinely-empty rate
 * set: a failure must surface as a 500 server error, never as a
 * customer-correctable 400 invalid-rate. The quote path keeps using the
 * fail-soft {@link getMerchantShippingRates}.
 */
export class MerchantShippingRatesLoadError extends Error {
  /** The Postgres / PostgREST error code, when the RPC error carried one. */
  readonly code?: string;

  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = 'MerchantShippingRatesLoadError';
    this.code = options?.code;
  }
}

function extractErrorCodes(error: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 3; depth += 1) {
    if (typeof current !== 'object') break;
    const record = current as Record<string, unknown>;
    if (typeof record.code === 'string') codes.push(record.code);
    current = record.cause;
  }
  return codes;
}

function extractErrorCode(error: unknown): string | undefined {
  return extractErrorCodes(error)[0];
}

function extractErrorText(error: unknown): string {
  const values: string[] = [];
  let current: unknown = error;

  // Fetch failures in Node commonly put UND_ERR_SOCKET on `cause`, while
  // Supabase/PostgREST failures expose their code/message on the result. Keep
  // this bounded so a malformed error cannot recurse through a cause cycle.
  for (let depth = 0; current && depth < 3; depth += 1) {
    if (typeof current === 'string') {
      values.push(current);
      break;
    }
    if (typeof current !== 'object') break;

    const record = current as Record<string, unknown>;
    for (const key of ['name', 'message', 'code', 'details', 'hint']) {
      const value = record[key];
      if (typeof value === 'string') values.push(value);
    }
    current = record.cause;
  }

  return values.join(' ');
}

function isRetryableRpcError(error: unknown): boolean {
  const codes = extractErrorCodes(error).map((code) =>
    code.trim().toUpperCase()
  );
  const errorText = extractErrorText(error);
  // A JWT failure is deterministic even when a wrapper gives it a generic
  // transport-looking message or transient outer code. PostgREST's client
  // can flatten a fetch rejection into an empty code with PGRST301 in details,
  // so inspect the normalized text before considering transport retries.
  if (codes.includes('PGRST301') || JWT_RPC_ERROR_PATTERN.test(errorText)) {
    return false;
  }
  const code = codes[0];
  return Boolean(
    (code && RETRYABLE_RPC_ERROR_CODES.has(code)) ||
      RETRYABLE_RPC_ERROR_PATTERN.test(errorText)
  );
}

export type MerchantShippingRatesRpcResult = {
  data: unknown;
  error: unknown;
};

export interface MerchantShippingRatesRpcClient {
  rpc(
    functionName: string,
    args: { p_merchant_id: string }
  ): PromiseLike<MerchantShippingRatesRpcResult>;
}

/**
 * Run the read-only storefront RPC with one bounded transport retry.
 *
 * Supabase's PostgREST builder returns network failures as `{ data: null,
 * error }` in most cases, but a custom fetch/runtime can reject the awaitable
 * directly. Handle both forms while never retrying auth or data-validation
 * errors. PostgREST connection/schema-cache codes are included because they
 * represent transient availability failures, not a malformed rate payload.
 * The RPC only reads merchant configuration, so a single replay is safe and
 * prevents a transient undici socket close from becoming a misleading
 * empty-rate result.
 */
async function loadMerchantShippingRatesRpc(
  supabase: MerchantShippingRatesRpcClient,
  merchantId: string
): Promise<MerchantShippingRatesRpcResult> {
  let lastResult: MerchantShippingRatesRpcResult | undefined;

  for (let attempt = 0; attempt < MAX_RPC_ATTEMPTS; attempt += 1) {
    try {
      const result = await supabase.rpc(STOREFRONT_SHIPPING_RATES_RPC, {
        p_merchant_id: merchantId,
      });
      lastResult = { data: result.data, error: result.error };

      if (!result.error || !isRetryableRpcError(result.error)) {
        return lastResult;
      }
      // Retry only the first transient result. A second failure is returned to
      // the caller so existing fail-soft/fail-loud boundaries stay intact.
    } catch (error) {
      if (attempt === MAX_RPC_ATTEMPTS - 1) {
        // A retry was already authorized by the preceding attempt. Return the
        // terminal rejection as an RPC error result so each public boundary
        // can preserve its documented fail-soft or fail-loud behavior.
        return { data: null, error };
      }
      if (!isRetryableRpcError(error)) {
        // A direct rejection that is not retryable is already terminal. Keep
        // it inside the RPC result boundary so fail-soft callers can return an
        // empty payload and fail-loud callers can wrap it consistently.
        return { data: null, error };
      }
      // Retry the same read-only RPC once when the awaitable itself rejects.
    }
  }

  return lastResult ?? { data: null, error: null };
}

/**
 * Load a merchant's active shipping zones/locations/rates through the
 * SECURITY DEFINER storefront RPC (the only anon-safe read path — the tables
 * themselves have no anon grants). Works with any Supabase client: the anon
 * checkout client for quoting and the service-role client for server-side
 * fee re-verification on order creation.
 *
 * Fails soft: RPC errors or malformed payloads resolve to empty zones/rates
 * so shipping quoting never takes down a checkout. Use
 * {@link getMerchantShippingRatesOrThrow} on the order path, where a load
 * failure must NOT masquerade as an empty rate set.
 */
export async function getMerchantShippingRates(
  supabase: MerchantShippingRatesRpcClient,
  merchantId: string
): Promise<StorefrontShippingRatesPayload> {
  const { data, error } = await loadMerchantShippingRatesRpc(
    supabase,
    merchantId
  );

  if (error) {
    console.error('Failed to load merchant shipping rates', {
      merchantId,
      error,
    });
    return { zones: [], locations: [], rates: [] };
  }

  return parseStorefrontShippingRatesPayload(data);
}

/**
 * Fail-LOUD variant for the order-verification path: throws a
 * {@link MerchantShippingRatesLoadError} when the storefront RPC errors,
 * instead of collapsing the failure into an empty payload. A successful RPC
 * (even one that returns no rates) resolves to the parsed payload exactly like
 * {@link getMerchantShippingRates}, so a genuinely-empty result stays a normal
 * (non-throwing) outcome the verifier can reject as an invalid rate (400).
 */
export async function getMerchantShippingRatesOrThrow(
  supabase: MerchantShippingRatesRpcClient,
  merchantId: string
): Promise<StorefrontShippingRatesPayload> {
  const { data, error } = await loadMerchantShippingRatesRpc(
    supabase,
    merchantId
  );

  if (error) {
    throw new MerchantShippingRatesLoadError(
      'Failed to load merchant shipping rates',
      { cause: error, code: extractErrorCode(error) }
    );
  }

  return parseStorefrontShippingRatesPayload(data);
}
