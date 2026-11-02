import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  makeScheduledNotificationClaim,
  makeScheduledNotificationTestClient,
} from './scheduled-notification-delivery.test-support.ts';
import { processScheduledNotificationClaims } from './scheduled-notification-delivery.ts';

const cleanSummary = {
  dispatching: 0,
  pending: 0,
  rejected: 0,
  unknown: 0,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('scheduled notification delivery batch finalization', () => {
  it('continues after retry finalization throws and returns an explicit failure', async () => {
    const firstClaim = makeScheduledNotificationClaim('020');
    const secondClaim = makeScheduledNotificationClaim('021');
    const { calls, client } = makeScheduledNotificationTestClient(
      async (name, args) => {
        if (name === 'get_scheduled_notification_recipient_page_v1')
          return { data: [], error: null };
        if (name === 'get_notification_push_outbox_summary_v1') {
          if (args?.p_notification_id === firstClaim.id)
            return { data: null, error: { message: 'temporary read failure' } };
          return { data: cleanSummary, error: null };
        }
        if (
          name === 'finalize_scheduled_admin_notification_v1' &&
          args?.p_notification_id === firstClaim.id
        )
          throw new Error('temporary write failure');
        return { data: true, error: null };
      }
    );

    const results = await processScheduledNotificationClaims(client, [
      firstClaim,
      secondClaim,
    ]);

    expect(results).toEqual([
      {
        failure: 'retry_finalization_failed',
        id: firstClaim.id,
        status: 'failed',
      },
      { id: secondClaim.id, recipients: 0, status: 'sent' },
    ]);
    expect(calls).toContainEqual({
      args: expect.objectContaining({
        p_notification_id: firstClaim.id,
        p_outcome: 'retry',
      }),
      name: 'finalize_scheduled_admin_notification_v1',
    });
  });

  it('continues after expired-during-delivery finalization throws', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-11-02T00:00:00.000Z');
    vi.setSystemTime(now);
    const expiredClaim = makeScheduledNotificationClaim('022', {
      expiresAt: new Date(now.getTime() + 1000).toISOString(),
    });
    const secondClaim = makeScheduledNotificationClaim('023');
    const { calls, client } = makeScheduledNotificationTestClient(
      async (name, args) => {
        if (name === 'snapshot_claimed_notification_audience_v1') {
          if (args?.p_notification_id === expiredClaim.id)
            vi.setSystemTime(now.getTime() + 2000);
          return { data: true, error: null };
        }
        if (name === 'get_scheduled_notification_recipient_page_v1')
          return { data: [], error: null };
        if (name === 'get_notification_push_outbox_summary_v1')
          return { data: cleanSummary, error: null };
        if (
          name === 'finalize_scheduled_admin_notification_v1' &&
          args?.p_notification_id === expiredClaim.id
        )
          throw new Error('temporary expired write failure');
        return { data: true, error: null };
      }
    );

    const results = await processScheduledNotificationClaims(client, [
      expiredClaim,
      secondClaim,
    ]);

    expect(results).toEqual([
      {
        failure: 'expired_finalization_failed',
        id: expiredClaim.id,
        status: 'failed',
      },
      { id: secondClaim.id, recipients: 0, status: 'sent' },
    ]);
    expect(
      calls.filter(
        (call) =>
          call.name === 'finalize_scheduled_admin_notification_v1' &&
          call.args?.p_notification_id === expiredClaim.id
      )
    ).toHaveLength(1);
    expect(calls).toContainEqual({
      args: expect.objectContaining({
        p_notification_id: expiredClaim.id,
        p_outcome: 'expired',
      }),
      name: 'finalize_scheduled_admin_notification_v1',
    });
  });

  it('treats a false retry finalization as claim loss and does not refinalize', async () => {
    const lostClaim = makeScheduledNotificationClaim('024');
    const secondClaim = makeScheduledNotificationClaim('025');
    const { calls, client } = makeScheduledNotificationTestClient(
      async (name, args) => {
        if (name === 'get_scheduled_notification_recipient_page_v1')
          return { data: [], error: null };
        if (name === 'get_notification_push_outbox_summary_v1') {
          if (args?.p_notification_id === lostClaim.id)
            return { data: null, error: { message: 'temporary read failure' } };
          return { data: cleanSummary, error: null };
        }
        if (
          name === 'finalize_scheduled_admin_notification_v1' &&
          args?.p_notification_id === lostClaim.id
        )
          return { data: false, error: null };
        return { data: true, error: null };
      }
    );

    const results = await processScheduledNotificationClaims(client, [
      lostClaim,
      secondClaim,
    ]);

    expect(results).toEqual([
      { id: secondClaim.id, recipients: 0, status: 'sent' },
    ]);
    expect(
      calls.filter(
        (call) =>
          call.name === 'finalize_scheduled_admin_notification_v1' &&
          call.args?.p_notification_id === lostClaim.id
      )
    ).toHaveLength(1);
  });
});
