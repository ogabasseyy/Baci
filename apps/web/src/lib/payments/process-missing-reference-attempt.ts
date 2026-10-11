import type { SupabaseClient } from '@supabase/supabase-js';
import { fileInvalidAttemptReference } from './file-invalid-attempt-reference';
import type { AbandonedPaystackAttemptSummary } from './reconcile-abandoned-paystack-attempts';

/**
 * File a missing-reference attempt without verifying, guarding, or
 * rotating: there is no reference to check, yet the row still blocks
 * merchant cancellation while pending/processing. The stamp (not
 * retirement) removes it from automated retries.
 */
export async function processMissingReferenceAttempt(
  supabase: SupabaseClient,
  attempt: {
    gateway_reference: string | null;
    id: string;
    merchant_id: string;
    metadata: Record<string, unknown> | null;
    order_id: string;
  },
  {
    hold,
    summary,
  }: {
    hold: (reason: string) => Promise<void>;
    summary: AbandonedPaystackAttemptSummary;
  }
): Promise<void> {
  const filed = await fileInvalidAttemptReference({
    attempt,
    reason: 'gateway_reference_missing',
    supabase,
  });
  if (filed) {
    summary.reviewsFiled.push(attempt.id);
    return;
  }
  summary.failed = true;
  await hold('invalid_reference');
}
