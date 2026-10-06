import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import type { customerSavingsCreateGoalSchema } from '@/schemas/customer-savings';
import {
  buildGoalRequestFingerprint,
  toSavingsRouteNumber,
} from './route-helpers';

type CreateGoalInput = z.infer<typeof customerSavingsCreateGoalSchema>;

// Idempotent replay before catalogue validation and feature gates: if
// creation committed but the response was lost, the retained key recovers
// the goal even when the product/variant was archived since or the
// merchant disabled savings/auto-debit after creation. The fingerprint
// must match exactly — an edited plan falls through to the normal path so
// the RPC raises mismatched_goal_idempotency_payload instead of
// returning a stale goal.
export async function tryReplaySavingsGoalCreation({
  customerId,
  goalInput,
  merchantId,
  supabase,
}: {
  customerId: string;
  goalInput: CreateGoalInput;
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<
  | { kind: 'replayed'; response: NextResponse }
  | { kind: 'continue'; requestFingerprint: string | null }
> {
  const requestFingerprint = goalInput.goalIdempotencyKey
    ? buildGoalRequestFingerprint({
        breakFeePercent: goalInput.breakFeePercent,
        contributionAmount: goalInput.contributionAmount,
        contributionFrequency: goalInput.contributionFrequency,
        earlyEndFeeAccepted: goalInput.earlyEndFeeAccepted,
        initialContributionAmount: goalInput.initialContributionAmount,
        maturityDate: goalInput.maturityDate,
        metadata: goalInput.metadata,
        preferredDebitTime: goalInput.preferredDebitTime,
        productId: goalInput.productId,
        savedPaymentMethodId: goalInput.savedPaymentMethodId,
        sourceMode: goalInput.sourceMode,
        startDate: goalInput.startDate,
        targetAmount: goalInput.targetAmount,
        title: goalInput.title ?? 'Device savings goal',
        variantId: goalInput.variantId,
      })
    : null;

  if (!goalInput.goalIdempotencyKey || !requestFingerprint) {
    return { kind: 'continue', requestFingerprint };
  }

  const replayResult = await supabase
    .from('customer_savings_goals')
    .select(
      'id, status, current_amount, contribution_amount, contribution_frequency, goal_request_fingerprint'
    )
    .eq('merchant_id', merchantId)
    .eq('customer_id', customerId)
    .eq('goal_idempotency_key', goalInput.goalIdempotencyKey)
    .maybeSingle();
  if (replayResult.error) {
    throw replayResult.error;
  }
  if (
    !replayResult.data ||
    replayResult.data.goal_request_fingerprint !== requestFingerprint
  ) {
    return { kind: 'continue', requestFingerprint };
  }

  const walletResult = await supabase
    .from('customer_wallets')
    .select('available_balance')
    .eq('merchant_id', merchantId)
    .eq('customer_id', customerId)
    .maybeSingle();
  if (walletResult.error) {
    throw walletResult.error;
  }
  return {
    kind: 'replayed',
    response: NextResponse.json({
      contributionAmount: toSavingsRouteNumber(
        replayResult.data.contribution_amount
      ),
      contributionFrequency: replayResult.data.contribution_frequency,
      contributionId: null,
      currentAmount: toSavingsRouteNumber(replayResult.data.current_amount),
      goalId: replayResult.data.id,
      goalStatus: replayResult.data.status,
      success: true,
      walletBalance: toSavingsRouteNumber(
        walletResult.data?.available_balance ?? 0
      ),
    }),
  };
}
