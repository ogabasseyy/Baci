import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

const SHORT_RESOLUTION = 'partial_capture_short_reviewed';
const POSTGRES_UNIQUE_VIOLATION = '23505';

interface ShortAttempt {
  gateway_reference: string;
  id: string;
  merchant_id: string;
  order_id: string;
}

interface ShortContext {
  attempt: ShortAttempt;
  hold: (reason: string) => Promise<void>;
  summary: { completed: string[]; failed: boolean; reviewsFiled: string[] };
  supabase: SupabaseClient;
}

interface ShortEvidence {
  captureMinor: number;
  outstandingMinor: number;
  providerData: Record<string, unknown>;
}

async function fileShortCaptureReview(
  supabase: SupabaseClient,
  {
    attempt,
    captureMinor,
    outstandingMinor,
    providerData,
  }: { attempt: ShortAttempt } & ShortEvidence
): Promise<boolean> {
  const capture = providerData as unknown as {
    currency?: unknown;
    id?: unknown;
    status?: unknown;
  };
  const { error } = await supabase.from('reconciliation_review').insert({
    candidates: null,
    issue_type: 'partial_capture_short_requires_review',
    metadata: {
      capture_amount_minor: captureMinor,
      currency: typeof capture.currency === 'string' ? capture.currency : 'NGN',
      outstanding_amount_minor: outstandingMinor,
      provider_reference: String(capture.id ?? ''),
      provider_status: String(capture.status ?? ''),
    },
    order_id: attempt.order_id,
    paystack_ref: attempt.gateway_reference,
    reason: `Paystack capture ${attempt.gateway_reference} verified below the outstanding balance (${captureMinor} of ${outstandingMinor} kobo); captured funds need operations review`,
    txn_id: attempt.id,
  });
  if (!error) return true;
  // This issue type dedupes per transfer (txn/ref), not per order, so a
  // conflict means this same capture was already filed. Redelivery is
  // success; nothing merges.
  if ((error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION) {
    return true;
  }
  logger.error({
    error,
    message: 'Failed to file short-capture review',
    orderId: attempt.order_id,
    reference: attempt.gateway_reference,
    transactionId: attempt.id,
  });
  return false;
}

async function stampShortResolution(
  supabase: SupabaseClient,
  attempt: ShortAttempt
): Promise<boolean> {
  const { data: stamped, error: stampError } = await supabase.rpc(
    'stamp_abandoned_sweep_resolution_v1',
    {
      p_transaction_id: attempt.id,
      p_expected_reference: attempt.gateway_reference,
      p_resolution: SHORT_RESOLUTION,
    }
  );
  return !stampError && stamped === true;
}

/**
 * File a verified short capture for operations review and retire the
 * attempt from the sweep. Holding would rotate the same verified capture
 * forever while the captured funds stay unapplied and merchant
 * cancellation keeps rejecting with payment_capture_in_flight.
 */
export async function fileShortCaptureAndRetire(
  context: ShortContext,
  evidence: ShortEvidence
): Promise<'done'> {
  const { attempt, hold, summary, supabase } = context;
  const filed = await fileShortCaptureReview(supabase, {
    attempt,
    ...evidence,
  });
  if (!filed) {
    summary.failed = true;
    await hold('partial_short_review_failed');
    return 'done';
  }
  const stamped = await stampShortResolution(supabase, attempt);
  if (!stamped) {
    summary.failed = true;
    await hold('partial_short_stamp_failed');
    return 'done';
  }
  summary.reviewsFiled.push(attempt.id);
  return 'done';
}
