import type { SupabaseClient } from '@supabase/supabase-js';
import {
  recordOrderShipmentBookingFailure,
  toBookingFailureResponseError,
} from '@/lib/shipping/order-shipment-booking-failure';
import { clearOrderShipmentBookingLock } from '@/lib/shipping/order-shipment-booking-lock';
import { shouldReleaseBookingLock } from '@/lib/shipping/order-shipment-booking-lock-errors';

// The runner is injected by the route so this helper does not add a new link
// to the route's reviewed import graph (booking-economics service authority).
type ClaimedBookingRunner = (
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  existingOrder: {
    selected_quote_id: string | null;
    shipping_funding_source: 'customer_checkout' | 'merchant_wallet' | null;
    shipping_provider: string | null;
    payment_status: string | null;
    payment_method: string | null;
  },
  options: {
    paymentStatus: string | null | undefined;
    lockToken: string | null;
    onLockReleased: () => void;
  }
) => Promise<{
  provider: string;
  quoteId: string;
  shipmentId: string;
  trackingNumber: string | null;
}>;

export async function executeClaimedOrderShipmentBooking({
  runBooking,
  supabase,
  merchantId,
  orderId,
  existingOrder,
  paymentStatus,
  lockToken,
}: {
  runBooking: ClaimedBookingRunner;
  supabase: SupabaseClient;
  merchantId: string;
  orderId: string;
  existingOrder: Parameters<ClaimedBookingRunner>[3];
  paymentStatus: string | null | undefined;
  lockToken: string | null;
}) {
  let lockReleased = false;

  try {
    return await runBooking(supabase, merchantId, orderId, existingOrder, {
      paymentStatus,
      lockToken,
      onLockReleased: () => {
        lockReleased = true;
      },
    });
  } catch (error) {
    // The failure row below is the diagnostic record; keep provider text
    // (waybills, addresses) out of the logs.
    console.error('Shipment booking failed:', {
      orderId,
      errorName: error instanceof Error ? error.name : typeof error,
      code: (error as { code?: unknown } | null)?.code,
    });
    if (lockToken && !lockReleased && shouldReleaseBookingLock(error)) {
      try {
        await clearOrderShipmentBookingLock(
          supabase,
          merchantId,
          orderId,
          lockToken
        );
        lockReleased = true;
      } catch (lockError) {
        console.error(
          'Failed to release shipment booking lock after booking error:',
          lockError
        );
      }
    }
    // Keep the reason on the order so a stuck booking can be diagnosed
    // later; never let this hide the real error below.
    await recordOrderShipmentBookingFailure(
      supabase,
      merchantId,
      orderId,
      error,
      Boolean(lockToken) && !lockReleased
    );
    throw toBookingFailureResponseError(error, {
      walletFunded: existingOrder.shipping_funding_source === 'merchant_wallet',
      lockHeld: Boolean(lockToken) && !lockReleased,
      lockRetained: Boolean(lockToken) && !lockReleased,
    });
  }
}
