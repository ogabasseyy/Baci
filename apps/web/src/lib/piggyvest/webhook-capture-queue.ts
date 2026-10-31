import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import {
  type PiggyvestClaimedCapture,
  piggyvestClaimedCapturesSchema,
} from '@/schemas/piggyvest/webhook-capture';

/**
 * Database-backed queue over the captured deliveries, for the drain. A row
 * is leased for LEASE_SECONDS (a crashed worker's lease simply expires and
 * the row is claimed again) and is only claimable after MIN_AGE_SECONDS, so
 * the receiver's own inline processing normally finishes first.
 */
const LEASE_SECONDS = 300;
const MIN_AGE_SECONDS = 120;

/**
 * 'pending' releases a failed row: it keeps the attempt it spent (bounded by
 * the attempt budget) and the database backs the retry off, 30s * 2^attempts
 * capped at one hour. 'deferred' releases a row blocked by incomplete key
 * configuration: the database refunds the attempt, schedules a longer
 * bounded backoff and never dead-letters it.
 */
export type CaptureResolution =
  | 'pending'
  | 'deferred'
  | 'processed'
  | 'needs_review';

export interface CaptureQueue {
  claim(limit: number): Promise<PiggyvestClaimedCapture[]>;
  resolve(
    captureId: string,
    claimToken: string,
    state: CaptureResolution,
    error: string | null
  ): Promise<boolean>;
}

export function createCaptureQueue(
  supabase: PiggyvestIntakeServiceClient
): CaptureQueue {
  const db: SupabaseClient = supabase;
  return {
    async claim(limit) {
      const { data, error } = await db.rpc('claim_piggyvest_webhook_captures', {
        p_limit: limit,
        p_lease_seconds: LEASE_SECONDS,
        p_min_age_seconds: MIN_AGE_SECONDS,
      });
      const parsed = piggyvestClaimedCapturesSchema.safeParse(data);
      if (error || !parsed.success) {
        throw new Error('PiggyVest capture claim failed');
      }
      return parsed.data;
    },
    async resolve(captureId, claimToken, state, errorCode) {
      const { data, error } = await db.rpc(
        'resolve_piggyvest_webhook_capture',
        {
          p_id: captureId,
          p_claim_token: claimToken,
          p_state: state,
          p_error: errorCode,
        }
      );
      if (error) throw new Error('PiggyVest capture resolve failed');
      return data === true;
    },
  };
}
