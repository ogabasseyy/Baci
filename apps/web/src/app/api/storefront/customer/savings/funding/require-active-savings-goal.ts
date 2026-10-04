import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function requireActiveSavingsGoal({
  customerId,
  goalId,
  merchantId,
  supabase,
}: {
  customerId: string;
  goalId: string;
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<NextResponse | null> {
  const { data: goal, error } = await supabase
    .from('customer_savings_goals')
    .select('id, status')
    .eq('merchant_id', merchantId)
    .eq('customer_id', customerId)
    .eq('id', goalId)
    .maybeSingle();
  if (error || !goal) {
    return NextResponse.json(
      { code: 'SAVINGS_GOAL_NOT_FOUND', error: 'Savings goal not found' },
      { status: 404 }
    );
  }
  if (goal.status !== 'active') {
    return NextResponse.json(
      {
        code: 'SAVINGS_GOAL_NOT_ACTIVE',
        error: 'Only active savings plans can be funded',
      },
      { status: 409 }
    );
  }
  return null;
}
