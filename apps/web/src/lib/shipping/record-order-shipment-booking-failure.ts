import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { classifyBookingFailure } from './classify-booking-failure';

/** Best effort: recording a failure must never hide or replace the real error. */
export async function recordOrderShipmentBookingFailure(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  error: unknown,
  lockRetained: boolean
): Promise<void> {
  try {
    const failure = classifyBookingFailure(error);
    const { error: insertError } = await supabase
      .from('order_shipment_booking_failures')
      .insert({
        order_id: orderId,
        merchant_id: merchantId,
        error_code: failure.code,
        error_message: failure.message,
        http_status: failure.httpStatus,
        outcome: failure.outcome,
        lock_retained: lockRetained,
      });
    if (insertError) {
      logger.error({
        message: 'Could not record shipment booking failure',
        orderId,
        error: insertError,
      });
    }
  } catch (recordError) {
    logger.error({
      message: 'Could not record shipment booking failure',
      orderId,
      error: recordError,
    });
  }
}
