import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import {
  type PiggyvestCaptureStatus,
  type PiggyvestClaimedCapture,
  piggyvestClaimedCapturesSchema,
} from '@/schemas/piggyvest/webhook-capture';
import {
  piggyvestCaptureResolveRowSchema,
  piggyvestCaptureStatusRowSchema,
} from '@/schemas/piggyvest/webhook-capture-drain-runtime';
import type { CaptureDrainExecutor } from './webhook-capture-pg-executor';

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

/**
 * The same queue over the worker host's dedicated drain login (see
 * webhook-capture-pg-executor.ts) instead of a service-role client: same
 * lease, same grace period, same fenced resolve. Every response is parsed
 * before it is trusted and every failure is reported without detail.
 */
export function createPgCaptureQueue(
  executor: CaptureDrainExecutor
): CaptureQueue & { status(): Promise<PiggyvestCaptureStatus> } {
  return {
    async claim(limit) {
      const rows = await executor
        .query('claim', [limit, LEASE_SECONDS, MIN_AGE_SECONDS])
        .catch(() => null);
      const parsed = piggyvestClaimedCapturesSchema.safeParse(rows);
      if (!parsed.success) throw new Error('PiggyVest capture claim failed');
      return parsed.data;
    },
    async resolve(captureId, claimToken, state, errorCode) {
      const rows = await executor
        .query('resolve', [captureId, claimToken, state, errorCode])
        .catch(() => null);
      const parsed =
        rows?.length === 1
          ? piggyvestCaptureResolveRowSchema.safeParse(rows[0])
          : null;
      if (!parsed?.success) throw new Error('PiggyVest capture resolve failed');
      return parsed.data.resolved;
    },
    async status() {
      const rows = await executor.query('status', []).catch(() => null);
      const parsed =
        rows?.length === 1
          ? piggyvestCaptureStatusRowSchema.safeParse(rows[0])
          : null;
      if (!parsed?.success) throw new Error('PiggyVest capture status failed');
      return parsed.data.status;
    },
  };
}
