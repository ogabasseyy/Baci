import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * True only when the goal is an active goal of this customer and merchant.
 * Read with the caller's own client, so row-level security also applies. A
 * database error throws rather than answering, so a failure never passes.
 */
export async function isActiveOwnGoal(input: {
  supabase: SupabaseClient;
  merchantId: string;
  customerId: string;
  goalId: string;
}): Promise<boolean> {
  const { data, error } = await input.supabase
    .from('customer_savings_goals')
    .select('id')
    .eq('id', input.goalId)
    .eq('customer_id', input.customerId)
    .eq('merchant_id', input.merchantId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error('Savings goal lookup unavailable');
  return data !== null;
}
