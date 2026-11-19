import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyBankCardOfferAttempt } from '@/lib/checkout/bank-card-offer-payment';
import { verifyTransaction } from '@/lib/paystack';
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
  const { amountKobo, quote } = context.data;
  const result = await verifyTransaction(reference, undefined, {
    textIds: true,
  });
  if (!result.success) return null;
  const evidence = verifyBankCardOfferAttempt(
    {
      ...context.data,
      currency: 'NGN',
      adjustmentsKobo:
        amountKobo - (quote.productSubtotalKobo - quote.discountKobo),
    },
    { status: true, data: result.data }
  );
  if (!evidence) return null;

  const approval = await client.rpc('approve_bank_card_offer_capture', {
    ...args,
    p_evidence: evidence,
  });
  if (approval.error || approval.data !== true) return null;
  return { ...result.data };
}
