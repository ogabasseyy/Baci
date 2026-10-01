import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleSettlementNotificationRetries } from './schedule-settlement-notification-retries';

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, info: vi.fn(), warn: vi.fn() },
}));

function retryQuery(error: unknown = null) {
  const calls: { eq: [string, unknown][]; in: [string, unknown][] } = {
    eq: [],
    in: [],
  };
  const update = vi.fn();
  const terminal = vi.fn().mockResolvedValue({ error });
  const chain = {
    eq: vi.fn((column: string, value: unknown) => {
      calls.eq.push([column, value]);
      return chain;
    }),
    in: vi.fn((column: string, value: unknown) => {
      calls.in.push([column, value]);
      return terminal();
    }),
  };
  update.mockReturnValue(chain);
  return { calls, terminal, update };
}

describe('scheduleSettlementNotificationRetries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defers each row from its own attempt count with backoff', async () => {
    const first = retryQuery();
    const second = retryQuery();
    const from = vi
      .fn()
      .mockReturnValueOnce({ update: first.update })
      .mockReturnValueOnce({ update: second.update });
    const supabase = { from } as unknown as SupabaseClient;

    await scheduleSettlementNotificationRetries({
      items: [
        { id: 'set-1', notificationAttempts: 0 },
        { id: 'set-2', notificationAttempts: 2 },
      ],
      logScope: { merchantId: 'merchant-a' },
      reason: 'rejected',
      supabase,
    });

    expect(first.update).toHaveBeenCalledWith({
      notification_attempts: 1,
      notification_next_retry_at: expect.any(String),
    });
    expect(first.calls.eq).toEqual([
      ['status', 'settled'],
      ['settlement_notified', false],
    ]);
    expect(first.calls.in).toEqual([['id', ['set-1']]]);
    expect(second.update).toHaveBeenCalledWith({
      notification_attempts: 3,
      notification_next_retry_at: expect.any(String),
    });
    expect(second.calls.in).toEqual([['id', ['set-2']]]);
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('dead-letters rejected rows past the cap with a null retry', async () => {
    const retry = retryQuery();
    const from = vi.fn().mockReturnValueOnce({ update: retry.update });
    const supabase = { from } as unknown as SupabaseClient;

    await scheduleSettlementNotificationRetries({
      items: [{ id: 'set-1', notificationAttempts: 4 }],
      logScope: { merchantId: 'merchant-a' },
      reason: 'rejected',
      supabase,
    });

    expect(retry.update).toHaveBeenCalledWith({
      notification_attempts: 5,
      notification_next_retry_at: null,
    });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-a',
        message:
          'Settlement notification dead-lettered after repeated rejections',
        settlementIds: ['set-1'],
        attempts: 5,
      })
    );
  });

  it('dead-letters email-less rows with the missing-email message', async () => {
    const retry = retryQuery();
    const from = vi.fn().mockReturnValueOnce({ update: retry.update });
    const supabase = { from } as unknown as SupabaseClient;

    await scheduleSettlementNotificationRetries({
      items: [{ id: 'set-0', notificationAttempts: 4 }],
      logScope: { merchantIds: ['merchant-a'] },
      reason: 'missing-email',
      supabase,
    });

    expect(retry.update).toHaveBeenCalledWith({
      notification_attempts: 5,
      notification_next_retry_at: null,
    });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantIds: ['merchant-a'],
        message:
          'Settlement notification dead-lettered: merchant email missing',
      })
    );
  });

  it('logs a retry-update failure without throwing', async () => {
    const retry = retryQuery({ code: 'XX000' });
    const from = vi.fn().mockReturnValueOnce({ update: retry.update });
    const supabase = { from } as unknown as SupabaseClient;

    await expect(
      scheduleSettlementNotificationRetries({
        items: [{ id: 'set-1', notificationAttempts: 0 }],
        logScope: { merchantId: 'merchant-a' },
        reason: 'rejected',
        supabase,
      })
    ).resolves.toBeUndefined();

    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-a',
        message: 'Failed to schedule settlement notification retry',
      })
    );
  });
});
