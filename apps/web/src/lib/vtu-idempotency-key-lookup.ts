import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Idempotency-key row lookup for the wallet-only checkout route.
 *
 * Split from `vtu-replay-binding.ts` (Codex R122 P1) per the
 * one-primary-export rule: this module owns the key-row read;
 * `vtu-replay-binding.ts` owns binding the key row to its
 * transaction row.
 */

export interface ExistingIdempotencyRow {
  key: string;
  vtu_transaction_id: string;
  customer_id: string;
  merchant_id: string;
  request_fingerprint: string;
}

export async function findExistingIdempotencyRow(
  supabase: SupabaseClient,
  key: string
): Promise<ExistingIdempotencyRow | null> {
  const { data, error } = await supabase
    .from('vtu_idempotency_keys')
    .select(
      'key, vtu_transaction_id, customer_id, merchant_id, request_fingerprint'
    )
    .eq('key', key)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to look up idempotency key: ${error.message}`);
  }
  return data ?? null;
}
