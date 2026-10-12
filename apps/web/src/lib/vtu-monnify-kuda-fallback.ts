import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type NetworkProvider,
  type PurchaseResult,
  purchaseAirtime,
} from '@/lib/kuda';

/** Minimal row shape the fallback needs (structural; no import cycle). */
export interface MonnifyAirtimeKudaFallbackRow {
  amount: number;
  id: string;
  metadata?: Record<string, unknown> | null;
  phone_number: string;
  request_reference: string;
}

/**
 * Runs the Monnify-airtime → Kuda fallback vend. Persists the Kuda
 * routing BEFORE the call so a result-persist crash still leaves a
 * Kuda-reconcilable row (TSQ by request_reference); without the
 * marker the row keeps provider=monnify with no vend reference and
 * strands charged with no terminal result. Fail closed: if the
 * marker write fails, the Monnify rejection is returned unsettled
 * and Kuda is never called (nothing delivered → refund path).
 * Extracted from vtu-fulfillment.ts per the Boy Scout Rule.
 */
export async function executeMonnifyAirtimeKudaFallback({
  customerFirstName,
  monnifyResult,
  provider,
  row,
  supabase,
}: {
  customerFirstName: string;
  monnifyResult: PurchaseResult;
  provider: NetworkProvider;
  row: MonnifyAirtimeKudaFallbackRow;
  supabase: SupabaseClient;
}): Promise<PurchaseResult & { metadataPatch?: Record<string, string> }> {
  const kudaFallbackPatch = {
    fulfillmentProvider: 'kuda',
    monnifyFallbackError:
      monnifyResult.providerErrorDetail ?? monnifyResult.message,
    originalProvider: 'monnify',
    provider: 'kuda',
    providerFallback: 'monnify_airtime_to_kuda',
  };
  const { error: fallbackMarkerError } = await supabase
    .from('vtu_transactions')
    .update({
      metadata: { ...(row.metadata ?? {}), ...kudaFallbackPatch },
    })
    .eq('id', row.id);
  if (fallbackMarkerError) {
    console.error('Failed to persist Kuda fallback routing:', {
      error: fallbackMarkerError.message,
      transactionId: row.id,
    });
    return monnifyResult;
  }
  row.metadata = { ...(row.metadata ?? {}), ...kudaFallbackPatch };

  const kudaFallbackResult = await purchaseAirtime(
    row.phone_number,
    row.amount,
    provider,
    customerFirstName,
    row.request_reference
  );

  return {
    ...kudaFallbackResult,
    metadataPatch: kudaFallbackPatch,
  };
}
