import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchCompletedPaymentsByReference } from './fetch-completed-payments-by-reference';

export async function hasSettledPaystackOrderPaymentReference({
  gatewayReference,
  supabase,
}: {
  gatewayReference: string;
  supabase: SupabaseClient;
}): Promise<boolean> {
  // Scan the whole normalized match set: a limit(1) ilike prefilter
  // can return only a corrupt gateway value containing `paystack`
  // (e.g. `notpaystack`) and miss the genuine completed leg,
  // double-crediting a replayed reference as a wallet deposit.
  const payments = await fetchCompletedPaymentsByReference(
    supabase,
    gatewayReference
  );
  return payments.some((payment) => payment.order_id !== null);
}
