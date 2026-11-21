import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyTransaction } from '@/lib/paystack';
import type { BankOfferRefundEvidence } from './begin-bank-card-offer-refund-dispatch';
import { parseBankOfferRefundableKobo } from './parse-bank-offer-refundable-kobo';

const VERIFY_BUDGET_MS = 8_000;

type CaptureIdentity = Pick<
  BankOfferRefundEvidence,
  'p_order_id' | 'p_merchant_id' | 'p_transaction_id' | 'p_reference'
>;

type RefundVerification =
  | { kind: 'verified'; evidence: BankOfferRefundEvidence }
  | { kind: 'unavailable' | 'mismatch' | 'deadline' };

export async function verifyBankOfferRefundEvidence({
  claimToken,
  identity,
  supabase,
  verifyDeadlineMs,
}: {
  claimToken: string;
  identity: CaptureIdentity;
  supabase: Pick<SupabaseClient, 'rpc'>;
  verifyDeadlineMs?: number;
}): Promise<RefundVerification> {
  const capture = await supabase.rpc(
    'get_bank_card_offer_refundable_amount',
    identity
  );
  if (capture.error) return { kind: 'unavailable' };
  const amountKobo = parseBankOfferRefundableKobo(capture.data);
  if (!amountKobo) return { kind: 'mismatch' };

  const verifyBudgetMs =
    verifyDeadlineMs === undefined
      ? VERIFY_BUDGET_MS
      : Math.min(VERIFY_BUDGET_MS, verifyDeadlineMs - Date.now());
  if (verifyBudgetMs <= 0) return { kind: 'deadline' };

  const reference = identity.p_reference;
  const verification = await verifyTransaction(
    reference,
    AbortSignal.timeout(verifyBudgetMs),
    { textIds: true }
  );
  if (!verification.success) return { kind: 'unavailable' };

  const { data } = verification;
  if (
    data?.status !== 'success' ||
    data.reference !== reference ||
    typeof data.currency !== 'string' ||
    data.currency.toUpperCase() !== 'NGN' ||
    data.amount !== amountKobo ||
    typeof data.id !== 'string' ||
    !/^[1-9][0-9]*$/.test(data.id) ||
    !('domain' in data) ||
    (data.domain !== 'test' && data.domain !== 'live')
  ) {
    return { kind: 'mismatch' };
  }
  return {
    kind: 'verified',
    evidence: {
      ...identity,
      p_claim_token: claimToken,
      p_provider_id: data.id,
      p_provider_domain: data.domain,
      p_amount_kobo: amountKobo,
    },
  };
}
