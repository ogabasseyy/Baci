import 'server-only';
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
 * the receiver's own inline processing normally finishes first. The
 * service-role variant is webhook-capture-service-queue.ts, kept apart so
 * the worker host's import graph never reaches a service client.
 */
export const LEASE_SECONDS = 300;
export const MIN_AGE_SECONDS = 120;

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

/**
 * The queue over the worker host's dedicated drain login (see
 * webhook-capture-pg-executor.ts), never a service-role client: the same
 * lease, grace period and fenced resolve as the service-role queue. Every response is parsed
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
