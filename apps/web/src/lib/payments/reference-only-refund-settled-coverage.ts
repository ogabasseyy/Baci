import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Whether settled local rows already reconcile a reference-only refund
 * event's payment, so the event stays silent as a late duplicate.
 * Suppress only on coverage the completion RPC would accept: a locally
 * completed row that provider verification later rejects must not
 * discard this event, since a reference-only event carries no refund ID
 * for polling to rediscover. Partial coverage must not suppress
 * either: a 40 NGN verified refund against a 100 NGN payment leaves a
 * balance this event may be the only evidence for. Shared by the
 * cancellation and non-cancellation reference-only filers: both queues
 * describe the same settled state, only the routing differs.
 */
export async function referenceOnlyRefundCoveredBySettledRows(
  supabase: SupabaseClient,
  {
    amount,
    currency,
    merchantId,
    orderId,
    paymentId,
  }: {
    amount: number;
    currency: string;
    merchantId: string;
    orderId: string;
    paymentId: string;
  }
): Promise<boolean> {
  const { data: settled, error: settledError } = await supabase
    .from('transactions')
    .select('amount, currency, metadata')
    .eq('order_id', orderId)
    .eq('merchant_id', merchantId)
    .eq('transaction_type', 'refund')
    .eq('gateway', 'paystack')
    .eq('metadata->>payment_transaction_id', paymentId)
    .eq('status', 'completed');
  if (settledError) throw new Error('refund_event_lookup_failed');
  const linkedCovered = (
    (settled ?? []) as Array<{
      amount: number | string;
      currency: string | null;
      metadata: { provider_refund_status?: unknown } | null;
    }>
  )
    .filter(
      (row) =>
        row.metadata?.provider_refund_status === 'processed' &&
        (row.currency ?? '').toUpperCase() === currency.toUpperCase()
    )
    .reduce((total, row) => total + (Number(row.amount) || 0), 0);
  if (amount > 0 && linkedCovered >= amount) {
    return true;
  }

  // Legacy refunds carry no payment link. Mirror the completion RPC's
  // sole-external-payment rule: when the order's single completed
  // external payment is a Paystack leg covered by unlinked completed
  // refunds, the payment is already reconciled. Filing here would leave
  // a permanent false review — without a provider refund ID no closer
  // could ever resolve it.
  const { data: externalPayments, error: paymentsError } = await supabase
    .from('transactions')
    .select('amount, currency, gateway')
    .eq('order_id', orderId)
    .eq('merchant_id', merchantId)
    .eq('transaction_type', 'payment')
    .eq('status', 'completed')
    .gt('amount', 0)
    .not(
      'gateway',
      'in',
      '(wallet,savings,store_credit,cash,manual,pay_on_delivery)'
    );
  if (paymentsError) throw new Error('refund_event_lookup_failed');
  if ((externalPayments ?? []).length === 1) {
    const sole = (
      externalPayments as Array<{
        amount: number | string;
        currency: string | null;
        gateway: string;
      }>
    )[0] as {
      amount: number | string;
      currency: string | null;
      gateway: string;
    };
    if (sole.gateway === 'paystack') {
      const { data: legacyRefunds, error: legacyError } = await supabase
        .from('transactions')
        .select('amount, currency, metadata')
        .eq('order_id', orderId)
        .eq('merchant_id', merchantId)
        .eq('transaction_type', 'refund')
        .eq('gateway', 'paystack')
        .eq('status', 'completed')
        .is('metadata->>payment_transaction_id', null);
      if (legacyError) throw new Error('refund_event_lookup_failed');
      // Sum only provider-verified same-currency rows, mirroring the
      // completion gate: unverified local rows may yet be rejected.
      const covered = (
        (legacyRefunds ?? []) as Array<{
          amount: number | string;
          currency: string | null;
          metadata: { provider_refund_status?: unknown } | null;
        }>
      )
        .filter(
          (row) =>
            row.metadata?.provider_refund_status === 'processed' &&
            (row.currency ?? '').toUpperCase() ===
              (sole.currency ?? '').toUpperCase()
        )
        .reduce((total, row) => total + (Number(row.amount) || 0), 0);
      if (covered >= Number(sole.amount)) return true;
    }
  }
  return false;
}
