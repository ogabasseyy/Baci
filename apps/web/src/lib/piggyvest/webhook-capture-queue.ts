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
import { captureFailureDetail } from './webhook-capture-failure-detail';
import type { CaptureDrainExecutor } from './webhook-capture-pg-executor';

class CaptureQueueError extends Error {
  readonly sqlState: string | null;

  constructor(message: string, cause?: unknown) {
    super(message);
    const sqlState = (cause as { sqlState?: unknown } | null)?.sqlState;
    this.sqlState =
      typeof sqlState === 'string' && /^[0-9A-Z]{5}$/.test(sqlState)
        ? sqlState
        : null;
  }
}

/**
 * Database-backed queue over the captured deliveries, for the drain. A row
 * is leased for LEASE_SECONDS (a crashed worker's lease simply expires and
 * the row is claimed again) and is only claimable after MIN_AGE_SECONDS, so
 * the receiver's own inline processing normally finishes first. Queue
 * operations use the dedicated drain login; the restricted receiver only
 * captures deliveries and completes its own inline processing.
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
  renew(captureId: string, claimToken: string): Promise<boolean>;
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
 * lease, grace period and fenced resolve as the stored capture contract. Every response is parsed
 * before it is trusted and every failure is reported without detail.
 */
export function createPgCaptureQueue(
  executor: CaptureDrainExecutor
): CaptureQueue & { status(): Promise<PiggyvestCaptureStatus> } {
  return {
    async renew(captureId, claimToken) {
      let rows: unknown[] | null;
      try {
        rows = await executor.query('resolve', [
          captureId,
          claimToken,
          'renew',
          null,
        ]);
      } catch (error) {
        console.warn(
          '[PiggyVest Webhook] Failed to renew captured delivery',
          captureFailureDetail(error, 'renew')
        );
        rows = null;
      }
      const parsed =
        rows?.length === 1
          ? piggyvestCaptureResolveRowSchema.safeParse(rows[0])
          : null;
      return parsed?.success ? parsed.data.resolved : false;
    },
    async claim(limit) {
      let rows: unknown[];
      try {
        rows = await executor.query('claim', [
          limit,
          LEASE_SECONDS,
          MIN_AGE_SECONDS,
        ]);
      } catch (error) {
        throw new CaptureQueueError('PiggyVest capture claim failed', error);
      }
      const parsed = piggyvestClaimedCapturesSchema.safeParse(rows);
      if (!parsed.success) throw new Error('PiggyVest capture claim failed');
      return parsed.data;
    },
    async resolve(captureId, claimToken, state, errorCode) {
      let rows: unknown[];
      try {
        rows = await executor.query('resolve', [
          captureId,
          claimToken,
          state,
          errorCode,
        ]);
      } catch (error) {
        throw new CaptureQueueError('PiggyVest capture resolve failed', error);
      }
      const parsed =
        rows?.length === 1
          ? piggyvestCaptureResolveRowSchema.safeParse(rows[0])
          : null;
      if (!parsed?.success)
        throw new CaptureQueueError('PiggyVest capture resolve failed');
      return parsed.data.resolved;
    },
    async status() {
      let rows: unknown[];
      try {
        rows = await executor.query('status', []);
      } catch (error) {
        throw new CaptureQueueError('PiggyVest capture status failed', error);
      }
      const parsed =
        rows?.length === 1
          ? piggyvestCaptureStatusRowSchema.safeParse(rows[0])
          : null;
      if (!parsed?.success)
        throw new CaptureQueueError('PiggyVest capture status failed');
      return parsed.data.status;
    },
  };
}
