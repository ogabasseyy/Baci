import type { SupabaseClient } from '@supabase/supabase-js';
import { bookRepairPickup } from '@/lib/repairs/book-repair-pickup';
import { notifyRepairPickupBookingAfterPayment } from '@/lib/repairs/notify-repair-pickup-booking';

type FulfillmentResult = {
  handled: true;
  status: number;
  body: { message: string; trackingNumber?: string };
};

async function setPickupPaymentStatus(
  supabase: SupabaseClient,
  claim: { merchantId: string; reference: string; repairId: string },
  status: 'retrying' | 'review'
): Promise<boolean> {
  const { error } = await supabase
    .from('repairs')
    .update({ pickup_payment_status: status })
    .eq('id', claim.repairId)
    .eq('merchant_id', claim.merchantId)
    .eq('pickup_payment_reference', claim.reference)
    .neq('pickup_payment_status', 'booked')
    .neq('pickup_payment_status', 'review')
    .neq('pickup_payment_status', 'manual_fulfilled');

  if (error) {
    console.error('Repair pickup payment status update failed:', error);
    return false;
  }
  return true;
}

/** Continue GIGL booking after a verified (or already-captured) pickup payment. */
export async function fulfillRepairPickupAfterPayment(options: {
  merchantId: string;
  pickupPaymentStatus: string | null;
  reference: string;
  repairId: string;
  supabase: SupabaseClient;
}): Promise<FulfillmentResult> {
  const claim = {
    merchantId: options.merchantId,
    reference: options.reference,
    repairId: options.repairId,
  };

  if (options.pickupPaymentStatus === 'manual_fulfilled') {
    return {
      handled: true,
      status: 200,
      body: {
        message:
          'Repair pickup payment confirmed; merchant arranged pickup manually',
      },
    };
  }
  if (options.pickupPaymentStatus === 'review') {
    return {
      handled: true,
      status: 200,
      body: {
        message: 'Repair pickup payment confirmed; shipment requires review',
      },
    };
  }

  const booking = await bookRepairPickup(
    options.supabase,
    options.merchantId,
    options.repairId
  );
  if (booking.ok) {
    await notifyRepairPickupBookingAfterPayment(
      options.supabase,
      options.merchantId,
      options.repairId
    );
    return {
      handled: true,
      status: 200,
      body: {
        message: 'Repair pickup payment confirmed and shipment booked',
        trackingNumber: booking.trackingNumber,
      },
    };
  }
  if (booking.reason === 'already_booked') {
    return {
      handled: true,
      status: 200,
      body: { message: 'Repair pickup payment already processed' },
    };
  }

  const shouldRetry = [
    'booking_failed',
    'booking_in_progress',
    'gigl_unavailable',
    'lookup_failed',
  ].includes(booking.reason);
  const statusUpdated = await setPickupPaymentStatus(
    options.supabase,
    claim,
    shouldRetry ? 'retrying' : 'review'
  );
  if (!statusUpdated) {
    console.error('Repair pickup review state could not be persisted:', {
      reference: options.reference,
      repairId: options.repairId,
      shouldRetry,
    });
    return {
      handled: true,
      status: 503,
      body: {
        message: shouldRetry
          ? 'Repair pickup payment confirmed; shipment booking will retry'
          : 'Repair pickup payment confirmed; review state persistence will retry',
      },
    };
  }

  if (!shouldRetry) {
    await notifyRepairPickupBookingAfterPayment(
      options.supabase,
      options.merchantId,
      options.repairId
    );
  }

  return {
    handled: true,
    status: shouldRetry ? 503 : 200,
    body: {
      message: shouldRetry
        ? 'Repair pickup payment confirmed; shipment booking will retry'
        : 'Repair pickup payment confirmed; shipment requires review',
    },
  };
}
