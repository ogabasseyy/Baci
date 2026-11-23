import type { SupabaseClient } from '@supabase/supabase-js';
import type { GatewayPaymentTransaction } from './gateway-payment-transaction';
import { quarantineRefund } from './quarantine-order-cancellation-refund';

export type BankOfferRefundEvidence = {
  p_order_id: string;
  p_merchant_id: string;
  p_transaction_id: string;
  p_reference: string;
  p_claim_token: string;
  p_provider_id: string;
  p_provider_domain: string;
  p_amount_kobo: number;
};

export async function beginBankCardOfferRefundDispatch({
  evidence,
  order,
  refundIds,
  supabase,
  transaction,
}: {
  evidence: BankOfferRefundEvidence;
  order: { currency: string | null; id: string; merchant_id: string };
  refundIds: readonly number[];
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
  transaction: GatewayPaymentTransaction;
}): Promise<'unavailable' | 'dispatch' | 'blocked' | 'already_admitted'> {
  const admission = await supabase.rpc(
    'begin_bank_card_offer_refund_dispatch',
    evidence
  );
  if (admission.error) return 'unavailable';
  if (admission.data === 'dispatch') return 'dispatch';
  if (admission.data !== 'already_admitted') return 'blocked';

  // An interrupted worker may have sent the POST. Resolve that
  // uncertainty against Paystack before trying a replacement.
  await quarantineRefund({
    metadata: {
      accepted_refund_ids: refundIds,
      failed_payment_transaction_id: transaction.id,
      ambiguous_initiation: true,
    },
    order,
    reason: 'Reconcile the previously admitted bank-offer refund with Paystack',
    supabase,
    transactions: [transaction],
  });
  return 'already_admitted';
}
