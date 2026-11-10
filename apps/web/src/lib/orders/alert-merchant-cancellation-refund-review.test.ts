import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { logger } from '@/lib/logger';
import { alertMerchantOfRefundReview } from './alert-merchant-cancellation-refund-review';
import {
  asSupabase,
  makeSenders,
  makeSupabase,
  merchant,
  order,
  review,
  withAbort,
} from './refund-alert.test-support';
import { MIN_ALERT_BUDGET_MS } from './refund-alert-constants';
import type { RefundReviewAlertSenders } from './refund-alert-types';

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
    await expect(run(supabase, makeSenders())).resolves.toBe('delivered');
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
      'duplicate'
    );
    expect(senders.sendPush).not.toHaveBeenCalled();
    expect(senders.sendEmail).not.toHaveBeenCalled();
  });

  it('keeps the claim on a definite failure so it enters cool-down, not a hot loop', async () => {
    const supabase = makeSupabase();
    await expect(run(supabase, failing())).resolves.toBe('failed');
    expect(supabase.del).not.toHaveBeenCalled();
    expect(supabase.confirmEq).not.toHaveBeenCalled();
  });

  it('reports a claim error as skipped, not duplicate', async () => {
    const senders = makeSenders();
    await expect(run(makeSupabase({ code: '50000' }), senders)).resolves.toBe(
      'skipped'
    );
    expect(senders.sendPush).not.toHaveBeenCalled();
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
    await expect(pending).resolves.toBe('uncertain');
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
    await expect(pending).resolves.toBe('delivered');
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
    await expect(pending).resolves.toBe('uncertain');
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
    await expect(pending).resolves.toBe('uncertain');
    expect(supabase.confirmEq).not.toHaveBeenCalled();
  });

  it('does not wait on a hung confirm beyond the budget', async () => {
    vi.useFakeTimers();
    const supabase = makeSupabase();
    supabase.confirmEq.mockReturnValue(new Promise(() => {}));
    const pending = run(supabase, makeSenders(), {
      deadlineMs: Date.now() + 30_000,
    });
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(pending).resolves.toBe('delivered');
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

  it('times out against the absolute deadline after a slow claim', async () => {
    vi.useFakeTimers();
    const supabase = makeSupabase();
    supabase.insert.mockImplementation(
      () =>
        withAbort(
          new Promise((resolve) =>
            setTimeout(() => resolve({ error: null }), 6_000)
          )
        ) as never
    );
    const senders = makeSenders({
      sendEmail: vi.fn(() => new Promise<never>(() => {})),
      sendPush: vi.fn(() => new Promise<never>(() => {})),
    });
    const pending = run(supabase, senders, { deadlineMs: Date.now() + 10_000 });
    // Without recomputing, the timeout would wait ~10s more after the claim.
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toBe('uncertain');
  });

  it('parks an undeliverable alert for a long re-check without consuming retries and logs once', async () => {
    const supabase = makeSupabase();
    const senders = makeSenders({
      sendPush: vi.fn().mockResolvedValue({ errors: [], failed: 0, sent: 0 }),
    });
    await expect(
      alertMerchantOfRefundReview({
        merchant: { ...merchant, email: null },
        order,
        review,
        senders,
        supabase: asSupabase(supabase),
      })
    ).resolves.toBe('undeliverable');
    expect(supabase.update).toHaveBeenCalledWith({
      attempts: 0,
      last_attempt_at: expect.any(String),
      undeliverable_at: expect.any(String),
    });
    expect(supabase.confirmEq).toHaveBeenCalledWith('review_id', 'review-1');
    expect(
      vi
        .mocked(logger.warn)
        .mock.calls.filter(([m]) =>
          String((m as { message: string }).message).includes('undeliverable')
        )
    ).toHaveLength(1);
  });
});
