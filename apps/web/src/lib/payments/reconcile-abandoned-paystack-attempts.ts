import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyTransaction } from '@/lib/paystack';

const DEFAULT_LIMIT = 25;
// Give an abandoned checkout time to settle before releasing a paid order.
const DEFAULT_OLDER_THAN_MINUTES = 12 * 60;
const VERIFY_TIMEOUT_MS = 5_000;

interface PendingAttempt {
  amount: number;
  currency: string;
  gateway_reference: string;
  id: string;
  merchant_id: string;
  metadata: Record<string, unknown> | null;
  order_id: string;
  status: 'pending' | 'processing';
}

export interface AbandonedPaystackAttemptSummary {
  checked: number;
  held: Array<{ id: string; reason: string; rotationFailed?: boolean }>;
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
  // Move held candidates behind older eligible rows without making them wait
  // another full eligibility window after a transient provider failure.
  const rotatedAt = new Date(Date.parse(cutoff) - 1).toISOString();
  const { data: attempts, error: lookupError } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, gateway_reference, amount, currency, status, metadata, paid_order:orders!transactions_order_id_fkey!inner(payment_status)'
    )
    .eq('transaction_type', 'payment')
    .eq('gateway', 'paystack')
    .in('status', ['pending', 'processing'])
    .in('paid_order.payment_status', ['paid', 'partially_paid'])
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
        .update({ updated_at: rotatedAt })
        .eq('id', attempt.id)
        .eq('order_id', attempt.order_id)
        .eq('merchant_id', attempt.merchant_id)
        .eq('transaction_type', 'payment')
        .eq('gateway', 'paystack')
        .eq('gateway_reference', attempt.gateway_reference)
        .eq('status', attempt.status);
    const hold = async (reason: string) => {
      const entry: { id: string; reason: string; rotationFailed?: boolean } = {
        id: attempt.id,
        reason,
      };
      summary.held.push(entry);
      // Move unresolved attempts to the back of the next sweep instead of
      // allowing old pending attempts to starve newer candidates.
      try {
        const { error } = await guardAttempt();
        if (error) {
          entry.rotationFailed = true;
        }
      } catch {
        entry.rotationFailed = true;
      }
    };

    // Only clear attempts superseded by a different completed payment on an
    // already paid order. Other pending attempts still need payment recovery.
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id')
      .eq('id', attempt.order_id)
      .eq('merchant_id', attempt.merchant_id)
      .in('payment_status', ['paid', 'partially_paid'])
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
      result = await verify(
        attempt.gateway_reference,
        AbortSignal.timeout(VERIFY_TIMEOUT_MS)
      );
    } catch {
      await hold('verification_unavailable');
      continue;
    }
    if (!result.success) {
      if (
        result.code !== 'HTTP_404' ||
        attempt.metadata?.paystack_payment_type !== 'dva'
      ) {
        await hold('verification_unavailable');
        continue;
      }
    }
    if (result.success && result.data.reference !== attempt.gateway_reference) {
      await hold('reference_mismatch');
      continue;
    }
    if (
      result.success &&
      (!Number.isFinite(Number(attempt.amount)) ||
        Number(attempt.amount) <= 0 ||
        result.data.amount !== Math.round(Number(attempt.amount) * 100) ||
        typeof result.data.currency !== 'string' ||
        result.data.currency.toUpperCase() !==
          String(attempt.currency).toUpperCase())
    ) {
      await hold('payment_evidence_mismatch');
      continue;
    }
    if (
      result.success &&
      result.data.status !== 'abandoned' &&
      result.data.status !== 'failed'
    ) {
      await hold(result.data.status);
      continue;
    }

    // The order and reference guards prevent a concurrent webhook or retry
    // from being overwritten after provider verification.
    const retire = async () =>
      supabase
        .from('transactions')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', attempt.id)
        .eq('order_id', attempt.order_id)
        .eq('merchant_id', attempt.merchant_id)
        .eq('transaction_type', 'payment')
        .eq('gateway', 'paystack')
        .eq('gateway_reference', attempt.gateway_reference)
        .eq('status', attempt.status)
        .select('id');
    const retirement = await retire().catch(() => {
      throw new Error('abandoned_paystack_attempt_retirement_failed');
    });
    if (retirement.error) {
      throw new Error('abandoned_paystack_attempt_retirement_failed');
    }
    if (retirement.data?.length === 1) {
      summary.retired.push(attempt.id);
    } else {
      summary.held.push({ id: attempt.id, reason: 'changed_concurrently' });
    }
  }

  return summary;
}
