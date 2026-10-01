import type { SupabaseClient } from '@supabase/supabase-js';
import { findPaidRepairPickupByReference } from '@/lib/repairs/find-paid-repair-pickup-by-reference';
import { fulfillRepairPickupAfterPayment } from '@/lib/repairs/fulfill-repair-pickup-after-payment';
import { isRepairPickupPaymentConflictError } from '@/lib/repairs/is-repair-pickup-payment-conflict-error';
import { ledgerRepairPickupPaymentClaimMismatch } from '@/lib/repairs/ledger-repair-pickup-payment-claim-mismatch';
import { recordRepairPickupPaymentMismatch } from '@/lib/repairs/record-repair-pickup-payment-mismatch';
import { repairPickupPaymentClaims } from '@/lib/repairs/repair-pickup-payment-claim';

type RepairPickupPaymentHandlingResult =
  | { handled: false }
  | {
      handled: true;
      status: number;
      body: { message: string; trackingNumber?: string };
    };

interface HandleRepairPickupPaymentInput {
  gateway: 'paystack' | 'korapay';
  gatewayResponse: Record<string, unknown>;
  reference: string;
  supabase: SupabaseClient;
  verifiedAmount: number;
}

function getConfirmed(value: unknown): boolean | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') return null;
  const confirmed = (row as Record<string, unknown>).confirmed;
  return typeof confirmed === 'boolean' ? confirmed : null;
}

async function readPickupPaymentStatus(
  supabase: SupabaseClient,
  claim: { merchantId: string; repairId: string }
): Promise<{ ok: true; status: string | null } | { ok: false }> {
  const { data, error } = await supabase
    .from('repairs')
    .select('pickup_payment_status')
    .eq('id', claim.repairId)
    .eq('merchant_id', claim.merchantId)
    .maybeSingle();
  if (error) {
    console.error('Repair pickup payment status lookup failed:', error);
    return { ok: false };
  }
  const status =
    data && typeof data === 'object'
      ? (data as { pickup_payment_status?: unknown }).pickup_payment_status
      : null;
  return {
    ok: true,
    status: typeof status === 'string' ? status : null,
  };
}

export async function handleRepairPickupPayment({
  gateway,
  gatewayResponse,
  reference,
  supabase,
  verifiedAmount,
}: HandleRepairPickupPaymentInput): Promise<RepairPickupPaymentHandlingResult> {
  const metadata = gatewayResponse.metadata;
  if (
    gateway !== 'paystack' ||
    !metadata ||
    typeof metadata !== 'object' ||
    (metadata as Record<string, unknown>).transaction_type !== 'repair_pickup'
  ) {
    return { handled: false };
  }

  const claim = repairPickupPaymentClaims.verify(
    metadata,
    process.env.PAYSTACK_SECRET_KEY ?? ''
  );
  const currency =
    typeof gatewayResponse.currency === 'string'
      ? gatewayResponse.currency.toUpperCase()
      : '';
  if (
    !claim ||
    claim.reference !== reference ||
    claim.amountKobo !== Math.round(verifiedAmount * 100) ||
    claim.currency !== currency
  ) {
    const paid = await findPaidRepairPickupByReference({
      reference,
      supabase,
      verifiedAmount,
    });
    if (paid.kind === 'lookup_failed') {
      return {
        handled: true,
        status: 503,
        body: {
          message: 'Repair pickup payment mismatch will retry until durable',
        },
      };
    }
    if (paid.kind === 'found') {
      // Already-captured repair: continue booking without the rotated claim key.
      return fulfillRepairPickupAfterPayment({
        merchantId: paid.repair.merchantId,
        pickupPaymentStatus: paid.repair.pickupPaymentStatus,
        reference,
        repairId: paid.repair.repairId,
        supabase,
      });
    }
    return ledgerRepairPickupPaymentClaimMismatch({
      claim,
      currency,
      gatewayResponse,
      reference,
      supabase,
      verifiedAmount,
    });
  }

  const { data, error } = await supabase.rpc('confirm_repair_pickup_payment', {
    p_amount: verifiedAmount,
    p_currency: currency,
    p_gateway_response: gatewayResponse,
    p_merchant_id: claim.merchantId,
    p_reference: reference,
    p_repair_id: claim.repairId,
  });
  if (error || getConfirmed(data) === null) {
    if (isRepairPickupPaymentConflictError(error)) {
      console.error('Repair pickup payment conflicting capture:', {
        reference,
        repairId: claim.repairId,
      });
      const recorded = await recordRepairPickupPaymentMismatch({
        currency,
        gatewayResponse,
        merchantId: claim.merchantId,
        mismatchReason: 'conflicting_capture',
        reference,
        repairId: claim.repairId,
        supabase,
        verifiedAmount,
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
    console.error('Repair pickup payment confirmation failed:', error);
    return {
      handled: true,
      status: 503,
      body: { message: 'Repair pickup payment confirmation will retry' },
    };
  }

  const pickupPaymentStatus = await readPickupPaymentStatus(supabase, claim);
  if (!pickupPaymentStatus.ok) {
    return {
      handled: true,
      status: 503,
      body: { message: 'Repair pickup payment status lookup will retry' },
    };
  }
  return fulfillRepairPickupAfterPayment({
    merchantId: claim.merchantId,
    pickupPaymentStatus: pickupPaymentStatus.status,
    reference,
    repairId: claim.repairId,
    supabase,
  });
}
