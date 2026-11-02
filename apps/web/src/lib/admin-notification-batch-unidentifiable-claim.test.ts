// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadScheduledNotificationDelivery,
  makeScheduledNotificationClaim,
  makeScheduledNotificationTestClient,
} from '../../../../supabase/functions/_shared/scheduled-notification-delivery.test-support';

// Lives in the web project so the CI web suite runs it: the Edge worker's
// own folder has no CI test job.
const NOW = new Date('2026-11-02T09:00:00.000Z');
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

describe('scheduled notification batch with an unidentifiable claim', () => {
  it.each([
    ['a non-object entry', 'not a claim'],
    ['an entry without a UUID id', { delivery_claim_token: 'x', id: 'x' }],
  ])('reports %s as failed and still delivers later claims', async (_label, unidentifiable) => {
    const later = makeScheduledNotificationClaim('040');
    const { calls, client } = makeScheduledNotificationTestClient(
      async (name) => {
        if (name === 'get_scheduled_notification_recipient_page_v1')
          return { data: [], error: null };
        if (name === 'get_notification_push_outbox_summary_v1')
          return { data: cleanSummary, error: null };
        return { data: true, error: null };
      }
    );
    const { processScheduledNotificationClaims } =
      await loadScheduledNotificationDelivery();

    const results = await processScheduledNotificationClaims(client, [
      unidentifiable,
      later,
    ]);

    expect(results).toEqual([
      { failure: 'unidentifiable_claim_skipped', status: 'failed' },
      { id: later.id, recipients: 0, status: 'sent' },
    ]);
    expect(
      calls.every((call) => call.args?.p_notification_id === later.id)
    ).toBe(true);
    expect(vi.mocked(console.error).mock.calls).toEqual([
      [
        'Scheduled notification claim could not be identified',
        { failure: 'unidentifiable_claim_skipped' },
      ],
    ]);
  });
});
