import { logger } from '@/lib/logger';
import { createAnonClient } from '@/lib/supabase/anon';

/**
 * Enqueues a provider-verified pending guest payment for the privileged
 * wedge sweep through the narrow `flag_guest_payment_provider_confirmed`
 * RPC (tracking token + reference bound, pending payment rows only).
 * The sweep re-verifies with the gateway before healing, so this flag
 * moves no money — it only admits the row to the sweep. Never rejects:
 * a flag failure keeps the existing pending response (logged) rather
 * than breaking verification.
 */
export async function flagGuestPaymentProviderConfirmed(
  orderId: string,
  trackingToken: string,
  gatewayReference: string
): Promise<boolean> {
  try {
    const supabase = createAnonClient();
    const { data, error } = await supabase.rpc(
      'flag_guest_payment_provider_confirmed',
      {
        p_order_id: orderId,
        p_tracking_token: trackingToken,
        p_gateway_reference: gatewayReference,
      }
    );
    if (error) {
      logger.error({
        message: 'Guest provider-confirmed flag failed',
        error,
        orderId,
        gatewayReference,
      });
      return false;
    }
    return data === true;
  } catch (error) {
    logger.error({
      message: 'Guest provider-confirmed flag raised',
      error,
      orderId,
      gatewayReference,
    });
    return false;
  }
}
