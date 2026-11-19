import type { SupabaseClient } from '@supabase/supabase-js';
import {
  recordOrderShipmentBookingFailure,
  toBookingFailureResponseError,
} from '@/lib/shipping/order-shipment-booking-failure';
import { clearOrderShipmentBookingLock } from '@/lib/shipping/order-shipment-booking-lock';
import { shouldReleaseBookingLock } from '@/lib/shipping/order-shipment-booking-lock-errors';
import type { runClaimedOrderWalletOrCheckoutBooking } from '@/lib/shipping/run-claimed-order-wallet-or-checkout-booking';

export async function executeClaimedOrderShipmentBooking({
  supabase,
  merchantId,
  orderId,
  existingOrder,
  paymentStatus,
  lockToken,
  runBooking,
}: {
  supabase: SupabaseClient;
  merchantId: string;
  orderId: string;
  existingOrder: Parameters<typeof runClaimedOrderWalletOrCheckoutBooking>[3];
  paymentStatus: string | null | undefined;
  lockToken: string | null;
  runBooking: typeof runClaimedOrderWalletOrCheckoutBooking;
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
