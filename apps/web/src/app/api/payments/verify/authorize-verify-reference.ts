import { getAuthenticatedUser } from '@/lib/supabase/mobile-auth';
import { getGuestPaymentReferenceSnapshot } from './guest-payment-reference-snapshot';

export interface SessionlessVerifyAuthorization {
  authorized: boolean;
  /**
   * The order the proof binds the reference to. The service-client
   * verification must refuse any transaction row naming another order, so
   * the finalization target cannot drift from the authorized one.
   */
  orderId: string | null;
}

/**
 * Authorizes a sessionless POST /api/payments/verify caller before the
 * service-client read/finalization path. `checkCsrfProtection` accepts any
 * syntactic `Authorization: Bearer [REDACTED] (mobile callers hold no CSRF token), so the
 * header alone proves nothing: the caller must present either the
 * creation tracking token bound to the reference's own order (the same
 * narrow snapshot RPC the GET path uses) or a live user session whose
 * customer record owns that order. The Bearer [REDACTED] runs on the
 * bearer-scoped client from getAuthenticatedUser through the
 * authorize_sessionless_verify_reference RPC (customer tokens cannot
 * read the merchant-scoped transactions table directly) — no service
 * client anywhere on this user-facing path. Every denial looks
 * identical.
 */
export async function authorizeSessionlessVerifyReference(
  request: Request,
  reference: string,
  trackingToken?: string
): Promise<SessionlessVerifyAuthorization> {
  const denied = { authorized: false, orderId: null };
  if (trackingToken) {
    const snapshot = await getGuestPaymentReferenceSnapshot(
      reference,
      trackingToken
    );
    if (!snapshot) {
      return denied;
    }
    return { authorized: true, orderId: snapshot.orderId };
  }
  const authed = await getAuthenticatedUser(request);
  // Cookie sessions never reach here (the route gates on the Bearer [REDACTED]
  // header first); only a validated user token counts, never the fallback.
  const bearerClient =
    authed?.authMode === 'bearer' ? authed.supabase : undefined;
  if (!bearerClient) {
    return denied;
  }
  try {
    const { data, error } = await bearerClient.rpc(
      'authorize_sessionless_verify_reference',
      { p_gateway_reference: reference }
    );
    if (error || typeof data !== 'string' || !data) {
      return denied;
    }
    return { authorized: true, orderId: data };
  } catch {
    return denied;
  }
}
