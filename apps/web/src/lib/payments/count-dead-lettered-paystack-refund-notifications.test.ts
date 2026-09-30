import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: mocks.loggerError,
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { countDeadLetteredPaystackRefundNotifications } from './count-dead-lettered-paystack-refund-notifications';

function notificationQueries(
  exhausted: { data: unknown; count: number },
  stale: { data: unknown; count: number }
) {
  const limit = vi
    .fn()
    .mockResolvedValueOnce({ ...exhausted, error: null })
    .mockResolvedValueOnce({ ...stale, error: null });
  const query = {
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    limit,
    select: vi.fn().mockReturnThis(),
  };
  const from = vi.fn().mockReturnValue(query);
  return { from, query };
}

describe('countDeadLetteredPaystackRefundNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports zero when nothing is about to dead-letter', async () => {
    const { from, query } = notificationQueries(
      { data: [], count: 0 },
      { data: [], count: 0 }
    );

    await expect(
      countDeadLetteredPaystackRefundNotifications({ from } as never)
    ).resolves.toBe(0);
    // Mirror the claim RPC's exhausted-CTE exactly: it dead-letters
    // attempts-exhausted rows in both claimable statuses, so counting
    // only failed rows would let a pending loss report success.
    expect(query.in).toHaveBeenCalledWith('status', ['pending', 'failed']);
    expect(query.gte).toHaveBeenCalledWith('attempts', 5);
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('counts attempts-exhausted rows for the failure signal', async () => {
    const { from } = notificationQueries(
      {
        count: 1,
        data: [{ event_type: 'processed_customer_email', order_id: 'order-9' }],
      },
      { data: [], count: 0 }
    );

    await expect(
      countDeadLetteredPaystackRefundNotifications({ from } as never)
    ).resolves.toBe(1);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ exhausted: 1 })
    );
  });

  it('counts stale worker claims the next claim call terminalizes', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const { from, query } = notificationQueries(
        { data: [], count: 0 },
        {
          count: 2,
          data: [
            { event_type: 'processed_customer_email', order_id: 'order-7' },
          ],
        }
      );

      await expect(
        countDeadLetteredPaystackRefundNotifications({ from } as never)
      ).resolves.toBe(2);
      expect(query.lt).toHaveBeenCalledWith(
        'claimed_at',
        new Date(100_000).toISOString()
      );
      expect(mocks.loggerError).toHaveBeenCalledWith(
        expect.objectContaining({ staleTerminalized: 2 })
      );
    } finally {
      now.mockRestore();
    }
  });

  it('throws when either terminalization count fails', async () => {
    const limit = vi.fn().mockResolvedValueOnce({
      data: null,
      count: null,
      error: new Error('db down'),
    });
    const query = {
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      limit,
      select: vi.fn().mockReturnThis(),
    };
    const from = vi.fn().mockReturnValue(query);

    await expect(
      countDeadLetteredPaystackRefundNotifications({ from } as never)
    ).rejects.toThrow('refund_notification_claim_failed');
  });
});
