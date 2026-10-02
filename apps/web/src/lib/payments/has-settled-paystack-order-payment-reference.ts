import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePaymentGateway } from './normalize-payment-gateway';

export async function hasSettledPaystackOrderPaymentReference({
  gatewayReference,
  supabase,
}: {
  gatewayReference: string;
  supabase: SupabaseClient;
}): Promise<boolean> {
  // Legacy rows may pad or re-case the gateway (` Paystack `):
  // prefilter case-insensitively server-side, then exact-normalize.
  const { data, error } = await supabase
    .from('transactions')
    .select('id, gateway')
    .ilike('gateway', '%paystack%')
    .eq('gateway_reference', gatewayReference)
    .eq('status', 'completed')
    .not('order_id', 'is', null)
    .limit(1);
  if (error) throw error;
  return (
    Array.isArray(data) &&
    data.some(
      (row) =>
        normalizePaymentGateway((row as { gateway?: unknown }).gateway) ===
        'PAYSTACK'
    )
  );
}
