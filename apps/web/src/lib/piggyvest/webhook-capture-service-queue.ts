import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import { piggyvestClaimedCapturesSchema } from '@/schemas/piggyvest/webhook-capture';
import {
  type CaptureQueue,
  LEASE_SECONDS,
  MIN_AGE_SECONDS,
} from './webhook-capture-queue';

/**
 * The capture queue over a service-role client, for a runtime that holds
 * one (the worker host never does: it uses createPgCaptureQueue). Same
 * lease, grace period and fenced resolve.
 */
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
