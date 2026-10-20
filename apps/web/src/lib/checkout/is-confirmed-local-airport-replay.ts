import type { SupabaseClient } from '@supabase/supabase-js';
import { hasExistingKeyedOrder } from './has-existing-keyed-order';

type ConfirmedLocalAirportReplayInput = Readonly<{
  merchantId: string;
  requestIdempotencyKey?: string | null;
  supabase: SupabaseClient;
}>;

/**
 * Returns true only when the database confirms an existing airport replay.
 * Implemented via hasExistingKeyedOrder so replay behavior cannot drift
 * between shipping paths.
 */
export function isConfirmedLocalAirportReplay({
  merchantId,
  requestIdempotencyKey,
  supabase,
}: ConfirmedLocalAirportReplayInput): Promise<boolean> {
  return hasExistingKeyedOrder({ merchantId, requestIdempotencyKey, supabase });
}
