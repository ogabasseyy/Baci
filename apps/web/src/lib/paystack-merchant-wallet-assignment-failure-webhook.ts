import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { failMerchantWalletAssignmentEvent } from './merchant-wallet-assignment-events';
import { persistMerchantWalletAssignmentReview } from './persist-merchant-wallet-assignment-review';

export async function handlePaystackMerchantWalletAssignmentFailure(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
) {
  const assignment = await failMerchantWalletAssignmentEvent(supabase, payload);
  if (assignment.kind === 'match') {
    return NextResponse.json({
      success: true,
      handled: 'merchant_wallet_assignment_failure',
    });
  }
  if (assignment.kind === 'ignored') {
    return NextResponse.json({ message: 'Event ignored' });
  }
  await persistMerchantWalletAssignmentReview(supabase, payload);
  // Acknowledge once review persistence succeeds. Retries cannot resolve an
  // uncorrelated immutable payload, and non-2xx responses cause Paystack to
  // redeliver indefinitely (including duplicate NULL-ref review rows).
  return NextResponse.json({
    success: true,
    handled: 'merchant_wallet_assignment_failure_review',
    code: 'MERCHANT_WALLET_ASSIGNMENT_FAILURE_REVIEW',
  });
}
