import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { verifyTransaction } from '@/lib/paystack';
import type { finalizeOrderGatewayPayment } from './finalize-order-gateway-payment';
import { processAbandonedPaystackAttempt } from './reconcile-abandoned-paystack-attempts-process';

const DEFAULT_LIMIT = 25;
// Give an abandoned checkout time to settle before releasing a paid order.
const DEFAULT_OLDER_THAN_MINUTES = 12 * 60;
const RECHECK_AFTER_MINUTES = 55;

interface PendingAttempt {
  amount: number;
  currency: string;
  gateway: string | null;
  gateway_reference: string | null;
  id: string;
  merchant_id: string;
  metadata: Record<string, unknown> | null;
  order_id: string;
  paid_order?: { payment_status: string } | Array<{ payment_status: string }>;
  platform_fee: number | null;
  status: 'pending' | 'processing' | 'completed';
}

export interface AbandonedPaystackAttemptSummary {
  checked: number;
  completed: string[];
  failed: boolean;
  held: Array<{ id: string; reason: string; rotationFailed?: boolean }>;
  retired: string[];
  reviewsFiled: string[];
}

/** Clear old, superseded attempts only after checking their current Paystack status. */
export async function reconcileAbandonedPaystackAttempts({
  supabase,
  finalizePayment,
  verify = verifyTransaction,
  limit = DEFAULT_LIMIT,
  olderThanMinutes = DEFAULT_OLDER_THAN_MINUTES,
  deadlineMs,
  scheduleAfter = () => {
    // No-op default for unit tests; the cron route passes after().
  },
}: {
  supabase: SupabaseClient;
  finalizePayment?: typeof finalizeOrderGatewayPayment;
  verify?: typeof verifyTransaction;
  limit?: number;
  olderThanMinutes?: number;
  deadlineMs?: number;
  scheduleAfter?: (task: () => Promise<void>) => void;
}): Promise<AbandonedPaystackAttemptSummary> {
  const summary: AbandonedPaystackAttemptSummary = {
    checked: 0,
    completed: [],
    failed: false,
    held: [],
    retired: [],
    reviewsFiled: [],
  };
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const recheckCutoff = new Date(
    Date.now() - RECHECK_AFTER_MINUTES * 60_000
  ).toISOString();
  // Candidate selection runs inside the database: PostgREST cannot
  // express the normalized gateway predicate legacy rows require
  // (` Paystack ` must match), and a loose prefilter would both
  // discard the partial candidate index and let corrupt rows occupy
  // the bounded batch before exact filtering. The RPC returns the
  // stale main branch plus the filing-only retry branch
  // (completed captures with failed duplicate filings, never on
  // partially-paid orders) plus a bounded missing-reference
  // trickle the worker files without verifying, oldest first
  // per branch with null timestamps ahead of the limit.
  const { data: attempts, error: lookupError } = await supabase.rpc(
    'select_abandoned_paystack_attempt_candidates_v1',
    {
      p_limit: limit,
      p_or_cutoff: cutoff,
      p_or_recheck_cutoff: recheckCutoff,
    }
  );

  if (lookupError) {
    throw new Error(
      `pending_paystack_attempt_lookup_failed: ${lookupError.message}`
    );
  }

  for (const attempt of (attempts ?? []) as PendingAttempt[]) {
    // Stop starting attempts at the pass deadline: serial provider
    // verification can outlast the invocation budget, and unstarted rows
    // stay eligible for the next sweep.
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
      logger.info({
        message: 'Stopping abandoned-attempt sweep at pass deadline',
        attemptId: attempt.id,
      });
      break;
    }
    summary.checked += 1;
    await processAbandonedPaystackAttempt(supabase, attempt, {
      deadlineMs,
      finalizePayment,
      scheduleAfter,
      summary,
      verify,
    });
  }

  return summary;
}
