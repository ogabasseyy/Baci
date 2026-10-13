import type { SupabaseClient } from '@supabase/supabase-js';

export type PaidRepairPickupForWebhookRetry = {
  merchantId: string;
  pickupPaymentStatus: string;
  repairId: string;
};

const RETRYABLE_PAID_STATUSES = new Set(['paid', 'booking', 'retrying']);

/**
 * Resolve an already-captured repair pickup by the durable paid reference so
 * Paystack redelivery can continue fulfillment after claim-signature rotation.
 */
export async function findPaidRepairPickupByReference(options: {
  reference: string;
  supabase: SupabaseClient;
  verifiedAmount: number;
}): Promise<
  | { kind: 'found'; repair: PaidRepairPickupForWebhookRetry }
  | { kind: 'lookup_failed' }
  | { kind: 'none' }
> {
  const { data, error } = await options.supabase
    .from('repairs')
    .select(
      'id, merchant_id, pickup_payment_status, pickup_fee, pickup_currency'
    )
    .eq('pickup_payment_reference', options.reference)
    .eq('service_type', 'pickup')
    .maybeSingle();

  if (error) {
    console.error(
      'Repair pickup paid-reference lookup failed for webhook retry:',
      error
    );
    return { kind: 'lookup_failed' };
  }

  if (
    !data ||
    typeof data !== 'object' ||
    typeof (data as { id?: unknown }).id !== 'string' ||
    typeof (data as { merchant_id?: unknown }).merchant_id !== 'string'
  ) {
    return { kind: 'none' };
  }

  const row = data as {
    id: string;
    merchant_id: string;
    pickup_currency?: unknown;
    pickup_fee?: unknown;
    pickup_payment_status?: unknown;
  };
  const status =
    typeof row.pickup_payment_status === 'string'
      ? row.pickup_payment_status
      : null;
  if (!status || !RETRYABLE_PAID_STATUSES.has(status)) {
    return { kind: 'none' };
  }
  if (
    row.pickup_currency !== 'NGN' ||
    typeof row.pickup_fee !== 'number' ||
    row.pickup_fee !== options.verifiedAmount
  ) {
    return { kind: 'none' };
  }

  return {
    kind: 'found',
    repair: {
      merchantId: row.merchant_id,
      pickupPaymentStatus: status,
      repairId: row.id,
    },
  };
}
