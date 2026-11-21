import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type GuestPaymentReferenceSnapshot,
  parsePaymentReferenceSnapshotRow,
} from './guest-payment-reference-snapshot';

/** Preserve read errors for callers that distinguish denial from an outage. */
export async function readSessionlessPaymentReferenceSnapshot(
  client: Pick<SupabaseClient, 'rpc'>,
  reference: string
): Promise<GuestPaymentReferenceSnapshot | null> {
  const { data, error } = await client.rpc(
    'get_sessionless_payment_reference_snapshot',
    { p_gateway_reference: reference }
  );
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row || typeof row !== 'object') return null;
  const snapshot = parsePaymentReferenceSnapshotRow(
    row as Record<string, unknown>
  );
  return snapshot?.gatewayReference === reference ? snapshot : null;
}
