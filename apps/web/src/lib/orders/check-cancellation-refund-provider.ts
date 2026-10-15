import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { GatewayPaymentTransaction } from './gateway-payment-transaction';
import { listPaystackRefunds } from './list-paystack-refunds';
import { normalizeRefundMoneyField } from './normalize-refund-money-field';
import type { CancellationOrder } from './order-cancellation-side-effect-types';
import { quarantineRefund } from './quarantine-order-cancellation-refund';
import { DeferredError } from './run-order-cancellation-side-effect';

export async function checkCancellationRefundProvider({
  reference,
  currency,
  knownRefunds,
  deadlineMs,
  order,
  supabase,
  transaction,
}: {
  reference: string;
  currency: string;
  knownRefunds: Array<{
    gateway_reference?: string | null;
    status: string;
    amount: number;
    currency?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
  deadlineMs?: number;
  order: CancellationOrder;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
  transaction: GatewayPaymentTransaction;
}): Promise<void> {
  // Every finding here files a reconciliation review before
  // terminalizing: a bare DeliveryUncertainError would strand the step
  // as delivery_uncertain with no row for operations to resolve.
  const quarantine = (
    reason: string,
    metadata: Record<string, unknown> = {}
  ): Promise<never> =>
    quarantineRefund({
      metadata: {
        provider: 'paystack',
        provider_reference: reference,
        failed_payment_transaction_id: transaction.id,
        payment_transaction_id: transaction.id,
        ...metadata,
      },
      order,
      preflight: true,
      reason,
      supabase,
      transactions: [transaction],
    });
  let rows: Awaited<ReturnType<typeof listPaystackRefunds>>;
  try {
    rows = await listPaystackRefunds(reference, { deadlineMs });
  } catch (error) {
    // Fail closed, but log the cause: a config outage (missing
    // secret) strands every Paystack leg and needs an ops alert,
    // not silent reconciliation backlog.
    logger.error({
      error,
      message: 'Cancellation refund provider verification failed',
      reference,
    });
    // Budget exhaustion is not provider evidence: a timed-out page
    // says nothing about the money, so defer with a fresh budget
    // instead of terminalizing a clean refund into reconciliation.
    if (
      (error as { name?: unknown } | null)?.name === 'TimeoutError' ||
      (error as { name?: unknown } | null)?.name === 'AbortError'
    ) {
      throw new DeferredError(
        'cancellation_refund_provider_verification_deferred_for_budget'
      );
    }
    return quarantine(
      'Unable to verify existing Paystack refunds; review required'
    );
  }
  // Completed manual Paystack refunds carry the merchant reference, not the
  // numeric provider ID, so they never match by gateway_reference. A fungible
  // amount pool cannot attribute which provider refund a manual row refers
  // to, so coverage requires an exact single-row correspondence: each
  // unmatched processed row must pair with exactly one same-currency manual
  // row of the identical amount. Anything else quarantines for review.
  // Rows already matched to a processed provider row by reference stay out
  // of the candidate set so one manual row cannot account twice.
  const processedIds = new Set(
    rows
      .filter((row) => row.status === 'processed')
      .map((row) => String(row.id))
  );
  const manualCandidates: number[] = [];
  for (const item of knownRefunds) {
    if (item.status !== 'completed') continue;
    if (item.metadata?.method !== 'paystack') continue;
    if (
      normalizeRefundMoneyField(item.currency) !==
      normalizeRefundMoneyField(currency)
    )
      continue;
    if (
      item.gateway_reference != null &&
      processedIds.has(item.gateway_reference.trim())
    )
      continue;
    const kobo = Math.round(Number(item.amount) * 100);
    if (!Number.isSafeInteger(kobo) || kobo <= 0) continue;
    manualCandidates.push(kobo);
  }
  for (const row of rows) {
    // Failed provider rows moved no money, so they skip both the
    // amount/currency gate and the pairing below: a failed row must never
    // strand the refund behind review.
    if (row.status === 'failed') continue;
    const known = knownRefunds.find(
      (item) => (item.gateway_reference ?? '').trim() === String(row.id)
    );
    if (
      normalizeRefundMoneyField(row.currency) !==
        normalizeRefundMoneyField(currency) ||
      (known && Math.round(Number(known.amount) * 100) !== row.amount)
    )
      return quarantine('Paystack refund amount or currency mismatch', {
        provider_refund_id: row.id,
      });
    if (
      (known?.status === 'completed' || known?.status === 'refunded') &&
      row.status === 'processed'
    )
      continue;
    if (row.status === 'processed') {
      const pair = manualCandidates.indexOf(row.amount);
      if (pair !== -1) {
        manualCandidates.splice(pair, 1);
        continue;
      }
    }
    return quarantine(
      'An existing Paystack refund requires reconciliation before retry',
      { provider_refund_id: row.id, provider_refund_status: row.status }
    );
  }
  // An unpaired manual candidate means the merchant claimed Paystack money
  // the provider does not confirm. That is either a mis-recorded method or
  // money that never moved — quarantine for review instead of passing.
  if (manualCandidates.length > 0)
    return quarantine(
      'Manual Paystack refunds exceed provider-confirmed amounts; review required',
      { unpaired_manual_kobo: manualCandidates }
    );
}
