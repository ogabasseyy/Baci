import type { SupabaseClient } from '@supabase/supabase-js';
import type { BankCardOfferTerminalStatus } from '@/schemas/bank-card-offer-terminal-status';
import { approveBankCardOfferPayment } from './approve-bank-card-offer-payment';
import { completeOrderGatewayPayment } from './complete-order-gateway-payment';

export async function resolveBankCardOfferGatewayCompletion({
  actor,
  expectedBankOfferTerminalStatus,
  expectedOutstandingMinor,
  gateway,
  merchantId,
  orderId,
  reference,
  scopedClient,
  signal,
  supabase,
  transactionId,
}: {
  actor: string;
  expectedBankOfferTerminalStatus?: BankCardOfferTerminalStatus;
  expectedOutstandingMinor?: number | null;
  gateway: 'juicyway' | 'paystack' | 'korapay';
  merchantId: string;
  orderId: string;
  reference: string;
  scopedClient: SupabaseClient;
  signal?: AbortSignal;
  supabase: SupabaseClient;
  transactionId: string;
}) {
  const verified =
    gateway === 'paystack'
      ? await approveBankCardOfferPayment({
          client: scopedClient,
          expectedTerminalStatus: expectedBankOfferTerminalStatus,
          merchantId,
          orderId,
          reference,
          signal,
          transactionId,
        })
      : null;
  if (verified?.kind === 'pending' || verified?.kind === 'unavailable') {
    return {
      ok: false as const,
      outcome: {
        kind: 'bank_offer_verification_wait' as const,
        providerUnavailable: verified.kind === 'unavailable',
      },
    };
  }
  if (!verified) {
    return {
      ok: false as const,
      outcome: {
        kind: 'completion_failed' as const,
        error: new Error('bank_card_offer_verification_required'),
      },
    };
  }
  if (verified.kind === 'terminal') {
    const review = await scopedClient.rpc(
      'flag_bank_card_offer_terminal_review',
      {
        p_order_id: orderId,
        p_merchant_id: merchantId,
        p_transaction_id: transactionId,
        p_status: verified.status,
        ...(verified.reportedReversalAmountKobo !== undefined
          ? { p_reported_amount_kobo: verified.reportedReversalAmountKobo }
          : {}),
      }
    );
    if (review.error || review.data !== true) {
      return {
        ok: false as const,
        outcome: {
          kind: 'completion_failed' as const,
          error:
            review.error ??
            new Error('bank_card_offer_terminal_review_unavailable'),
        },
      };
    }
    return {
      ok: false as const,
      outcome: {
        kind: 'bank_offer_terminal' as const,
        status: verified.status,
      },
    };
  }
  if (verified.kind === 'mismatch') {
    // Open review uniqueness on issue type plus transaction/reference
    // makes repeated polling safe. A duplicate already has an ops review.
    const review = await supabase.from('reconciliation_review').insert({
      issue_type: 'payment_match_ambiguous',
      merchant_id: merchantId,
      order_id: orderId,
      txn_id: transactionId,
      paystack_ref: reference,
      reason: 'Paystack verification does not match the saved bank card offer',
      metadata: { source: 'bank_card_offer_capture' },
    });
    if (review.error && review.error.code !== '23505') {
      return {
        ok: false as const,
        outcome: {
          kind: 'completion_failed' as const,
          error: review.error,
        },
      };
    }
    return {
      ok: false as const,
      outcome: { kind: 'bank_offer_capture_review' as const },
    };
  }
  const result = await completeOrderGatewayPayment({
    actor,
    expectedOutstandingMinor,
    gatewayResponse: verified.gatewayResponse,
    orderId,
    supabase,
    transactionId,
  });
  if (!result.ok || result.completion.error_code) {
    return {
      ok: false as const,
      outcome: {
        kind: 'completion_failed' as const,
        error: result.ok ? result.completion : result.error,
      },
    };
  }
  return {
    ...result,
    redvaultDuplicate: false,
    redvaultInventoryConfirmed: false,
    verifiedGatewayResponse: verified.gatewayResponse,
    atomicTransactionFlip: result.completion.already_completed === false,
  };
}
