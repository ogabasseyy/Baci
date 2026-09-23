import type { SupabaseClient } from '@supabase/supabase-js';
import { recordRepairPickupPaymentMismatch } from '@/lib/repairs/record-repair-pickup-payment-mismatch';
import { resolveTrustedRepairPickupMismatchBinding } from '@/lib/repairs/resolve-trusted-repair-pickup-mismatch-binding';

type ClaimMismatchResult = {
  handled: true;
  status: number;
  body: { message: string };
};

function mismatchReasonFor(input: {
  claim: { amountKobo: number; currency: string; reference: string } | null;
  currency: string;
  reference: string;
  verifiedAmount: number;
}): string {
  if (!input.claim) return 'claim_missing_or_invalid';
  if (input.claim.reference !== input.reference) return 'reference_mismatch';
  if (input.claim.amountKobo !== Math.round(input.verifiedAmount * 100)) {
    return 'amount_mismatch';
  }
  if (input.claim.currency !== input.currency) return 'currency_mismatch';
  return 'claim_mismatch';
}

/** Ledger a claim mismatch only when merchant/repair identity is trusted. */
export async function ledgerRepairPickupPaymentClaimMismatch(input: {
  claim: {
    amountKobo: number;
    currency: string;
    merchantId: string;
    reference: string;
    repairId: string;
  } | null;
  currency: string;
  gatewayResponse: Record<string, unknown>;
  reference: string;
  supabase: SupabaseClient;
  verifiedAmount: number;
}): Promise<ClaimMismatchResult> {
  console.error('Repair pickup payment claim mismatch:', {
    claimVerified: Boolean(input.claim),
    reference: input.reference,
  });
  const binding = await resolveTrustedRepairPickupMismatchBinding({
    claim: input.claim,
    reference: input.reference,
    supabase: input.supabase,
  });
  if (binding.kind === 'lookup_failed') {
    return {
      handled: true,
      status: 503,
      body: {
        message: 'Repair pickup payment mismatch will retry until durable',
      },
    };
  }
  if (binding.kind === 'orphan') {
    console.error(
      'Repair pickup payment mismatch orphan (no trusted binding):',
      { reference: input.reference }
    );
    return {
      handled: true,
      status: 200,
      body: { message: 'Repair pickup payment mismatch ignored (unbound)' },
    };
  }
  const recorded = await recordRepairPickupPaymentMismatch({
    currency: input.currency || 'XXX',
    gatewayResponse: input.gatewayResponse,
    merchantId: binding.merchantId,
    mismatchReason: mismatchReasonFor({
      claim: input.claim,
      currency: input.currency,
      reference: input.reference,
      verifiedAmount: input.verifiedAmount,
    }),
    reference: input.reference,
    repairId: binding.repairId,
    supabase: input.supabase,
    verifiedAmount: input.verifiedAmount,
  });
  if (!recorded) {
    return {
      handled: true,
      status: 503,
      body: {
        message: 'Repair pickup payment mismatch will retry until durable',
      },
    };
  }
  return {
    handled: true,
    status: 200,
    body: { message: 'Repair pickup payment requires review' },
  };
}
