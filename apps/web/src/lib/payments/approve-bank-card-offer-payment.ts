import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyBankCardOfferPaystack } from '@/lib/checkout/verify-bank-card-offer-paystack';
import type { BankCardOfferTerminalStatus } from '@/schemas/bank-card-offer-terminal-status';
import { bankCardOfferVerificationContextSchema } from '@/schemas/bank-card-offer-verification-context';

export async function approveBankCardOfferPayment({
  client,
  merchantId,
  orderId,
  transactionId,
  reference,
  expectedTerminalStatus,
  signal,
}: {
  client: Pick<SupabaseClient, 'rpc'>;
  merchantId: string;
  orderId: string;
  transactionId: string;
  reference: string;
  expectedTerminalStatus?: BankCardOfferTerminalStatus;
  signal?: AbortSignal;
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
  // Saved approval survives a failed completion, but Paystack can reverse
  // the capture afterwards. Recheck the provider before any settlement retry.
  const { amountKobo, quote } = context.data;
  const verified = await verifyBankCardOfferPaystack(
    {
      ...context.data,
      currency: 'NGN',
      adjustmentsKobo:
        amountKobo - (quote.productSubtotalKobo - quote.discountKobo),
    },
    signal
  );
  if (expectedTerminalStatus) {
    return verified?.kind === 'terminal' &&
      verified.status === expectedTerminalStatus
      ? verified
      : null;
  }
  if (verified?.kind !== 'verified') return verified;

  const approval = await client.rpc('approve_bank_card_offer_capture', {
    ...args,
    p_evidence: verified.evidence,
    p_gateway_response: verified.gatewayResponse,
  });
  if (approval.error || approval.data !== true) return null;
  return verified;
}
