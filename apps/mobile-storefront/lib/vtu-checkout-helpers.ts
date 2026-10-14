import { withTimeout } from '@baci/shared';
import { DEFAULT_TIMEOUT, HttpError } from '@/lib/fetch-with-timeout';
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

export function getAccessToken(
  expectedUserId?: string | null,
  options?: { requireSubmitterBinding?: boolean }
): Promise<string> {
  // Bounded (Codex R96 P2): a stalled Supabase auth call used to hang
  // the module-wide checkout guard forever — callers create their
  // POST deadline only after the token resolves, so the stall bricked
  // every utility purchase until restart. Same 30s budget as the
  // POST; the timeout error releases the guard via handler finally.
  return withTimeout(
    getAccessTokenInner(expectedUserId, options),
    DEFAULT_TIMEOUT,
    'Authentication timed out. Please try again.'
  );
}

async function getAccessTokenInner(
  expectedUserId?: string | null,
  options?: { requireSubmitterBinding?: boolean }
) {
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

  if (options?.requireSubmitterBinding && !expectedUserId) {
    // A session user exists (proven above) but the caller captured
    // none: the store hasn't hydrated the user id yet. Submitting
    // unbound would skip the server-side account-change guard, so
    // abort pre-POST instead of debiting an unverified account. The
    // key is untouched (no HTTP status), so the retry replays safely
    // once hydration lands.
    throw new Error('Account still loading. Please try again.');
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

/**
 * Statuses that must NOT rotate the key: the proxy security stage
 * (429 rate limit, 413 payload, 415 content, 403 guard), the
 * in-route auth/CSRF guards (401/403), and ambiguous timeout
 * infrastructure responses (408 timeout, 425 too early — either can
 * arrive after the handler accepted the request or even committed
 * the debit). No terminal outcome is recorded for these, so the key
 * must be kept — rotating after a 429 retry would mint a fresh key
 * for an already-committed attempt and debit twice. Mirrors web's
 * shouldRotateVtuKeyForStatus carve-out.
 */
const PRE_ROUTE_NO_ROTATION_STATUSES: ReadonlySet<number> = new Set([
  401, 403, 408, 413, 415, 425, 429,
]);

/**
 * True when a checkout error proves the attempt terminal: a definitive
 * route response (validation, insufficient balance, key collision, …)
 * whose outcome the server recorded under this key. Pre-route
 * 401/403/413/415/429 responses, 408/425 timeouts, 5xx, and
 * non-responses stay ambiguous — keep the key so the retry dedupes.
 */
export function shouldRotateWalletIdempotencyKeyForError(
  error: unknown
): boolean {
  return (
    error instanceof HttpError &&
    error.status >= 400 &&
    error.status < 500 &&
    !PRE_ROUTE_NO_ROTATION_STATUSES.has(error.status)
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
