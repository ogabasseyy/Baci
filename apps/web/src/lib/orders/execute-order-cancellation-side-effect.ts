import type { SupabaseClient } from '@supabase/supabase-js';
import { executeCustomerEmailCancellationSideEffect } from '@/lib/orders/execute-customer-email-cancellation-side-effect';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { initiatePaystackCancellationRefunds } from '@/lib/orders/initiate-paystack-cancellation-refunds';
import { isExternalPaymentGateway } from '@/lib/orders/is-external-payment-gateway';
import type {
  CancellationEmailSender,
  CancellationMerchant,
  CancellationOrder,
} from '@/lib/orders/order-cancellation-side-effect-types';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import {
  DeferredError,
  type OrderCancellationSideEffectStep,
} from '@/lib/orders/run-order-cancellation-side-effect';
import { unsupportedRefundReasons } from '@/lib/orders/unsupported-refund-reasons';

export async function executeOrderCancellationSideEffect({
  deadlineMs,
  merchant,
  order,
  reason,
  sendCancellationEmail,
  step,
  supabase,
}: {
  deadlineMs?: number;
  merchant: CancellationMerchant;
  order: CancellationOrder;
  reason?: string;
  sendCancellationEmail?: CancellationEmailSender;
  step: OrderCancellationSideEffectStep;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
}): Promise<{ messageId: string | null } | { refundIds: number[] }> {
  if (step === 'customer_email') {
    return executeCustomerEmailCancellationSideEffect({
      deadlineMs,
      merchant,
      order,
      reason,
      sendCancellationEmail,
    });
  }

  // Mirror the completion gate's funded-leg statuses: refund-state legs
  // (e.g. PayPal flips the payment row itself while its provider refund
  // is pending) must stay visible so they quarantine or defer instead of
  // slipping to false completion.
  const { data: transactionRows, error: transactionError } = await supabase
    .from('transactions')
    .select('id, amount, currency, gateway, gateway_reference, status')
    .eq('order_id', order.id)
    .eq('merchant_id', order.merchant_id)
    .eq('transaction_type', 'payment')
    .in('status', ['completed', 'refund_pending'])
    .order('created_at', { ascending: true });
  if (transactionError || !transactionRows?.length) {
    throw new Error('No completed payment transaction found');
  }
  const transactions = (transactionRows as GatewayPaymentTransaction[]).filter(
    (transaction) => isExternalPaymentGateway(transaction.gateway)
  );
  if (!transactions.length) {
    throw new Error('No completed gateway payment transaction found');
  }
  const unsupportedLegs = transactions.filter(
    (transaction) =>
      transaction.gateway !== 'paystack' || !transaction.gateway_reference
  );
  if (unsupportedLegs.length > 0) {
    const unsupportedReasons = unsupportedRefundReasons(unsupportedLegs);
    await quarantineRefund({
      order,
      preflight: true,
      reason: `Automatic cancellation refund requires review: ${unsupportedReasons.join(', ')}`,
      supabase,
      transactions,
    });
  }
  const gatewayRefundAmount = transactions.reduce(
    (total, transaction) => total + (Number(transaction.amount) || 0),
    0
  );
  if (
    gatewayRefundAmount <= 0 ||
    transactions.some((transaction) => Number(transaction.amount) <= 0)
  ) {
    throw new Error('Completed payment transaction has no refundable amount');
  }
  const { data: refundRows, error: refundLookupError } = await supabase
    .from('transactions')
    .select('gateway_reference, metadata, status, amount, currency, gateway')
    .eq('order_id', order.id)
    .eq('merchant_id', order.merchant_id)
    .eq('transaction_type', 'refund')
    .order('created_at', { ascending: true });
  if (refundLookupError) {
    throw new Error('Unable to verify existing cancellation refunds');
  }
  const linkedPaymentId = (row: { metadata: unknown }): string | null => {
    const metadata = row.metadata as {
      payment_transaction_id?: unknown;
    } | null;
    const paymentId = metadata?.payment_transaction_id;
    return typeof paymentId === 'string' &&
      transactions.some((transaction) => transaction.id === paymentId)
      ? paymentId
      : null;
  };
  const unlinkedRefunds = (refundRows ?? []).filter(
    (row) => linkedPaymentId(row) === null
  );
  if (unlinkedRefunds.length > 0) {
    await quarantineRefund({
      metadata: { unlinked_refund_count: unlinkedRefunds.length },
      order,
      preflight: true,
      reason:
        'An existing refund cannot be linked to a payment leg; verify it before another provider refund',
      supabase,
      transactions,
    });
  }
  // A completed row marks its leg refunded only when it matches the
  // leg's own gateway and currency and the matched rows cover the full
  // leg amount: a partial or foreign row must quarantine for
  // reconciliation instead of silently skipping the remaining balance.
  // Paystack rows count only after provider verification, mirroring the
  // completion RPC; unverified rows wait for the verification workers
  // instead of triggering another provider refund.
  const normalizeMoneyField = (value: unknown): string =>
    String(value ?? '')
      .trim()
      .toUpperCase();
  const legById = new Map(transactions.map((leg) => [leg.id, leg]));
  const matchedRefundKobo = new Map<string, number>();
  const completedLinkedLegIds = new Set<string>();
  const unverifiedLinkedLegIds = new Set<string>();
  for (const row of refundRows ?? []) {
    if (row.status !== 'completed') continue;
    const paymentId = linkedPaymentId(row);
    if (paymentId === null) continue;
    completedLinkedLegIds.add(paymentId);
    const leg = legById.get(paymentId);
    if (!leg) continue;
    if (
      normalizeMoneyField(row.gateway) !== normalizeMoneyField(leg.gateway) ||
      normalizeMoneyField(row.currency) !== normalizeMoneyField(leg.currency)
    ) {
      continue;
    }
    if (
      normalizeMoneyField(row.gateway) === 'PAYSTACK' &&
      (row.metadata as { provider_refund_status?: unknown } | null)
        ?.provider_refund_status !== 'processed'
    ) {
      unverifiedLinkedLegIds.add(paymentId);
      continue;
    }
    const rowKobo = Math.round(Number(row.amount) * 100);
    if (!Number.isSafeInteger(rowKobo) || rowKobo <= 0) continue;
    matchedRefundKobo.set(
      paymentId,
      (matchedRefundKobo.get(paymentId) ?? 0) + rowKobo
    );
  }
  const refundedPaymentIds = new Set<string>();
  const mismatchedTransactions: GatewayPaymentTransaction[] = [];
  for (const leg of transactions) {
    const legKobo = Math.round(Number(leg.amount) * 100);
    if ((matchedRefundKobo.get(leg.id) ?? 0) >= legKobo) {
      refundedPaymentIds.add(leg.id);
    } else if (completedLinkedLegIds.has(leg.id)) {
      mismatchedTransactions.push(leg);
    }
  }
  const mismatchedIds = new Set(
    mismatchedTransactions.map((transaction) => transaction.id)
  );
  // Legs with a provider-accepted audit row are still in flight: the
  // reconciler completes them and the drain resumes the remaining legs.
  // Only legs without provider evidence (failed or ambiguous rows) need a
  // terminal quarantine review.
  const awaitingRefundPaymentIds = new Set<string>();
  const reviewRefundPaymentIds = new Set<string>();
  for (const row of refundRows ?? []) {
    if (row.status === 'completed') continue;
    const paymentId = linkedPaymentId(row);
    if (typeof paymentId !== 'string') continue;
    if (
      row.status === 'refund_pending' &&
      typeof row.gateway_reference === 'string' &&
      /^[1-9][0-9]*$/.test(row.gateway_reference)
    ) {
      awaitingRefundPaymentIds.add(paymentId);
    } else {
      reviewRefundPaymentIds.add(paymentId);
    }
  }
  const pendingTransactions = transactions.filter((transaction) =>
    reviewRefundPaymentIds.has(transaction.id)
  );
  if (pendingTransactions.length > 0) {
    await quarantineRefund({
      order,
      preflight: true,
      reason: 'A previously accepted cancellation refund is not terminal',
      supabase,
      transactions: pendingTransactions,
    });
  }
  // A leg stuck in refund_pending has its provider refund in flight
  // without a separate audit row: defer it like an accepted row so the
  // step waits instead of initiating a duplicate.
  const awaitingTransactions = transactions.filter(
    (transaction) =>
      (awaitingRefundPaymentIds.has(transaction.id) ||
        transaction.status === 'refund_pending') &&
      !refundedPaymentIds.has(transaction.id)
  );
  // Legs whose only completed rows are still unverified wait for the
  // verification workers: skipping them would strand a demotion, and
  // initiating alongside them would double-refund a real row.
  const unverifiedTransactions = transactions.filter(
    (transaction) =>
      !refundedPaymentIds.has(transaction.id) &&
      unverifiedLinkedLegIds.has(transaction.id)
  );
  if (awaitingTransactions.length > 0 || unverifiedTransactions.length > 0) {
    // Defer without consuming a retry attempt: only provider
    // reconciliation can change this condition, and burning the
    // five-attempt budget on it would strand the remaining legs
    // permanently once the pending refund completes.
    throw new DeferredError('cancellation_refund_awaiting_provider_completion');
  }
  // Withhold mismatched legs from initiation: their completed rows do not
  // cover them in matching money, so a full-leg provider refund now would
  // double-refund the covered portion. Clean legs still move below.
  const refundIds = await initiatePaystackCancellationRefunds({
    deadlineMs,
    order,
    reason,
    refundedPaymentIds,
    supabase,
    transactions: transactions.filter(
      (transaction) => !mismatchedIds.has(transaction.id)
    ),
  });
  if (mismatchedTransactions.length > 0) {
    await quarantineRefund({
      metadata: { mismatched_leg_count: mismatchedTransactions.length },
      order,
      preflight: true,
      reason:
        'Completed cancellation refunds do not cover their payment legs; verify amounts before another provider refund',
      supabase,
      transactions: mismatchedTransactions,
    });
  }
  return { refundIds };
}
