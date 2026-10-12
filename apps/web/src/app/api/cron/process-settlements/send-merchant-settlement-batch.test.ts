import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type MerchantSettlementBatch,
  sendMerchantSettlementBatch,
} from './send-merchant-settlement-batch';

const mocks = {
  loggerError: vi.fn(),
};

vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mocks.loggerError(...args),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function freshQuery(rows: unknown[]) {
  return {
    in: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaited thenables.
    then: (resolve: (result: unknown) => void) =>
      resolve({ data: rows, error: null }),
  };
}

function markQuery(result: { error?: unknown } = {}) {
  const calls: { eq: unknown[][]; in: unknown[][] } = { eq: [], in: [] };
  const terminal = {
    eq: vi.fn((...args: unknown[]) => {
      calls.eq.push(args);
      return terminal;
    }),
    in: vi.fn((...args: unknown[]) => {
      calls.in.push(args);
      return terminal;
    }),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaited thenables.
    then: (resolve: (response: unknown) => void) =>
      resolve({ data: null, error: result.error ?? null }),
  };
  return {
    calls,
    terminal,
    update: vi.fn().mockReturnValue(terminal),
  };
}

function batch(): MerchantSettlementBatch {
  return {
    businessName: 'Merchant A',
    email: 'a@example.com',
    merchantId: 'merchant-a',
    settlements: [
      {
        amount: 100,
        description: 'Payment',
        gateway: 'paystack',
        id: 'set-1',
        notificationAttempts: 0,
      },
    ],
    totalAmount: 100,
  };
}

describe('sendMerchantSettlementBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends and marks the settled rows', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    const fresh = freshQuery([
      { id: 'set-1', settlement_notified: false, status: 'settled' },
    ]);
    const mark = markQuery();
    const from = vi
      .fn()
      .mockReturnValueOnce(fresh)
      .mockReturnValueOnce({ update: mark.update });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendMerchantSettlementBatch({
      batch: batch(),
      sendEmail,
      supabase,
    });

    expect(result).toEqual({ failed: 0, sent: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(mark.update).toHaveBeenCalledWith(
      expect.objectContaining({ settlement_notified: true })
    );
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('skips sending when every row reversed since the batch read', async () => {
    const sendEmail = vi.fn();
    const fresh = freshQuery([
      { id: 'set-1', settlement_notified: false, status: 'cancelled' },
    ]);
    const from = vi.fn().mockReturnValueOnce(fresh);
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendMerchantSettlementBatch({
      batch: batch(),
      sendEmail,
      supabase,
    });

    expect(result).toEqual({ failed: 0, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('requeues definite rejections without marking', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: false });
    const fresh = freshQuery([
      { id: 'set-1', settlement_notified: false, status: 'settled' },
    ]);
    const retry = markQuery();
    const from = vi
      .fn()
      .mockReturnValueOnce(fresh)
      .mockReturnValueOnce({ update: retry.update });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendMerchantSettlementBatch({
      batch: batch(),
      sendEmail,
      supabase,
    });

    expect(result).toEqual({ failed: 1, sent: 0 });
    expect(retry.update).toHaveBeenCalledWith({
      notification_attempts: 1,
      notification_next_retry_at: expect.any(String),
    });
  });

  it('marks uncertain deliveries notified but failed for verification', async () => {
    const sendEmail = vi
      .fn()
      .mockResolvedValue({ deliveryOutcome: 'unknown', success: false });
    const fresh = freshQuery([
      { id: 'set-1', settlement_notified: false, status: 'settled' },
    ]);
    const mark = markQuery();
    const from = vi
      .fn()
      .mockReturnValueOnce(fresh)
      .mockReturnValueOnce({ update: mark.update });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendMerchantSettlementBatch({
      batch: batch(),
      sendEmail,
      supabase,
    });

    expect(result).toEqual({ failed: 1, sent: 0 });
    expect(mark.update).toHaveBeenCalledWith(
      expect.objectContaining({ settlement_notified: true })
    );
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Settlement notification delivery uncertain',
      })
    );
  });

  it('retries the mark once before dead-lettering a delivered batch', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    const fresh = freshQuery([
      { id: 'set-1', settlement_notified: false, status: 'settled' },
    ]);
    const mark = markQuery({ error: { code: 'XX000' } });
    const markRetry = markQuery();
    const from = vi
      .fn()
      .mockReturnValueOnce(fresh)
      .mockReturnValueOnce({ update: mark.update })
      .mockReturnValueOnce({ update: markRetry.update });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendMerchantSettlementBatch({
      batch: batch(),
      sendEmail,
      supabase,
    });

    expect(result).toEqual({ failed: 0, sent: 1 });
    expect(markRetry.update).toHaveBeenCalledWith(
      expect.objectContaining({ settlement_notified: true })
    );
  });

  it('dead-letters delivered rows when the mark retry also fails', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    const fresh = freshQuery([
      { id: 'set-1', settlement_notified: false, status: 'settled' },
    ]);
    const mark = markQuery({ error: { code: 'XX000' } });
    const markRetry = markQuery({ error: { code: 'XX000' } });
    const deadLetter = markQuery();
    const from = vi
      .fn()
      .mockReturnValueOnce(fresh)
      .mockReturnValueOnce({ update: mark.update })
      .mockReturnValueOnce({ update: markRetry.update })
      .mockReturnValueOnce({ update: deadLetter.update });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendMerchantSettlementBatch({
      batch: batch(),
      sendEmail,
      supabase,
    });

    expect(result).toEqual({ failed: 1, sent: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(deadLetter.update).toHaveBeenCalledWith({
      notification_attempts: 5,
      notification_next_retry_at: null,
    });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Settlement notification delivered but unmarked',
      })
    );
  });

  it('requeues pre-dispatch throws without announcing', async () => {
    const sendEmail = vi.fn().mockRejectedValue(new Error('sender down'));
    const fresh = freshQuery([
      { id: 'set-1', settlement_notified: false, status: 'settled' },
    ]);
    const retry = markQuery();
    const from = vi
      .fn()
      .mockReturnValueOnce(fresh)
      .mockReturnValueOnce({ update: retry.update });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendMerchantSettlementBatch({
      batch: batch(),
      sendEmail,
      supabase,
    });

    // A thrown send is pre-dispatch per the dispatch-boundary
    // contract, so the rows rejoin the retry queue.
    expect(result).toEqual({ failed: 1, sent: 0 });
    expect(retry.update).toHaveBeenCalledWith({
      notification_attempts: 1,
      notification_next_retry_at: expect.any(String),
    });
  });
});
