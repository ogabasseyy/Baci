import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyTransaction } from '@/lib/paystack';

const DEFAULT_LIMIT = 25;
// Give an abandoned checkout time to settle before releasing a paid order.
const DEFAULT_OLDER_THAN_MINUTES = 12 * 60;

interface PendingAttempt {
  gateway_reference: string;
  id: string;
  merchant_id: string;
  order_id: string;
}

export interface AbandonedPaystackAttemptSummary {
  checked: number;
  held: Array<{ id: string; reason: string }>;
  retired: string[];
}

/** Clear old, superseded attempts only after checking their current Paystack status. */
export async function reconcileAbandonedPaystackAttempts({
  supabase,
  verify = verifyTransaction,
  limit = DEFAULT_LIMIT,
  olderThanMinutes = DEFAULT_OLDER_THAN_MINUTES,
}: {
  supabase: SupabaseClient;
  verify?: typeof verifyTransaction;
  limit?: number;
  olderThanMinutes?: number;
}): Promise<AbandonedPaystackAttemptSummary> {
  const summary: AbandonedPaystackAttemptSummary = {
    checked: 0,
    held: [],
    retired: [],
  };
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const { data: attempts, error: lookupError } = await supabase
    .from('transactions')
    .select('id, order_id, merchant_id, gateway_reference')
    .eq('transaction_type', 'payment')
    .eq('gateway', 'paystack')
    .eq('status', 'pending')
    .not('order_id', 'is', null)
    .not('gateway_reference', 'is', null)
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (lookupError) {
    throw new Error(
      `pending_paystack_attempt_lookup_failed: ${lookupError.message}`
    );
  }

  for (const attempt of (attempts ?? []) as PendingAttempt[]) {
    summary.checked += 1;
    const guardAttempt = () =>
      supabase
        .from('transactions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', attempt.id)
        .eq('order_id', attempt.order_id)
        .eq('merchant_id', attempt.merchant_id)
        .eq('transaction_type', 'payment')
        .eq('gateway', 'paystack')
        .eq('gateway_reference', attempt.gateway_reference)
        .eq('status', 'pending');
    const hold = async (reason: string) => {
      summary.held.push({ id: attempt.id, reason });
      // Move unresolved attempts to the back of the next sweep instead of
      // allowing old pending attempts to starve newer candidates.
      try {
        const { error } = await guardAttempt();
        if (error) {
          summary.held.push({ id: attempt.id, reason: 'rotation_failed' });
        }
      } catch {
        summary.held.push({ id: attempt.id, reason: 'rotation_failed' });
      }
    };

    // Only clear attempts superseded by a different completed payment on an
    // already paid order. Other pending attempts still need payment recovery.
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id')
      .eq('id', attempt.order_id)
      .eq('merchant_id', attempt.merchant_id)
      .eq('payment_status', 'paid')
      .maybeSingle();
    if (orderError || !order) {
      await hold('order_not_paid_or_unavailable');
      continue;
    }
    const { data: completed, error: completedError } = await supabase
      .from('transactions')
      .select('id')
      .eq('order_id', attempt.order_id)
      .eq('merchant_id', attempt.merchant_id)
      .eq('transaction_type', 'payment')
      .eq('status', 'completed')
      .neq('id', attempt.id)
      .limit(1);
    if (completedError || !completed?.length) {
      await hold('no_completed_payment_or_unavailable');
      continue;
    }

    let result: Awaited<ReturnType<typeof verifyTransaction>>;
    try {
      result = await verify(attempt.gateway_reference);
    } catch {
      await hold('verification_unavailable');
      continue;
    }
    if (!result.success) {
      await hold('verification_unavailable');
      continue;
    }
    if (result.data.reference !== attempt.gateway_reference) {
      await hold('reference_mismatch');
      continue;
    }
    if (result.data.status !== 'abandoned' && result.data.status !== 'failed') {
      await hold(result.data.status);
      continue;
    }

    try {
      // The order and reference guards prevent a concurrent webhook or retry
      // from being overwritten after provider verification.
      const { data: updated, error: updateError } = await supabase
        .from('transactions')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', attempt.id)
        .eq('order_id', attempt.order_id)
        .eq('merchant_id', attempt.merchant_id)
        .eq('transaction_type', 'payment')
        .eq('gateway', 'paystack')
        .eq('gateway_reference', attempt.gateway_reference)
        .eq('status', 'pending')
        .select('id');
      if (updateError) {
        summary.held.push({ id: attempt.id, reason: 'update_failed' });
      } else if (updated?.length === 1) {
        summary.retired.push(attempt.id);
      } else {
        summary.held.push({ id: attempt.id, reason: 'changed_concurrently' });
      }
    } catch {
      summary.held.push({ id: attempt.id, reason: 'update_failed' });
    }
  }

  return summary;
}
