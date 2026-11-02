import { describe, expect, it } from 'vitest';
import { getScheduledNotificationWorkerOutcome } from './scheduled-notification-worker-outcome.ts';

describe('scheduled notification worker outcome', () => {
  it('returns 503 and records failure when finalization failed', () => {
    expect(
      getScheduledNotificationWorkerOutcome([{ status: 'failed' }])
    ).toEqual({
      errorCode: 'notification_delivery_failed',
      healthStatus: 'failed',
      httpStatus: 503,
    });
  });

  it('preserves the existing 200 response for retry outcomes while recording failed health', () => {
    expect(
      getScheduledNotificationWorkerOutcome([{ status: 'retry' }])
    ).toEqual({
      errorCode: 'notification_retry',
      healthStatus: 'failed',
      httpStatus: 200,
    });
  });

  it('returns success when all claims finalize successfully', () => {
    expect(
      getScheduledNotificationWorkerOutcome([
        { status: 'sent' },
        { status: 'expired' },
      ])
    ).toEqual({ errorCode: null, healthStatus: 'succeeded', httpStatus: 200 });
  });
});
