import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Verdict idempotency-key lookup for the wallet-only checkout route
 * (Phase 2, epic #3694).
 *
 * Split from `vtu-replay-binding.ts` (Codex R122 P1) per the
 * one-primary-export rule; converted from a direct SELECT to the
 * verdict RPC when the checkout moved off service-role: the keys
 * table has no buyer policy by design (key-only lookups are
 * unscoped), so ownership is decided inside
 * `lookup_vtu_idempotency_row` and the route only ever sees its
 * own rows (plus a field-less `foreign` verdict for others —
 * matching the old 400 exactly).
 */

export type VtuIdempotencyVerdict = 'fresh' | 'owned' | 'foreign';

export interface ExistingIdempotencyRow {
  key: string;
  vtu_transaction_id: string;
  customer_id: string;
  merchant_id: string;
  request_fingerprint: string;
}

export interface VtuIdempotencyLookup {
  verdict: VtuIdempotencyVerdict;
  /** Non-null if and only if the verdict is `owned`. */
  row: ExistingIdempotencyRow | null;
}

function isVerdict(value: unknown): value is VtuIdempotencyVerdict {
  return value === 'fresh' || value === 'owned' || value === 'foreign';
}

export async function lookupVtuIdempotencyVerdict(
  supabase: SupabaseClient,
  key: string,
  userId: string
): Promise<VtuIdempotencyLookup> {
  const { data, error } = await supabase.rpc('lookup_vtu_idempotency_row', {
    p_key: key,
    p_user_id: userId,
  });
  if (error) {
    throw new Error(`Failed to look up idempotency key: ${error.message}`);
  }
  const verdictRow = data?.[0];
  if (!verdictRow || !isVerdict(verdictRow.verdict)) {
    throw new Error('Failed to look up idempotency key: invalid verdict');
  }
  if (verdictRow.verdict !== 'owned') {
    return { verdict: verdictRow.verdict, row: null };
  }
  if (
    !verdictRow.vtu_transaction_id ||
    !verdictRow.customer_id ||
    !verdictRow.merchant_id ||
    !verdictRow.request_fingerprint
  ) {
    throw new Error('Failed to look up idempotency key: owned row incomplete');
  }
  return {
    verdict: 'owned',
    row: {
      key: verdictRow.key ?? key,
      vtu_transaction_id: verdictRow.vtu_transaction_id,
      customer_id: verdictRow.customer_id,
      merchant_id: verdictRow.merchant_id,
      request_fingerprint: verdictRow.request_fingerprint,
    },
  };
}
