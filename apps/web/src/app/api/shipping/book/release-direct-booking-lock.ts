import type { SupabaseClient } from '@supabase/supabase-js';
import { clearOrderShipmentBookingLock } from '@/lib/shipping/order-shipment-booking-lock';

export async function releaseDirectBookingLock(
  supabase: SupabaseClient | null,
  merchantId: string,
  orderId: string,
  lockToken: string | null,
  retainBookingLock: boolean
): Promise<void> {
  if (!lockToken || !supabase || retainBookingLock) {
    return;
  }

  try {
    await clearOrderShipmentBookingLock(
      supabase,
      merchantId,
      orderId,
      lockToken
    );
  } catch {
    // The lock is left to expire if cleanup cannot be completed here.
  }
}
