import { createHash } from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { parseSickwResponse } from '@/app/api/storefront/imei-check/sickw-parser';
import type { ImeiCheckResult } from '@/app/api/storefront/imei-check/sickw-parser.types';
import { buildSickwLookupData } from '@/lib/imei-sickw-lookup-data';
import { resolveVtuCustomer } from '@/lib/vtu-customer-resolution';
import { isInsufficientWalletBalanceError } from '@/lib/wallet-balance-error';

const SICKW_API_URL = 'https://sickw.com/api.php';
const SICKW_REQUEST_TIMEOUT_MS = 15_000;

export interface ImeiCustomerRecord {
  email: string | null;
  first_name: string | null;
  id: string;
  last_name: string | null;
  phone: string | null;
  user_id: string | null;
}

export interface ImeiLookupSuccessBody {
  data: ImeiCheckResult;
  lookupId?: string;
  status?: 'complete';
  success: true;
  tier: { checksIncluded: readonly string[]; name: string };
}

export interface ImeiLookupErrorBody {
  balance?: number;
  code: string;
  error: string;
  lookupId?: string;
  required?: number;
  status?: 'error';
  success: false;
}

export type ImeiLookupResponseBody =
  | ImeiLookupSuccessBody
  | ImeiLookupErrorBody;

export type SickwLookupResult =
  | {
      body: ImeiLookupSuccessBody;
      ok: true;
      rawResponseText: string;
      sickwStatus: string;
      status: 200;
    }
  | {
      body: ImeiLookupErrorBody;
      ok: false;
      rawResponseText?: string;
      refundReason: 'error' | 'not_found';
      sickwStatus: string;
      status: 404 | 502;
    };

export async function resolveImeiCustomer({
  merchantId,
  supabase,
  user,
}: {
  merchantId: string;
  supabase: SupabaseClient;
  user: User;
}): Promise<ImeiCustomerRecord | null> {
  return (await resolveVtuCustomer({
    merchantId,
    supabase,
    user,
  })) as ImeiCustomerRecord | null;
}

export async function readCustomerWalletBalance({
  customerId,
  merchantId,
  supabase,
}: {
  customerId: string;
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<number> {
  const { data, error } = await supabase
    .from('customer_wallets')
    .select('available_balance')
    .eq('customer_id', customerId)
    .eq('merchant_id', merchantId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read customer wallet balance: ${error.message}`);
  }

  return coerceNumber(data?.available_balance);
}

export {
  redeemImeiWalletAndBeginProviderSubmission,
  redeemImeiWalletPayment,
  refundImeiWalletPayment,
} from './imei-wallet-payments';

export { isInsufficientWalletBalanceError };

export function hashProviderResponse(rawResponseText: string): string {
  return createHash('sha256').update(rawResponseText).digest('hex');
}

export async function requestSickwCheck({
  apiKey,
  checksIncluded,
  imei,
  serviceId,
  tierName,
}: {
  apiKey: string;
  checksIncluded: readonly string[];
  imei: string;
  serviceId: string;
  tierName: string;
}): Promise<SickwLookupResult> {
  const params = new URLSearchParams({
    format: 'json',
    imei,
    key: apiKey,
    service: serviceId,
  });

  let response: Response;
  try {
    response = await fetch(`${SICKW_API_URL}?${params.toString()}`, {
      headers: { 'User-Agent': 'Baci-IMEI-Checker/1.0' },
      method: 'GET',
      signal: AbortSignal.timeout(SICKW_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError');
    console.error(
      '[IMEI Check] SICKW request failed:',
      isTimeout ? 'timeout' : error
    );
    return providerUnavailable();
  }

  const rawResponseText = await response.text();
  if (!response.ok) {
    console.error('[IMEI Check] SICKW API error:', response.status);
    return providerUnavailable(rawResponseText, `http_${response.status}`);
  }

  const payload = parseProviderPayload(rawResponseText);
  const providerError = getProviderError(payload);
  if (providerError) {
    return providerErrorToResult(providerError, rawResponseText);
  }

  const resultText = normalizeResult(payload.result ?? payload.data ?? payload);
  const parsed = parseSickwResponse(resultText);
  const result = buildSickwLookupData(imei, parsed, payload);

  return {
    body: {
      success: true,
      data: result,
      tier: { checksIncluded, name: tierName },
    },
    ok: true,
    rawResponseText,
    sickwStatus: 'success',
    status: 200,
  };
}

function providerUnavailable(
  rawResponseText?: string,
  sickwStatus = 'unavailable'
): SickwLookupResult {
  return {
    body: {
      success: false,
      error: 'Lookup failed; your wallet was refunded.',
      code: 'SICKW_UNAVAILABLE',
    },
    ok: false,
    rawResponseText,
    refundReason: 'error',
    sickwStatus,
    status: 502,
  };
}

function providerErrorToResult(
  errorMessage: string,
  rawResponseText: string
): SickwLookupResult {
  const normalized = errorMessage.toLowerCase();
  if (isProviderNotFoundError(normalized)) {
    return {
      body: {
        success: false,
        error: 'IMEI result was not found; your wallet was refunded.',
        code: 'SICKW_NOT_FOUND',
      },
      ok: false,
      rawResponseText,
      refundReason: 'not_found',
      sickwStatus: 'not_found',
      status: 404,
    };
  }

  return providerUnavailable(rawResponseText, 'provider_error');
}

function isProviderNotFoundError(normalizedMessage: string): boolean {
  return (
    normalizedMessage.includes('not found') ||
    normalizedMessage.includes('invalid imei') ||
    normalizedMessage.includes('imei invalid') ||
    normalizedMessage.includes('invalid serial') ||
    normalizedMessage.includes('serial invalid') ||
    // e.g. 'Rejected: 10 Characters Serial Not supported!' — the service
    // cannot serve this identifier, so retrying the same input is pointless.
    normalizedMessage.includes('not supported')
  );
}

function parseProviderPayload(rawText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    console.warn('[IMEI Check] Response is not JSON, treating as text');
  }

  return { result: rawText };
}

function normalizeResult(result: unknown): string | Record<string, unknown> {
  if (typeof result === 'string') {
    return result;
  }

  if (result && typeof result === 'object') {
    return result as Record<string, unknown>;
  }

  return '';
}

function getProviderError(payload: Record<string, unknown>): string | null {
  const result = payload.result;
  // Sickw signals failure as status 'error' OR 'rejected' (live example:
  // { status: 'rejected', result: 'Rejected: 10 Characters Serial Not
  // supported!' }). Treating 'rejected' as success charged customers for a
  // rejection notice rendered as an all-Unknown result with no refund.
  const isErrorObject =
    payload.status === 'error' ||
    payload.status === 'rejected' ||
    Boolean(payload.error);
  const normalizedResult =
    typeof result === 'string' ? result.trim().toLowerCase() : '';
  const isErrorString =
    normalizedResult.startsWith('error') ||
    normalizedResult.startsWith('rejected');

  if (!isErrorObject && !isErrorString) {
    return null;
  }

  const errorValue = payload.message ?? payload.error ?? result;
  return typeof errorValue === 'string' ? errorValue : 'Check failed';
}

function coerceNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
