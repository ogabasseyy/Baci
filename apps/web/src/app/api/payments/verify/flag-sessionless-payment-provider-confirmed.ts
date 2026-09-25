import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * Enqueues a provider-verified pending sessionless payment for the
 * privileged wedge sweep through the narrow
 * `flag_sessionless_payment_provider_confirmed` RPC (ownership-bound:
 * the reference must belong to an order whose customer record is owned
 * by auth.uid(); pending payment rows only). The sweep re-verifies
 * with the gateway before healing, so this flag moves no money — it
 * only admits the row to the sweep. Never rejects: a flag failure
 * keeps the existing pending response (logged) rather than breaking
 * verification. Runs on the caller-owned bearer client (never admin).
 */
export async function flagSessionlessPaymentProviderConfirmed(
  supabase: SupabaseClient,
  gatewayReference: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc(
      'flag_sessionless_payment_provider_confirmed',
      {
        p_gateway_reference: gatewayReference,
      }
    );
    if (error) {
      logger.error({
        message: 'Sessionless provider-confirmed flag failed',
        error,
        gatewayReference,
      });
      return false;
    }
    return data === true;
  } catch (error) {
    logger.error({
      message: 'Sessionless provider-confirmed flag raised',
      error,
      gatewayReference,
    });
    return false;
  }
}
