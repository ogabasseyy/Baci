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
    .select('id, status, source_mode')
    .eq('merchant_id', merchantId)
    .eq('customer_id', customerId)
    .eq('id', goalId)
    .maybeSingle();
  // A lookup failure is not a missing goal: report 5xx so clients retry
  // instead of treating the plan as permanently gone. Only a successful
  // lookup with no row is a 404.
  if (error) {
    return NextResponse.json(
      { code: 'SAVINGS_GOAL_LOOKUP_FAILED', error: 'Savings goal lookup failed' },
      { status: 500 }
    );
  }
  if (!goal) {
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
  // Transfer funding is manual-only, matching the funding screen's
  // goal-matches rule: auto-debit plans are funded by debit, and a
  // transfer link must not provision accounts for them.
  if (goal.source_mode !== 'manual') {
    return NextResponse.json(
      {
        code: 'SAVINGS_GOAL_NOT_MANUAL',
        error: 'Only manual savings plans can be funded by transfer',
      },
      { status: 409 }
    );
  }
  return null;
}
