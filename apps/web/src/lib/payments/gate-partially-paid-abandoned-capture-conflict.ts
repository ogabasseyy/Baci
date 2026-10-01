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
  const row = {
    candidates: null,
    issue_type: 'merchant_invoice_partial_payment_conflict',
    merchant_id: attempt.merchant_id,
    metadata: {
      error_code: errorCode,
      gateway_reference: attempt.gateway_reference,
    },
    order_id: attempt.order_id,
    paystack_ref: attempt.gateway_reference,
    reason,
    txn_id: attempt.id,
  };
  const { error } = await supabase.from('reconciliation_review').insert(row);
  if (!error) return true;
  // The (issue_type, paystack_ref) index is global: two orders sharing a
  // legacy/corrupt reference collide, so a conflict may be the other
  // order's review rather than this capture already filed. Only treat it
  // as success when this transaction's own review is open.
  if ((error as { code?: string }).code !== POSTGRES_UNIQUE_VIOLATION) {
    logger.error({
      error,
      message: 'Failed to file merchant invoice payment review',
      orderId: attempt.order_id,
      reference: attempt.gateway_reference,
      transactionId: attempt.id,
    });
    return false;
  }
  const { data: existing, error: lookupError } = await supabase
    .from('reconciliation_review')
    .select('txn_id')
    .eq('issue_type', 'merchant_invoice_partial_payment_conflict')
    .eq('paystack_ref', attempt.gateway_reference)
    .eq('txn_id', attempt.id)
    .is('resolved_at', null)
    .maybeSingle();
  if (lookupError) {
    logger.error({
      error: lookupError,
      message: 'Failed to confirm conflict review',
      orderId: attempt.order_id,
      reference: attempt.gateway_reference,
      transactionId: attempt.id,
    });
    return false;
  }
  if (existing) return true;
  // Not our own review: another order owns the reference slot. Refile
  // without the globally colliding reference so this capture reaches
  // the operations queue instead of rotating on the same conflict
  // every sweep while blocking order cancellation. This issue type is
  // excluded from the per-order open index, so no sibling merge is
  // needed — the metadata keeps the reference for operations.
  const { error: nullRefError } = await supabase
    .from('reconciliation_review')
    .insert({ ...row, paystack_ref: null });
  if (!nullRefError) return true;
  if ((nullRefError as { code?: string }).code !== POSTGRES_UNIQUE_VIOLATION) {
    logger.error({
      error: nullRefError,
      message: 'Failed to file conflict review without reference',
      orderId: attempt.order_id,
      reference: attempt.gateway_reference,
      transactionId: attempt.id,
    });
    return false;
  }
  // Our own reference-less review from an earlier run that failed to
  // stamp collides on the transaction slot: confirm by transaction
  // and accept it so the stamp below retires the attempt instead of
  // holding an already-reviewed capture forever.
  const { data: ownReview, error: ownError } = await supabase
    .from('reconciliation_review')
    .select('id')
    .eq('issue_type', 'merchant_invoice_partial_payment_conflict')
    .eq('txn_id', attempt.id)
    .is('resolved_at', null)
    .maybeSingle();
  if (ownError) {
    logger.error({
      error: ownError,
      message: 'Failed to confirm own conflict review',
      orderId: attempt.order_id,
      transactionId: attempt.id,
    });
    return false;
  }
  return ownReview != null;
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
