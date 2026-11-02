// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduledNotificationTestSupport } from '../../../../supabase/functions/_shared/scheduled-notification-delivery.test-support';
import type { ScheduledNotificationWorkerClient } from '../../../../supabase/functions/_shared/scheduled-notification-rpc';

const {
  finalizeCallsFor,
  loadScheduledNotificationDelivery,
  makeMalformedScheduledNotificationClaim: makeMalformedClaim,
  makeScheduledNotificationClaim,
  makeScheduledNotificationTestClient,
} = scheduledNotificationTestSupport;

// Lives in the web project so the CI web suite runs it: the Edge worker's
// own folder has no CI test job.
async function processScheduledNotificationClaims(
  client: ScheduledNotificationWorkerClient,
  claimed: unknown[]
) {
  const delivery = await loadScheduledNotificationDelivery();
  return delivery.processScheduledNotificationClaims(client, claimed);
}

const NOW = new Date('2026-11-02T09:00:00.000Z');
const FINALIZE = 'finalize_scheduled_admin_notification_v1';
const PAGE = 'get_scheduled_notification_recipient_page_v1';
const SUMMARY = 'get_notification_push_outbox_summary_v1';
const cleanSummary = { dispatching: 0, pending: 0, rejected: 0, unknown: 0 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('scheduled notification batch finalization isolation', () => {
  it('reports a failed retry finalization and still delivers later claims', async () => {
    const failing = makeScheduledNotificationClaim('020');
    const later = makeScheduledNotificationClaim('021');
    const { calls, client } = makeScheduledNotificationTestClient(
      async (name, args) => {
        const isFailing = args?.p_notification_id === failing.id;
        if (name === PAGE) return { data: [], error: null };
        if (name === SUMMARY && isFailing)
          return { data: null, error: { message: 'temporary read failure' } };
        if (name === SUMMARY) return { data: cleanSummary, error: null };
        if (name === FINALIZE && isFailing)
          return { data: null, error: { message: 'temporary write failure' } };
        return { data: true, error: null };
      }
    );

    const results = await processScheduledNotificationClaims(client, [
      failing,
      later,
    ]);

    expect(results).toEqual([
      {
        failure: 'retry_finalization_failed',
        id: failing.id,
        status: 'failed',
      },
      { id: later.id, recipients: 0, status: 'sent' },
    ]);
    expect(finalizeCallsFor(calls, failing.id)).toEqual([
      {
        args: expect.objectContaining({ p_outcome: 'retry' }),
        name: FINALIZE,
      },
    ]);
    expect(finalizeCallsFor(calls, later.id)).toEqual([
      { args: expect.objectContaining({ p_outcome: 'sent' }), name: FINALIZE },
    ]);
  });

  it('reports a failed expiry finalization once and still delivers later claims', async () => {
    const expiring = makeScheduledNotificationClaim('022', {
      expiresAt: new Date(NOW.getTime() + 1000).toISOString(),
    });
    const later = makeScheduledNotificationClaim('023');
    const { calls, client } = makeScheduledNotificationTestClient(
      async (name, args) => {
        const isExpiring = args?.p_notification_id === expiring.id;
        if (name === 'snapshot_claimed_notification_audience_v1' && isExpiring)
          vi.setSystemTime(NOW.getTime() + 2000);
        if (name === PAGE) return { data: [], error: null };
        if (name === SUMMARY) return { data: cleanSummary, error: null };
        if (name === FINALIZE && isExpiring)
          throw new Error('temporary expired write failure');
        return { data: true, error: null };
      }
    );

    const results = await processScheduledNotificationClaims(client, [
      expiring,
      later,
    ]);

    expect(results).toEqual([
      {
        failure: 'expired_finalization_failed',
        id: expiring.id,
        status: 'failed',
      },
      { id: later.id, recipients: 0, status: 'sent' },
    ]);
    expect(finalizeCallsFor(calls, expiring.id)).toEqual([
      {
        args: expect.objectContaining({ p_outcome: 'expired' }),
        name: FINALIZE,
      },
    ]);
  });

  it('finalizes an already-expired claim once as expired even when that write fails', async () => {
    const expired = makeScheduledNotificationClaim('030', {
      expiresAt: new Date(NOW.getTime() - 1000).toISOString(),
    });
    const later = makeScheduledNotificationClaim('031');
    const { calls, client } = makeScheduledNotificationTestClient(
      async (name, args) => {
        if (name === FINALIZE && args?.p_notification_id === expired.id)
          return { data: null, error: { message: 'temporary write failure' } };
        if (name === PAGE) return { data: [], error: null };
        if (name === SUMMARY) return { data: cleanSummary, error: null };
        return { data: true, error: null };
      }
    );

    const results = await processScheduledNotificationClaims(client, [
      expired,
      later,
    ]);

    expect(results).toEqual([
      {
        failure: 'expired_finalization_failed',
        id: expired.id,
        status: 'failed',
      },
      { id: later.id, recipients: 0, status: 'sent' },
    ]);
    expect(
      calls.filter((call) => call.args?.p_notification_id === expired.id)
    ).toEqual([
      {
        args: expect.objectContaining({ p_outcome: 'expired' }),
        name: FINALIZE,
      },
    ]);
  });

  it('reports a failed malformed-claim retry finalization and still delivers later claims', async () => {
    const malformed = makeMalformedClaim('026');
    const later = makeScheduledNotificationClaim('027');
    const { calls, client } = makeScheduledNotificationTestClient(
      async (name, args) => {
        if (name === FINALIZE && args?.p_notification_id === malformed.id)
          throw new Error('temporary malformed write failure');
        if (name === PAGE) return { data: [], error: null };
        if (name === SUMMARY) return { data: cleanSummary, error: null };
        return { data: true, error: null };
      }
    );

    const results = await processScheduledNotificationClaims(client, [
      malformed,
      later,
    ]);

    expect(results).toEqual([
      {
        failure: 'malformed_claim_retry_finalization_failed',
        id: malformed.id,
        status: 'failed',
      },
      { id: later.id, recipients: 0, status: 'sent' },
    ]);
    expect(finalizeCallsFor(calls, malformed.id)).toHaveLength(1);
  });

  it('logs each failed finalization with bounded fields and no raw error text', async () => {
    const failing = makeScheduledNotificationClaim('032');
    const malformed = makeMalformedClaim('033');
    const { client } = makeScheduledNotificationTestClient(
      async (name, args) => {
        if (name === FINALIZE && args?.p_notification_id === malformed.id)
          throw new Error('raw provider detail 033');
        if (name === FINALIZE)
          return { data: null, error: { message: 'raw provider detail' } };
        if (name === SUMMARY)
          return { data: null, error: { message: 'raw provider detail 032' } };
        if (name === PAGE) return { data: [], error: null };
        return { data: true, error: null };
      }
    );

    await processScheduledNotificationClaims(client, [failing, malformed]);

    const logged = vi.mocked(console.error).mock.calls;
    expect(logged).toEqual([
      [
        'Scheduled notification finalization failed',
        {
          failure: 'retry_finalization_failed',
          notificationId: failing.id,
          outcome: 'retry',
        },
      ],
      [
        'Scheduled notification finalization failed',
        {
          failure: 'malformed_claim_retry_finalization_failed',
          notificationId: malformed.id,
          outcome: 'retry',
        },
      ],
    ]);
    expect(JSON.stringify(logged)).not.toContain('raw provider detail');
  });

  it('treats a false retry finalization as claim loss without refinalizing', async () => {
    const lost = makeScheduledNotificationClaim('024');
    const later = makeScheduledNotificationClaim('025');
    const { calls, client } = makeScheduledNotificationTestClient(
      async (name, args) => {
        const isLost = args?.p_notification_id === lost.id;
        if (name === PAGE) return { data: [], error: null };
        if (name === SUMMARY && isLost)
          return { data: null, error: { message: 'temporary read failure' } };
        if (name === SUMMARY) return { data: cleanSummary, error: null };
        if (name === FINALIZE && isLost) return { data: false, error: null };
        return { data: true, error: null };
      }
    );

    const results = await processScheduledNotificationClaims(client, [
      lost,
      later,
    ]);

    expect(results).toEqual([{ id: later.id, recipients: 0, status: 'sent' }]);
    expect(finalizeCallsFor(calls, lost.id)).toHaveLength(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('treats a false sent finalization as claim loss without a retry finalization', async () => {
    const lost = makeScheduledNotificationClaim('028');
    const later = makeScheduledNotificationClaim('029');
    const { calls, client } = makeScheduledNotificationTestClient(
      async (name, args) => {
        if (name === PAGE) return { data: [], error: null };
        if (name === SUMMARY) return { data: cleanSummary, error: null };
        if (name === FINALIZE)
          return { data: args?.p_notification_id !== lost.id, error: null };
        return { data: true, error: null };
      }
    );

    const results = await processScheduledNotificationClaims(client, [
      lost,
      later,
    ]);

    expect(results).toEqual([{ id: later.id, recipients: 0, status: 'sent' }]);
    expect(finalizeCallsFor(calls, lost.id)).toEqual([
      { args: expect.objectContaining({ p_outcome: 'sent' }), name: FINALIZE },
    ]);
  });
});
