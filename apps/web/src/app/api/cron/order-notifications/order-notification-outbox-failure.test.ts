import { describe, expect, it, vi } from 'vitest';
import { markFailedOrRetry } from './order-notification-outbox-failure';

function createSupabase() {
  const update = vi.fn((_values: Record<string, unknown>) => ({
    match: () => ({
      select: () => ({
        maybeSingle: async () => ({ data: { id: 'row-1' }, error: null }),
      }),
    }),
  }));
  return {
    client: { from: () => ({ update }) } as never,
    update,
  };
}

const row = {
  attempt_count: 1,
  claim_owner: 'm2-worker',
  id: 'row-1',
  max_attempts: 5,
};

function summary() {
  return { failed: 0, retried: 0, skipped: 0 };
}

describe('markFailedOrRetry', () => {
  it('retries a transient reclaim-read failure without overwriting stranded-marker evidence', async () => {
    const { client, update } = createSupabase();
    const counts = summary();

    await markFailedOrRetry(
      client,
      row,
      'dispatch_marker_reclaim_read_failed: connection reset',
      counts
    );

    expect(counts).toEqual({ failed: 0, retried: 1, skipped: 0 });
    const values = update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(values.status).toBe('pending');
    expect(values).not.toHaveProperty('last_error');
  });

  it('records ordinary errors with their message and fails past the budget', async () => {
    const { client, update } = createSupabase();
    const counts = summary();

    await markFailedOrRetry(
      client,
      { ...row, attempt_count: 5 },
      'provider_timeout',
      counts
    );

    expect(counts).toEqual({ failed: 1, retried: 0, skipped: 0 });
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      last_error: 'provider_timeout',
      status: 'failed',
    });
  });
});
