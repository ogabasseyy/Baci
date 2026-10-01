import type { SupabaseClient } from '@supabase/supabase-js';

export async function hasSettledPaystackOrderPaymentReference({
  gatewayReference,
  supabase,
}: {
  gatewayReference: string;
  supabase: SupabaseClient;
}): Promise<boolean> {
  const { data, error } = await supabase
    .from('transactions')
    .select('id')
    .eq('gateway', 'paystack')
    .eq('gateway_reference', gatewayReference)
    .eq('status', 'completed')
    .not('order_id', 'is', null)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}
