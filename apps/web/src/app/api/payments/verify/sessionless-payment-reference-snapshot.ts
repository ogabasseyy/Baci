import type { SupabaseClient } from '@supabase/supabase-js';
import type { GuestPaymentReferenceSnapshot } from './guest-payment-reference-snapshot';
import { readSessionlessPaymentReferenceSnapshot } from './read-sessionless-payment-reference-snapshot';

/**
 * Bearer-owned read model for sessionless verification: the
 * reference's transaction plus its order, returned only when the
 * reference belongs to an order whose customer record is owned by the
 * authenticated caller (enforced inside the
 * `get_sessionless_payment_reference_snapshot` RPC — zero rows
 * otherwise, so a valid reference owned by someone else is
 * indistinguishable from a bogus one). Runs on the bearer-scoped
 * client: the sessionless POST lane never constructs a service client.
 */
export async function getSessionlessPaymentReferenceSnapshot(
  bearerClient: Pick<SupabaseClient, 'rpc'>,
  reference: string
): Promise<GuestPaymentReferenceSnapshot | null> {
  try {
    return await readSessionlessPaymentReferenceSnapshot(
      bearerClient,
      reference
    );
  } catch {
    return null;
  }
}
