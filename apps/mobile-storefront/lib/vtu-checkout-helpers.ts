import { HttpError } from '@/lib/fetch-with-timeout';
import { MOBILE_TO_KUDA_PROVIDER } from '@/lib/network-utils';
import { supabase } from '@/lib/supabase';

const ALLOWED_CONFIRM_CHECKOUT_STATUSES = ['successful', 'processing'] as const;

function isAllowedConfirmCheckoutStatus(
  status: string
): status is (typeof ALLOWED_CONFIRM_CHECKOUT_STATUSES)[number] {
  return ALLOWED_CONFIRM_CHECKOUT_STATUSES.some(
    (allowedStatus) => allowedStatus === status
  );
}

export function normalizeConfirmCheckoutStatus(status: unknown) {
  if (typeof status !== 'string') {
    throw new Error(`Unexpected VTU checkout status: ${String(status)}`);
  }

  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus === 'already_completed') {
    return 'processing' as const;
  }

  if (isAllowedConfirmCheckoutStatus(normalizedStatus)) {
    return normalizedStatus;
  }

  throw new Error(`Unexpected VTU checkout status: ${status}`);
}

export function normalizeVtuCheckoutPayload<T extends object>(payload: T): T {
  if (!('networkProvider' in payload)) {
    return payload;
  }

  const rawProvider = (payload as { networkProvider?: unknown })
    .networkProvider;
  if (typeof rawProvider !== 'string' || !rawProvider) {
    return payload;
  }

  const lookupKey = rawProvider.toLowerCase();
  return {
    ...payload,
    networkProvider: MOBILE_TO_KUDA_PROVIDER[lookupKey] ?? rawProvider,
  };
}

export async function getAccessToken(expectedUserId?: string | null) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new Error('Authentication required. Please sign in again.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('Authentication required. Please sign in again.');
  }

  // Bind the token to the submitter when the caller captured one: an
  // account switch between getUser and getSession (or before both)
  // would otherwise hand back another customer's token, and the
  // server debits whoever the token belongs to. Compare against the
  // SESSION's user — atomic with the token object — not getUser's,
  // which a mid-flight switch can already have invalidated.
  if (expectedUserId && session.user?.id !== expectedUserId) {
    throw new Error('Account changed during checkout. Please try again.');
  }

  return session.access_token;
}

export function getResponseErrorMessage(data: Record<string, unknown>) {
  return typeof data.error === 'string'
    ? data.error
    : 'Request failed. Please try again.';
}

export async function parseJsonResponse(response: Response) {
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new HttpError(response.status, getResponseErrorMessage(data));
  }

  return data;
}

export function shouldRotateWalletIdempotencyKeyForError(
  error: unknown
): boolean {
  return (
    error instanceof HttpError && error.status >= 400 && error.status < 500
  );
}

interface VtuCashbackBlock {
  amount: number;
  credited?: boolean;
  newBalance: number;
}

/**
 * Returns the cashback block only when the server actually credited it.
 * On `credit_customer_wallet` RPC failure the route still returns a
 * successful purchase with `credited: false` and a default `newBalance`
 * of 0 — surfacing that would tell the customer they received cashback
 * and show a wrong wallet balance.
 */
export function creditedVtuCashback<T extends VtuCashbackBlock>(
  cashback: T | null | undefined
): T | undefined {
  return cashback?.credited === true ? cashback : undefined;
}
