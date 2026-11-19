import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyBankCardOfferPaystack } from '@/lib/checkout/verify-bank-card-offer-paystack';
import { bankCardOfferVerificationContextSchema } from '@/schemas/bank-card-offer-payment-context';

export async function approveBankCardOfferPayment({
  client,
  merchantId,
  orderId,
  transactionId,
  reference,
}: {
  client: Pick<SupabaseClient, 'rpc'>;
  merchantId: string;
  orderId: string;
  transactionId: string;
  reference: string;
}) {
  const args = {
    p_merchant_id: merchantId,
    p_order_id: orderId,
    p_transaction_id: transactionId,
  };
  const { data, error } = await client.rpc(
    'get_bank_card_offer_verification_context',
    args
  );
  const context = bankCardOfferVerificationContextSchema.safeParse(data);
  if (
    error ||
    !context.success ||
    context.data.reference !== reference ||
    context.data.quote.merchantId !== merchantId
  ) {
    return null;
  }
  // The database only returns this payload for a completed transaction
  // tied to the same saved offer and its persisted approval evidence.
  if (context.data.completedGatewayResponse) {
    return {
      kind: 'verified',
      gatewayResponse: context.data.completedGatewayResponse,
    } as const;
  }
  const { amountKobo, quote } = context.data;
  const verified = await verifyBankCardOfferPaystack({
    ...context.data,
    currency: 'NGN',
    adjustmentsKobo:
      amountKobo - (quote.productSubtotalKobo - quote.discountKobo),
  });
  if (!verified || verified.kind === 'mismatch') return verified;

  const approval = await client.rpc('approve_bank_card_offer_capture', {
    ...args,
    p_evidence: verified.evidence,
  });
  if (approval.error || approval.data !== true) return null;
  return verified;
}
