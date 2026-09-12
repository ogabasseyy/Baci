import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { revalidateProducts } from '@/lib/cache-revalidation';
import { getRedvaultPaymentAvailability } from '@/lib/checkout/redvault-payment-availability';
import { logger } from '@/lib/logger';
import { verifyTransaction } from '@/lib/paystack';
import { redvaultApprovedCompletionSchema } from '@/schemas/redvault-approved-completion';
import { redvaultVerificationContextSchema } from '@/schemas/redvault-verification-context';
import { createRedvaultVerifiedPaymentEvidence } from './redvault-payment-gate';

export async function verifyAndCompleteRedvaultPayment({
  merchantId,
  orderId,
  reference,
  supabase,
  transactionId,
}: {
  merchantId: string;
  orderId: string;
  reference: string;
  supabase: Pick<SupabaseClient, 'rpc'>;
  transactionId: string;
}) {
  if (
    merchantId !== OGABASSEY_MERCHANT_ID ||
    !getRedvaultPaymentAvailability().available
  ) {
    return null;
  }
  const { data, error } = await supabase.rpc(
    'get_uba_redvault_verification_context',
    {
      p_order_id: orderId,
      p_transaction_id: transactionId,
    }
  );
  const parsed = redvaultVerificationContextSchema.safeParse(data);
  if (error || !parsed.success) return null;
  const context = parsed.data;
  if (
    context.orderId !== orderId ||
    context.transactionId !== transactionId ||
    context.reference !== reference
  ) {
    return null;
  }
  const verification = await verifyTransaction(context.reference);
  if (!verification.success) return null;
  const evidence = createRedvaultVerifiedPaymentEvidence({
    acceptedFilterPolicyHash: context.acceptedFilterPolicyHash,
    expectedAmountKobo: context.amountKobo,
    expectedCurrency: context.currency,
    expectedCustomerEmail: context.customerEmail,
    expectedDomain: context.verificationDomain,
    expectedIssuerName: context.issuerName,
    expectedReference: context.reference,
    verifyResponse: { status: true, data: verification.data },
  });
  if (!evidence) return null;
  const approved = await supabase.rpc(
    'approve_and_complete_uba_redvault_payment',
    {
      p_order_id: orderId,
      p_transaction_id: transactionId,
      p_verified_evidence: evidence,
    }
  );
  if (approved.error) throw new Error('REDVAULT verified completion failed');
  const result = redvaultApprovedCompletionSchema.parse(approved.data);
  if (result.inventoryReclaimedUnitCount > 0) {
    try {
      revalidateProducts(merchantId);
    } catch {
      logger.warn({
        message: 'REDVAULT inventory cache refresh failed',
        merchantId,
      });
    }
  }
  return result;
}
