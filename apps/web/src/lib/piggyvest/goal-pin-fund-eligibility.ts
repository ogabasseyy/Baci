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

/**
 * True only when the goal is an active or paused goal of this customer and
 * merchant: a funded goal that the older cancel paused is still cancellable
 * with a refund. Same client, same RLS, same throw-on-error as above.
 */
export async function isCancellableOwnGoal(input: {
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
    .in('status', ['active', 'paused'])
    .maybeSingle();
  if (error) throw new Error('Savings goal lookup unavailable');
  return data !== null;
}

/**
 * True only when the goal is an active, paused or completed goal of this
 * customer and merchant: a goal that reached its target is marked completed
 * before the customer chooses to complete it, and a paused one can still be
 * completed once it matured. Whether the target or maturity date has actually
 * been reached is decided by the database at issue, reservation and dispatch.
 * Same client, same RLS, same throw-on-error as above.
 */
export async function isCompletableOwnGoal(input: {
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
    .in('status', ['active', 'paused', 'completed'])
    .maybeSingle();
  if (error) throw new Error('Savings goal lookup unavailable');
  return data !== null;
}
