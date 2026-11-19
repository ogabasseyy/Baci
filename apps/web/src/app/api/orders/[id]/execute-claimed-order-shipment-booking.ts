import type { SupabaseClient } from '@supabase/supabase-js';
import {
  recordOrderShipmentBookingFailure,
  toBookingFailureResponseError,
} from '@/lib/shipping/order-shipment-booking-failure';
import { clearOrderShipmentBookingLock } from '@/lib/shipping/order-shipment-booking-lock';
import { shouldReleaseBookingLock } from '@/lib/shipping/order-shipment-booking-lock-errors';
import { runClaimedOrderWalletOrCheckoutBooking } from '@/lib/shipping/run-claimed-order-wallet-or-checkout-booking';

export async function executeClaimedOrderShipmentBooking({
  supabase,
  merchantId,
  orderId,
  existingOrder,
  paymentStatus,
  lockToken,
}: {
  supabase: SupabaseClient;
  merchantId: string;
  orderId: string;
  existingOrder: Parameters<typeof runClaimedOrderWalletOrCheckoutBooking>[3];
  paymentStatus: string | null | undefined;
  lockToken: string | null;
}) {
  let lockReleased = false;

  try {
    return await runClaimedOrderWalletOrCheckoutBooking(
      supabase,
      merchantId,
      orderId,
      existingOrder,
      {
        paymentStatus,
        lockToken,
        onLockReleased: () => {
          lockReleased = true;
        },
      }
    );
  } catch (error) {
    console.error('Shipment booking failed:', error);
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
      lockHeld: Boolean(lockToken),
    });
  }
}
