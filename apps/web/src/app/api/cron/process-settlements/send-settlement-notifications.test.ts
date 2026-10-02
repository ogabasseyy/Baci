import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendSettlementNotifications } from './send-settlement-notifications';

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, info: vi.fn(), warn: vi.fn() },
}));

function settlement(
  id: string,
  merchant: { business_name: string; email: string | null; id: string },
  netAmount = 2500,
  notificationAttempts = 0
) {
  return {
    description: `Order ${id}`,
    gateway: 'paystack',
    id,
    merchants: merchant,
    net_amount: netAmount,
    notification_attempts: notificationAttempts,
  };
}

const merchantA = {
  business_name: 'Merchant A',
  email: 'a@example.com',
  id: 'merchant-a',
};
const merchantB = {
  business_name: 'Merchant B',
  email: 'b@example.com',
  id: 'merchant-b',
};

function freshQuery(
  rows: Array<{ id: string; settlement_notified: boolean; status: string }>,
  error: unknown = null
) {
  const terminal = vi.fn().mockResolvedValue({ data: rows, error });
  return { select: vi.fn(() => ({ in: terminal })), terminal };
}

function markQuery(outcome: { error?: unknown } = {}) {
  const calls: { eq: [string, unknown][]; in: [string, unknown][] } = {
    eq: [],
    in: [],
  };
  const update = vi.fn();
  const terminal = vi.fn().mockResolvedValue({ error: outcome.error ?? null });
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

describe('sendSettlementNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero counts without sending when there is nothing pending', async () => {
    const sendEmail = vi.fn();
    const from = vi.fn();
    const supabase = { from } as unknown as SupabaseClient;

    await expect(
      sendSettlementNotifications({
        pendingNotifications: null,
        sendEmail,
        supabase,
      })
    ).resolves.toEqual({ failed: 0, sent: 0 });
    await expect(
      sendSettlementNotifications({
        pendingNotifications: [],
        sendEmail,
        supabase,
      })
    ).resolves.toEqual({ failed: 0, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('sends one batched email per merchant and marks with guarded predicates', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    const freshA = freshQuery([
      { id: 'set-1', settlement_notified: false, status: 'settled' },
      { id: 'set-2', settlement_notified: false, status: 'settled' },
    ]);
    const freshB = freshQuery([
      { id: 'set-3', settlement_notified: false, status: 'settled' },
    ]);
    const markA = markQuery();
    const markB = markQuery();
    const from = vi
      .fn()
      .mockReturnValueOnce(freshA)
      .mockReturnValueOnce({ update: markA.update })
      .mockReturnValueOnce(freshB)
      .mockReturnValueOnce({ update: markB.update });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendSettlementNotifications({
      pendingNotifications: [
        settlement('set-1', merchantA, 1000),
        settlement('set-2', merchantA, 2000),
        settlement('set-3', merchantB, 500),
      ],
      sendEmail,
      supabase,
    });

    expect(result).toEqual({ failed: 0, sent: 2 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ to: 'a@example.com' })
    );
    expect(sendEmail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ to: 'b@example.com' })
    );
    for (const mark of [markA, markB]) {
      expect(mark.update).toHaveBeenCalledWith(
        expect.objectContaining({ settlement_notified: true })
      );
      expect(mark.calls.eq).toEqual([
        ['status', 'settled'],
        ['settlement_notified', false],
      ]);
    }
    expect(markA.calls.in).toEqual([['id', ['set-1', 'set-2']]]);
    expect(markB.calls.in).toEqual([['id', ['set-3']]]);
  });

  it('defers rows whose merchant has no email address', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    const fresh = freshQuery([
      { id: 'set-1', settlement_notified: false, status: 'settled' },
    ]);
    const mark = markQuery();
    const retry = markQuery();
    const from = vi
      .fn()
      .mockReturnValueOnce(fresh)
      .mockReturnValueOnce({ update: mark.update })
      .mockReturnValueOnce({ update: retry.update });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendSettlementNotifications({
      pendingNotifications: [
        settlement('set-0', { ...merchantA, email: null }),
        settlement('set-1', merchantA),
      ],
      sendEmail,
      supabase,
    });

    // Nothing to send to, but the row must still advance through
    // retry accounting: left at zero attempts it would pin the
    // bounded queue.
    expect(result).toEqual({ failed: 1, sent: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(mark.calls.in).toEqual([['id', ['set-1']]]);
    expect(retry.update).toHaveBeenCalledWith({
      notification_attempts: 1,
      notification_next_retry_at: expect.any(String),
    });
    expect(retry.calls.in).toEqual([['id', ['set-0']]]);
  });

  it('dead-letters email-less rows past the retry cap', async () => {
    const sendEmail = vi.fn();
    const retry = markQuery();
    const from = vi.fn().mockReturnValueOnce({ update: retry.update });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendSettlementNotifications({
      pendingNotifications: [
        settlement('set-0', { ...merchantA, email: null }, 2500, 4),
      ],
      sendEmail,
      supabase,
    });

    expect(result).toEqual({ failed: 1, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(retry.update).toHaveBeenCalledWith({
      notification_attempts: 5,
      notification_next_retry_at: null,
    });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Settlement notification dead-lettered: merchant email missing',
      })
    );
  });

  it('announces only rows still settled and unnotified at send time', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    const fresh = freshQuery([
      { id: 'set-1', settlement_notified: false, status: 'settled' },
      { id: 'set-2', settlement_notified: false, status: 'reversed' },
      { id: 'set-3', settlement_notified: true, status: 'settled' },
    ]);
    const mark = markQuery();
    const from = vi
      .fn()
      .mockReturnValueOnce(fresh)
      .mockReturnValueOnce({ update: mark.update });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendSettlementNotifications({
      pendingNotifications: [
        settlement('set-1', merchantA, 1000),
        settlement('set-2', merchantA, 2000),
        settlement('set-3', merchantA, 3000),
      ],
      sendEmail,
      supabase,
    });

    // The reversal landing after the batch read must not be announced,
    // and the already-notified row must not be announced twice.
    expect(result).toEqual({ failed: 0, sent: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(mark.calls.in).toEqual([['id', ['set-1']]]);
  });

  it('sends nothing when every snapshotted row reversed before the send', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    const fresh = freshQuery([
      { id: 'set-1', settlement_notified: false, status: 'reversed' },
    ]);
    const from = vi.fn().mockReturnValueOnce(fresh);
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendSettlementNotifications({
      pendingNotifications: [settlement('set-1', merchantA)],
      sendEmail,
      supabase,
    });

    expect(result).toEqual({ failed: 0, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('counts a fresh-read failure without sending', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    const fresh = freshQuery([], new Error('read failed'));
    const retry = markQuery();
    const from = vi
      .fn()
      .mockReturnValueOnce(fresh)
      .mockReturnValueOnce({ update: retry.update });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendSettlementNotifications({
      pendingNotifications: [settlement('set-1', merchantA)],
      sendEmail,
      supabase,
    });

    expect(result).toEqual({ failed: 1, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    // The throw happened before revalidation completed, so the whole
    // merchant batch advances through retry accounting instead of
    // pinning the bounded queue.
    expect(retry.update).toHaveBeenCalledWith({
      notification_attempts: 1,
      notification_next_retry_at: expect.any(String),
    });
    expect(retry.calls.in).toEqual([['id', ['set-1']]]);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'merchant-a' })
    );
  });

  it('counts a mail failure without marking', async () => {
    const sendEmail = vi.fn().mockRejectedValue(new Error('smtp down'));
    const fresh = freshQuery([
      { id: 'set-1', settlement_notified: false, status: 'settled' },
    ]);
    const retry = markQuery();
    const from = vi
      .fn()
      .mockReturnValueOnce(fresh)
      .mockReturnValueOnce({ update: retry.update });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendSettlementNotifications({
      pendingNotifications: [settlement('set-1', merchantA)],
      sendEmail,
      supabase,
    });

    expect(result).toEqual({ failed: 1, sent: 0 });
    expect(from).toHaveBeenCalledTimes(2);
    // A thrown send is pre-dispatch, so the row rejoins the retry
    // queue with backoff instead of pinning the batch.
    expect(retry.update).toHaveBeenCalledWith({
      notification_attempts: 1,
      notification_next_retry_at: expect.any(String),
    });
    expect(retry.calls.in).toEqual([['id', ['set-1']]]);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'merchant-a' })
    );
  });

  it('counts a mark-write failure after a delivered email', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    const fresh = freshQuery([
      { id: 'set-1', settlement_notified: false, status: 'settled' },
    ]);
    const mark = markQuery();
    mark.terminal.mockRejectedValueOnce(new Error('mark failed'));
    const retry = markQuery();
    const from = vi
      .fn()
      .mockReturnValueOnce(fresh)
      .mockReturnValueOnce({ update: mark.update })
      .mockReturnValueOnce({ update: retry.update });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendSettlementNotifications({
      pendingNotifications: [settlement('set-1', merchantA)],
      sendEmail,
      supabase,
    });

    expect(result).toEqual({ failed: 1, sent: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    // The mark write threw, so the row stays unnotified and rejoins
    // the retry queue with backoff.
    expect(retry.update).toHaveBeenCalledWith({
      notification_attempts: 1,
      notification_next_retry_at: expect.any(String),
    });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'merchant-a' })
    );
  });

  it('defers rows with backoff when the provider rejects the email', async () => {
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

    const result = await sendSettlementNotifications({
      pendingNotifications: [settlement('set-1', merchantA)],
      sendEmail,
      supabase,
    });

    // The row stays unnotified but must not rejoin the head of the
    // bounded queue immediately: the next run skips it until the
    // deferred retry is due.
    expect(result).toEqual({ failed: 1, sent: 0 });
    expect(retry.update).toHaveBeenCalledWith({
      notification_attempts: 1,
      notification_next_retry_at: expect.any(String),
    });
    expect(retry.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ settlement_notified: true })
    );
    expect(retry.calls.eq).toEqual([
      ['status', 'settled'],
      ['settlement_notified', false],
    ]);
    expect(retry.calls.in).toEqual([['id', ['set-1']]]);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-a',
        message: 'Settlement notification email rejected',
      })
    );
  });

  it('dead-letters rows past the retry cap instead of deferring again', async () => {
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

    const result = await sendSettlementNotifications({
      pendingNotifications: [settlement('set-1', merchantA, 2500, 4)],
      sendEmail,
      supabase,
    });

    // The fifth rejection retires the row from the queue (the fetch
    // excludes capped rows) and logs for operations instead of
    // deferring a retry that would never deliver.
    expect(result).toEqual({ failed: 1, sent: 0 });
    expect(retry.update).toHaveBeenCalledWith({
      notification_attempts: 5,
      notification_next_retry_at: null,
    });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-a',
        message:
          'Settlement notification dead-lettered after repeated rejections',
      })
    );
  });

  it('groups deferred rows by their next attempt count', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: false });
    const fresh = freshQuery([
      { id: 'set-1', settlement_notified: false, status: 'settled' },
      { id: 'set-2', settlement_notified: false, status: 'settled' },
    ]);
    const retryA = markQuery();
    const retryB = markQuery();
    const from = vi
      .fn()
      .mockReturnValueOnce(fresh)
      .mockReturnValueOnce({ update: retryA.update })
      .mockReturnValueOnce({ update: retryB.update });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendSettlementNotifications({
      pendingNotifications: [
        settlement('set-1', merchantA, 1000, 0),
        settlement('set-2', merchantA, 2000, 2),
      ],
      sendEmail,
      supabase,
    });

    // Rows in one merchant batch carry different rejection
    // histories: each defers from its own attempt count instead of
    // inheriting the batch's.
    expect(result).toEqual({ failed: 1, sent: 0 });
    expect(retryA.update).toHaveBeenCalledWith({
      notification_attempts: 1,
      notification_next_retry_at: expect.any(String),
    });
    expect(retryA.calls.in).toEqual([['id', ['set-1']]]);
    expect(retryB.update).toHaveBeenCalledWith({
      notification_attempts: 3,
      notification_next_retry_at: expect.any(String),
    });
    expect(retryB.calls.in).toEqual([['id', ['set-2']]]);
  });

  it('marks notified but failed when delivery is uncertain', async () => {
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

    const result = await sendSettlementNotifications({
      pendingNotifications: [settlement('set-1', merchantA)],
      sendEmail,
      supabase,
    });

    // The provider may already have accepted the message: leaving
    // the rows unnotified would duplicate a delivered email on the
    // next run, so persist notified while signaling operations to
    // verify actual delivery.
    expect(result).toEqual({ failed: 1, sent: 0 });
    expect(mark.update).toHaveBeenCalledWith(
      expect.objectContaining({ settlement_notified: true })
    );
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-a',
        message: 'Settlement notification delivery uncertain',
      })
    );
  });

  it('counts a resolved mark error instead of reporting sent', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    const fresh = freshQuery([
      { id: 'set-1', settlement_notified: false, status: 'settled' },
    ]);
    // Supabase resolves write failures instead of throwing: the mark
    // rejects nothing, so only the checked response catches it.
    const mark = markQuery({ error: { code: 'XX000' } });
    const from = vi
      .fn()
      .mockReturnValueOnce(fresh)
      .mockReturnValueOnce({ update: mark.update });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await sendSettlementNotifications({
      pendingNotifications: [settlement('set-1', merchantA)],
      sendEmail,
      supabase,
    });

    // The email was delivered but the row stays unnotified: reporting
    // sent would hide the next run's duplicate email behind success.
    expect(result).toEqual({ failed: 1, sent: 0 });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-a',
        message: 'Failed to mark settlement notification sent',
      })
    );
  });
});
