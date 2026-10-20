import type { SupabaseClient } from '@supabase/supabase-js';
import { isExternalPaymentGateway } from '@/lib/orders/is-external-payment-gateway';
import { normalizePaymentGateway } from './normalize-payment-gateway';

// Provider-backed detection for the customer email: a manual-only
// refund (cash handed over, transfer already sent) must not promise
// a provider timeline, while provider money needs the bank/card
// arrival guidance. Failed provider attempts moved no money, so
// only terminal rows count; unknown or blank gateways fail toward
// the provider copy. A verified manual Paystack attestation stays
// stored as gateway manual but is provider money, so its method
// metadata counts too; unverified claims must not promise a
// provider timeline. Self-terminal provider refunds (PayPal flips
// the payment row itself) leave no refund row at all, so refunded
// external payments count as well — internal legs reverse through
// their own ledgers, never bank/card.
export async function isProviderBackedRefund({
  merchantId,
  orderId,
  supabase,
}: {
  merchantId: string;
  orderId: string;
  supabase: Pick<SupabaseClient, 'from'>;
}): Promise<boolean> {
  const { data: refundRows, error: refundError } = await supabase
    .from('transactions')
    .select('gateway, metadata')
    .eq('order_id', orderId)
    .eq('merchant_id', merchantId)
    .eq('transaction_type', 'refund')
    .in('status', ['completed', 'refunded']);
  if (refundError) {
    throw new Error('refund_notification_ledger_lookup_failed');
  }
  const refundRowProviderBacked = (refundRow: unknown): boolean => {
    const row = refundRow as {
      gateway: unknown;
      metadata?: {
        method?: unknown;
        provider_refund_status?: unknown;
      } | null;
    };
    if (normalizePaymentGateway(row.gateway) !== 'MANUAL') return true;
    return (
      row.metadata?.method === 'paystack' &&
      row.metadata?.provider_refund_status === 'processed'
    );
  };
  if (((refundRows ?? []) as unknown[]).some(refundRowProviderBacked)) {
    return true;
  }
  const { data: flippedPaymentRows, error: flippedPaymentError } =
    await supabase
      .from('transactions')
      .select('gateway')
      .eq('order_id', orderId)
      .eq('merchant_id', merchantId)
      .eq('transaction_type', 'payment')
      .eq('status', 'refunded');
  if (flippedPaymentError) {
    throw new Error('refund_notification_ledger_lookup_failed');
  }
  return ((flippedPaymentRows ?? []) as unknown[]).some((paymentRow) =>
    isExternalPaymentGateway((paymentRow as { gateway: string | null }).gateway)
  );
}
