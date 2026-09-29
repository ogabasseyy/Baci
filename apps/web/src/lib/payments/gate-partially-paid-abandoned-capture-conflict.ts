import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

const CONFLICT_RESOLUTION = 'merchant_invoice_partial_conflict_reviewed';
const POSTGRES_UNIQUE_VIOLATION = '23505';

interface ConflictAttempt {
  gateway_reference: string;
  id: string;
  merchant_id: string;
  order_id: string;
}

interface ConflictContext {
  attempt: ConflictAttempt;
  hold: (reason: string) => Promise<void>;
  summary: { completed: string[]; failed: boolean; reviewsFiled: string[] };
  supabase: SupabaseClient;
}

async function fileConflictReview(
  supabase: SupabaseClient,
  {
    attempt,
    errorCode,
    reason,
  }: { attempt: ConflictAttempt; errorCode: string; reason: string }
): Promise<boolean> {
  const { error } = await supabase.from('reconciliation_review').insert({
    candidates: null,
    issue_type: 'merchant_invoice_partial_payment_conflict',
    merchant_id: attempt.merchant_id,
    metadata: { error_code: errorCode },
    order_id: attempt.order_id,
    paystack_ref: attempt.gateway_reference,
    reason,
    txn_id: attempt.id,
  });
  if (!error) return true;
  // This issue type dedupes per transfer (txn/ref), not per order, so a
  // conflict means this same capture was already filed — a second capture
  // files its own row. Redelivery is success; nothing merges.
  if ((error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION) {
    return true;
  }
  logger.error({
    error,
    message: 'Failed to file merchant invoice payment review',
    orderId: attempt.order_id,
    reference: attempt.gateway_reference,
    transactionId: attempt.id,
  });
  return false;
}

async function stampConflictResolution(
  supabase: SupabaseClient,
  attempt: ConflictAttempt
): Promise<boolean> {
  const { data: stamped, error: stampError } = await supabase.rpc(
    'stamp_abandoned_sweep_resolution_v1',
    {
      p_transaction_id: attempt.id,
      p_expected_reference: attempt.gateway_reference,
      p_resolution: CONFLICT_RESOLUTION,
    }
  );
  return !stampError && stamped === true;
}

export async function fileConflictAndRetire(
  context: ConflictContext,
  { errorCode, reason }: { errorCode: string; reason: string }
): Promise<'done'> {
  const { attempt, hold, summary, supabase } = context;
  const filed = await fileConflictReview(supabase, {
    attempt,
    errorCode,
    reason,
  });
  if (!filed) {
    summary.failed = true;
    await hold('partial_conflict_review_failed');
    return 'done';
  }
  const stamped = await stampConflictResolution(supabase, attempt);
  if (!stamped) {
    summary.failed = true;
    await hold('partial_conflict_stamp_failed');
    return 'done';
  }
  summary.reviewsFiled.push(attempt.id);
  return 'done';
}
