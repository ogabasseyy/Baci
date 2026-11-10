import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { logger } from '@/lib/logger';
import {
  alertMerchantOfRefundReview,
  MIN_ALERT_BUDGET_MS,
  type RefundReviewAlertSenders,
} from './alert-merchant-cancellation-refund-review';
import {
  asSupabase,
  makeSenders,
  makeSupabase,
  merchant,
  order,
  review,
} from './refund-alert.test-support';

vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
afterEach(() => vi.useRealTimers());

const failing = () =>
  makeSenders({
    sendEmail: vi.fn().mockResolvedValue({ success: false }),
    sendPush: vi.fn().mockResolvedValue({ sent: 0 }),
  });

function run(
  supabase: ReturnType<typeof makeSupabase>,
  senders: RefundReviewAlertSenders,
  extra: { deadlineMs?: number; prior?: { attempts: number } | null } = {}
) {
  return alertMerchantOfRefundReview({
    merchant,
    order,
    review,
    senders,
    supabase: asSupabase(supabase),
    ...extra,
  });
}

describe('alertMerchantOfRefundReview', () => {
  it('claims once, sends, and confirms on delivery', async () => {
    const supabase = makeSupabase();
    await expect(run(supabase, makeSenders())).resolves.toBe('alerted');
    expect(supabase.insert).toHaveBeenCalledWith({
      merchant_id: 'merchant-1',
      order_id: 'order-1',
      review_id: 'review-1',
    });
    expect(supabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ confirmed_at: expect.any(String) })
    );
    expect(supabase.confirmEq).toHaveBeenCalledWith('review_id', 'review-1');
  });

  it('stays silent when the review was already claimed', async () => {
    const senders = makeSenders();
    await expect(run(makeSupabase({ code: '23505' }), senders)).resolves.toBe(
      'skipped'
    );
    expect(senders.sendPush).not.toHaveBeenCalled();
    expect(senders.sendEmail).not.toHaveBeenCalled();
  });

  it('keeps the claim on a definite failure so it enters cool-down, not a hot loop', async () => {
    const supabase = makeSupabase();
    await expect(run(supabase, failing())).resolves.toBe('alerted');
    expect(supabase.del).not.toHaveBeenCalled();
    expect(supabase.confirmEq).not.toHaveBeenCalled();
  });

  it('keeps the claim unconfirmed for an uncertain result', async () => {
    const supabase = makeSupabase();
    await run(
      supabase,
      makeSenders({
        sendEmail: vi
          .fn()
          .mockResolvedValue({ deliveryOutcome: 'unknown', success: false }),
        sendPush: vi.fn().mockResolvedValue({ sent: 0 }),
      })
    );
    expect(supabase.del).not.toHaveBeenCalled();
    expect(supabase.confirmEq).not.toHaveBeenCalled();
  });

  it('defers without claiming when the phase budget is too short', async () => {
    const supabase = makeSupabase();
    const senders = makeSenders();
    const deadlineMs = Date.now() + MIN_ALERT_BUDGET_MS - 1_000;
    await expect(run(supabase, senders, { deadlineMs })).resolves.toBe(
      'deferred'
    );
    expect(supabase.insert).not.toHaveBeenCalled();
    expect(senders.sendPush).not.toHaveBeenCalled();
  });

  it('times out with the claim unconfirmed and logs it distinctly', async () => {
    vi.useFakeTimers();
    const supabase = makeSupabase();
    const senders = makeSenders({
      sendEmail: vi.fn(() => new Promise<never>(() => {})),
      sendPush: vi.fn(() => new Promise<never>(() => {})),
    });
    const pending = run(supabase, senders, { deadlineMs: Date.now() + 10_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toBe('alerted');
    expect(supabase.del).not.toHaveBeenCalled();
    expect(supabase.confirmEq).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        message: expect.stringContaining('timed out'),
      })
    );
  });

  it('confirms the claim when email succeeds but push outlives the timeout', async () => {
    vi.useFakeTimers();
    const supabase = makeSupabase();
    const senders = makeSenders({
      sendPush: vi.fn(() => new Promise<never>(() => {})),
    });
    const pending = run(supabase, senders, { deadlineMs: Date.now() + 10_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(supabase.confirmEq).toHaveBeenCalledWith('review_id', 'review-1');
  });

  it('confirms before returning when a late success lands within the grace period', async () => {
    vi.useFakeTimers();
    const supabase = makeSupabase();
    const senders = makeSenders({
      sendEmail: vi.fn().mockResolvedValue({ success: false }),
      sendPush: vi.fn(
        () =>
          new Promise<{ sent: number }>((resolve) => {
            setTimeout(() => resolve({ sent: 1 }), 16_000);
          })
      ),
    });
    const pending = run(supabase, senders, { deadlineMs: Date.now() + 30_000 });
    await vi.advanceTimersByTimeAsync(17_000);
    await expect(pending).resolves.toBe('alerted');
    expect(supabase.confirmEq).toHaveBeenCalledWith('review_id', 'review-1');
  });

  it('returns unconfirmed when the success lands beyond the grace period', async () => {
    vi.useFakeTimers();
    const supabase = makeSupabase();
    const senders = makeSenders({
      sendEmail: vi.fn().mockResolvedValue({ success: false }),
      sendPush: vi.fn(
        () =>
          new Promise<{ sent: number }>((resolve) => {
            setTimeout(() => resolve({ sent: 1 }), 25_000);
          })
      ),
    });
    const pending = run(supabase, senders, { deadlineMs: Date.now() + 30_000 });
    await vi.advanceTimersByTimeAsync(18_000);
    await expect(pending).resolves.toBe('alerted');
    expect(supabase.confirmEq).not.toHaveBeenCalled();
  });

  it('does not let a late rejection escape the timed-out delivery', async () => {
    vi.useFakeTimers();
    const supabase = makeSupabase();
    const senders = makeSenders({
      sendEmail: vi.fn().mockResolvedValue({ success: false }),
      sendPush: vi.fn(
        () =>
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error('late')), 16_000);
          })
      ),
    });
    const pending = run(supabase, senders, { deadlineMs: Date.now() + 30_000 });
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(pending).resolves.toBe('alerted');
    expect(supabase.confirmEq).not.toHaveBeenCalled();
  });

  it('confirms a success that lands after the timeout', async () => {
    vi.useFakeTimers();
    const supabase = makeSupabase();
    let finish: (v: { sent: number }) => void = () => {};
    const senders = makeSenders({
      sendEmail: vi.fn().mockResolvedValue({ success: false }),
      sendPush: vi.fn(
        () =>
          new Promise<{ sent: number }>((resolve) => {
            finish = resolve;
          })
      ),
    });
    const pending = run(supabase, senders, { deadlineMs: Date.now() + 10_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(supabase.confirmEq).not.toHaveBeenCalled();
    finish({ sent: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(supabase.confirmEq).toHaveBeenCalledWith('review_id', 'review-1');
  });

  describe('re-driving an unconfirmed claim', () => {
    it('re-claims with compare-and-set on the attempt count', async () => {
      const supabase = makeSupabase();
      const senders = makeSenders();
      await expect(
        run(supabase, senders, { prior: { attempts: 2 } })
      ).resolves.toBe('alerted');
      expect(supabase.insert).not.toHaveBeenCalled();
      expect(supabase.update).toHaveBeenCalledWith(
        expect.objectContaining({ attempts: 3 })
      );
      expect(supabase.reclaimChain.eq).toHaveBeenCalledWith('attempts', 2);
      expect(supabase.reclaimChain.is).toHaveBeenCalledWith(
        'confirmed_at',
        null
      );
      expect(senders.sendPush).toHaveBeenCalledTimes(1);
    });

    it('skips when another worker won the re-claim', async () => {
      const senders = makeSenders();
      await expect(
        run(makeSupabase(null, []), senders, { prior: { attempts: 1 } })
      ).resolves.toBe('skipped');
      expect(senders.sendPush).not.toHaveBeenCalled();
    });

    it('keeps the row when a retry fails, and logs a terminal error at the cap', async () => {
      const supabase = makeSupabase();
      await run(supabase, failing(), { prior: { attempts: 2 } });
      expect(supabase.del).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('abandoned'),
          reviewId: 'review-1',
        })
      );
    });
  });
});
