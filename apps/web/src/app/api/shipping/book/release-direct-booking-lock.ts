import type { SupabaseClient } from '@supabase/supabase-js';
import { clearOrderShipmentBookingLock } from '@/lib/shipping/order-shipment-booking-lock';

export async function releaseDirectBookingLock(
  supabase: SupabaseClient | null,
  merchantId: string,
  orderId: string,
  lockToken: string | null,
  retainBookingLock: boolean
): Promise<boolean> {
  if (!lockToken || !supabase) {
    return true;
  }
  if (retainBookingLock) {
    return false;
  }

  try {
    await clearOrderShipmentBookingLock(
      supabase,
      merchantId,
      orderId,
      lockToken
    );
    return true;
  } catch {
    // The lock is left to expire if cleanup cannot be completed here.
    return false;
  }
}
