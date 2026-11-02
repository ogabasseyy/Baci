// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { getScheduledNotificationWorkerOutcome } from '../../../../supabase/functions/_shared/scheduled-notification-worker-outcome';

describe('scheduled notification worker outcome', () => {
  it('returns 503 and records failed health when a finalization failed', () => {
    expect(
      getScheduledNotificationWorkerOutcome([{ status: 'failed' }])
    ).toEqual({
      errorCode: 'notification_delivery_failed',
      healthStatus: 'failed',
      httpStatus: 503,
    });
  });

  it('prefers the failed finalization code when retries share the batch', () => {
    expect(
      getScheduledNotificationWorkerOutcome([
        { status: 'retry' },
        { status: 'sent' },
        { status: 'failed' },
      ])
    ).toEqual({
      errorCode: 'notification_delivery_failed',
      healthStatus: 'failed',
      httpStatus: 503,
    });
  });

  it('keeps the existing 200 response for retries while recording failed health', () => {
    expect(
      getScheduledNotificationWorkerOutcome([{ status: 'retry' }])
    ).toEqual({
      errorCode: 'notification_retry',
      healthStatus: 'failed',
      httpStatus: 200,
    });
  });

  it('reports success when every claim finalized or there was nothing to claim', () => {
    const success = {
      errorCode: null,
      healthStatus: 'succeeded',
      httpStatus: 200,
    };
    expect(
      getScheduledNotificationWorkerOutcome([
        { status: 'sent' },
        { status: 'expired' },
        { status: 'deferred' },
      ])
    ).toEqual(success);
    expect(getScheduledNotificationWorkerOutcome([])).toEqual(success);
  });
});
