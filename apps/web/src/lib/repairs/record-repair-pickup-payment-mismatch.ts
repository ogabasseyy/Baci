import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const uuidSchema = z.uuid();

interface RecordRepairPickupPaymentMismatchInput {
  gatewayResponse: Record<string, unknown>;
  merchantId: string | null;
  mismatchReason: string;
  reference: string;
  repairId: string | null;
  supabase: SupabaseClient;
  verifiedAmount: number;
  currency: string;
}

function getRecorded(value: unknown): boolean | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') return null;
  const recorded = (row as Record<string, unknown>).recorded;
  return typeof recorded === 'boolean' ? recorded : null;
}

/** Best-effort merchant/repair ids from unsigned Paystack metadata (tests / negative cases only). */
export function readRepairPickupMismatchIdentity(metadata: unknown): {
  merchantId: string | null;
  repairId: string | null;
} {
  if (!metadata || typeof metadata !== 'object') {
    return { merchantId: null, repairId: null };
  }
  const record = metadata as Record<string, unknown>;
  const merchantParsed = uuidSchema.safeParse(record.merchant_id);
  const repairParsed = uuidSchema.safeParse(record.repair_id);
  return {
    merchantId: merchantParsed.success ? merchantParsed.data : null,
    repairId: repairParsed.success ? repairParsed.data : null,
  };
}

/**
 * Durably ledger a verified Paystack repair-pickup charge that failed claim
 * validation. Returns false when persistence is unavailable (caller must 503).
 */
export async function recordRepairPickupPaymentMismatch({
  currency,
  gatewayResponse,
  merchantId,
  mismatchReason,
  reference,
  repairId,
  supabase,
  verifiedAmount,
}: RecordRepairPickupPaymentMismatchInput): Promise<boolean> {
  if (!merchantId) {
    console.error('Repair pickup mismatch cannot ledger without merchant_id:', {
      reference,
    });
    return false;
  }

  const { data, error } = await supabase.rpc(
    'record_repair_pickup_payment_mismatch',
    {
      p_amount: verifiedAmount,
      p_currency: currency,
      p_gateway_response: gatewayResponse,
      p_merchant_id: merchantId,
      p_mismatch_reason: mismatchReason,
      p_reference: reference,
      p_repair_id: repairId,
    }
  );

  if (error || getRecorded(data) === null) {
    console.error('Repair pickup payment mismatch persistence failed:', error);
    return false;
  }
  return true;
}
