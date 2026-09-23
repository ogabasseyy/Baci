import { getAuthenticatedUser } from '@/lib/supabase/mobile-auth';
import { createServiceClient } from '@/lib/supabase/service';
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
 * narrow snapshot RPC the GET path uses — no service client, no
 * existence oracle) or a live user session whose customer record owns
 * that order. Every denial looks identical.
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
  const bearerUser = authed?.authMode === 'bearer' ? authed.user : undefined;
  if (!bearerUser) {
    return denied;
  }
  try {
    const supabase = createServiceClient();
    const { data: transaction } = await supabase
      .from('transactions')
      .select('order_id')
      .eq('gateway_reference', reference)
      .maybeSingle();
    const orderId =
      transaction && typeof transaction.order_id === 'string'
        ? transaction.order_id
        : null;
    if (!orderId) {
      return denied;
    }
    const { data: order } = await supabase
      .from('orders')
      .select('customer_id')
      .eq('id', orderId)
      .maybeSingle();
    const customerId =
      order && typeof order.customer_id === 'string' ? order.customer_id : null;
    if (!customerId) {
      return denied;
    }
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('id', customerId)
      .eq('user_id', bearerUser.id)
      .maybeSingle();
    if (!customer) {
      return denied;
    }
    return { authorized: true, orderId };
  } catch {
    return denied;
  }
}
