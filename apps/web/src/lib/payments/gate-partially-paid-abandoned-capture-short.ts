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
  const row = {
    candidates: null,
    issue_type: 'partial_capture_short_requires_review',
    merchant_id: attempt.merchant_id,
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
      message: 'Failed to file short-capture review',
      orderId: attempt.order_id,
      reference: attempt.gateway_reference,
      transactionId: attempt.id,
    });
    return false;
  }
  const { data: existing, error: lookupError } = await supabase
    .from('reconciliation_review')
    .select('txn_id')
    .eq('issue_type', 'partial_capture_short_requires_review')
    .eq('paystack_ref', attempt.gateway_reference)
    .eq('txn_id', attempt.id)
    .is('resolved_at', null)
    .maybeSingle();
  if (lookupError) {
    logger.error({
      error: lookupError,
      message: 'Failed to confirm short-capture review',
      orderId: attempt.order_id,
      reference: attempt.gateway_reference,
      transactionId: attempt.id,
    });
    return false;
  }
  if (existing) return true;
  // Not our own review: another order's review (or a sibling attempt's)
  // owns the reference slot. Refile without the globally colliding
  // reference so this capture reaches the operations queue instead of
  // rotating on the same conflict every sweep while blocking order
  // cancellation. The review stays truthful — it never claims the
  // reference — while metadata keeps the full capture evidence.
  const { error: nullRefError } = await supabase
    .from('reconciliation_review')
    .insert({ ...row, paystack_ref: null });
  if (!nullRefError) return true;
  if ((nullRefError as { code?: string }).code !== POSTGRES_UNIQUE_VIOLATION) {
    logger.error({
      error: nullRefError,
      message: 'Failed to file short-capture review without reference',
      orderId: attempt.order_id,
      reference: attempt.gateway_reference,
      transactionId: attempt.id,
    });
    return false;
  }
  // Still conflicting: a sibling attempt's open review holds this
  // order's slot. Append this capture under its own transaction key
  // so both stay visible; holding here would rotate until the sibling
  // resolves while this pending attempt blocks cancellation.
  return appendShortCaptureToSiblingReview(supabase, {
    attempt,
    captureMinor,
    outstandingMinor,
    providerData,
  });
}

async function appendShortCaptureToSiblingReview(
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
  const entry = {
    capture_amount_minor: captureMinor,
    currency: typeof capture.currency === 'string' ? capture.currency : 'NGN',
    gateway_reference: attempt.gateway_reference,
    outstanding_amount_minor: outstandingMinor,
    provider_reference: String(capture.id ?? ''),
    provider_status: String(capture.status ?? ''),
    observed_at: new Date().toISOString(),
  };
  // Read-modify-write, confirmed: concurrent appends for sibling
  // attempts can clobber each other's keys, so re-read and retry once
  // when our own key is missing. The update stays guarded on
  // unresolved so evidence never lands in a review operations just
  // closed — an empty update means the slot freed and the next sweep
  // files normally.
  for (let i = 0; i < 2; i++) {
    const { data: sibling, error: siblingError } = await supabase
      .from('reconciliation_review')
      .select('id, metadata')
      .eq('issue_type', 'partial_capture_short_requires_review')
      .eq('order_id', attempt.order_id)
      .is('resolved_at', null)
      .maybeSingle();
    if (siblingError || !sibling) {
      if (siblingError) {
        logger.error({
          error: siblingError,
          message: 'Failed to find sibling short-capture review',
          orderId: attempt.order_id,
          transactionId: attempt.id,
        });
      }
      return false;
    }
    const siblingMetadata =
      (sibling.metadata as Record<string, unknown> | null) ?? {};
    const shortCaptures =
      (siblingMetadata.short_captures as Record<string, unknown> | null) ?? {};
    const { data: updated, error: appendError } = await supabase
      .from('reconciliation_review')
      .update({
        metadata: {
          ...siblingMetadata,
          short_captures: { ...shortCaptures, [attempt.id]: entry },
        },
      })
      .eq('id', sibling.id)
      .is('resolved_at', null)
      .select('id');
    if (appendError || !updated || updated.length === 0) {
      if (appendError) {
        logger.error({
          error: appendError,
          message: 'Failed to append short-capture evidence',
          orderId: attempt.order_id,
          transactionId: attempt.id,
        });
      }
      return false;
    }
    const { data: confirmed } = await supabase
      .from('reconciliation_review')
      .select('metadata')
      .eq('id', sibling.id)
      .maybeSingle();
    const confirmedCaptures = (
      (confirmed?.metadata as Record<string, unknown> | null) ?? {}
    ).short_captures as Record<string, unknown> | null;
    if (confirmedCaptures && attempt.id in confirmedCaptures) return true;
  }
  logger.warn({
    message: 'Short-capture evidence lost a sibling append race twice',
    orderId: attempt.order_id,
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
