import type { SupabaseClient } from '@supabase/supabase-js';

export interface ReferenceOnlyWatchMatch {
  amount: number;
  cancel_order: {
    cancelled_at: string | null;
    order_number?: string | null;
    shipping_status: string | null;
  } | null;
  currency: string;
  gateway_reference: string;
  id: string;
  merchant_id: string;
  order_id: string | null;
}

/**
 * Open (or refresh) the reference watch for a signed reference-only
 * refund event and return every completed local payment for its
 * reference. The insert and the confirming scan share one database
 * transaction under the reference advisory lock the completion path
 * claims under: rows returned mean the payment landed first and the
 * caller handles them; an empty set leaves the watch open for the
 * completion to claim. Without this, a payment pending during the
 * completed scan that completes before the stalled scan ends both
 * passes empty, and the event is acknowledged with no durable trace.
 * Throws on lookup failure like the scans it confirms.
 */
export async function openPaystackRefundReferenceWatch(
  supabase: SupabaseClient,
  {
    providerRefundStatus,
    reference,
  }: {
    providerRefundStatus: string;
    reference: string;
  }
): Promise<ReferenceOnlyWatchMatch[]> {
  const { data, error } = await supabase.rpc(
    'open_paystack_refund_reference_watch_v1',
    {
      p_evidence: {
        provider_refund_status: providerRefundStatus,
        reference_only: true,
      },
      p_paystack_ref: reference,
    }
  );
  if (error) throw new Error('refund_event_payment_lookup_failed');
  return (data ?? []) as ReferenceOnlyWatchMatch[];
}
