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
  status: string;
  updated_at?: string | null;
}

/**
 * Runs the Monnify-airtime → Kuda fallback vend. Persists the Kuda
 * routing BEFORE the call so a result-persist crash still leaves a
 * Kuda-reconcilable row (TSQ by request_reference); without the
 * marker the row keeps provider=monnify with no vend reference and
 * strands charged with no terminal result. Fail closed: if the
 * marker write fails, the Monnify rejection is returned unsettled
 * and Kuda is never called (nothing delivered → refund path).
 *
 * Lost-race CAS (Codex R96 P1): the marker write gates on
 * status=processing AND the claimed updated_at token (fresh: the
 * submission marker refreshed it in place and the Monnify attempt
 * writes no rows). A worker paused after its Monnify failure would
 * otherwise land the marker on a row a replay already reclaimed —
 * the unfiltered UPDATE still succeeds on the newer generation and
 * the resumed worker submits airtime Kuda already delivered.
 * Zero-match returns the Monnify rejection unsettled (refund path),
 * exactly like a failed write. Refreshes the CAS token in place so
 * downstream restores compare against the post-marker generation.
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
  const fallbackMarkerQuery = supabase
    .from('vtu_transactions')
    .update({
      metadata: { ...(row.metadata ?? {}), ...kudaFallbackPatch },
    })
    .eq('id', row.id)
    .eq('status', 'processing');
  const { data: fallbackMarkedRow, error: fallbackMarkerError } =
    await (typeof row.updated_at === 'string'
      ? fallbackMarkerQuery.eq('updated_at', row.updated_at)
      : fallbackMarkerQuery
    )
      .select('id, updated_at')
      .maybeSingle();
  if (fallbackMarkerError) {
    console.error('Failed to persist Kuda fallback routing:', {
      error: fallbackMarkerError.message,
      transactionId: row.id,
    });
    return monnifyResult;
  }
  if (!fallbackMarkedRow) {
    console.error('Kuda fallback routing lost race: row moved or settled:', {
      transactionId: row.id,
    });
    return monnifyResult;
  }
  if (typeof fallbackMarkedRow.updated_at === 'string') {
    row.updated_at = fallbackMarkedRow.updated_at;
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
