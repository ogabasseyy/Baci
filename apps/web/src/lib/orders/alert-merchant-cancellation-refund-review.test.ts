import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({ getAppUrl: () => 'https://app.example.com' }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import {
  alertMerchantOfRefundReview,
  MIN_ALERT_BUDGET_MS,
  type RefundReviewAlertSenders,
} from './alert-merchant-cancellation-refund-review';

const order = {
  currency: 'NGN',
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_number: '1042',
};
const merchant = { email: 'owner@example.com', id: 'merchant-1' };
const review = {
  candidates: [{ amount: 27735, currency: 'NGN' }],
  id: 'review-1',
};

function makeSupabase(insertError: { code: string } | null = null) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const deleteEq = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({
    delete: vi.fn(() => ({ eq: deleteEq })),
    insert,
  }));
  return { deleteEq, from, insert };
}

function makeSenders(
  overrides: Partial<RefundReviewAlertSenders> = {}
): RefundReviewAlertSenders {
  return {
    sendEmail: vi.fn().mockResolvedValue({ success: true }),
    sendPush: vi.fn().mockResolvedValue({ failed: 0, sent: 1 }),
    ...overrides,
  };
}

async function run(
  supabase: ReturnType<typeof makeSupabase>,
  senders: RefundReviewAlertSenders,
  extra: { deadlineMs?: number; review?: typeof review } = {}
) {
  return alertMerchantOfRefundReview({
    merchant,
    order,
    review,
    senders,
    supabase: supabase as never,
    ...extra,
  });
}

afterEach(() => vi.useRealTimers());

describe('alertMerchantOfRefundReview', () => {
  it('pushes and emails once with the order deep link', async () => {
    const supabase = makeSupabase();
    const senders = makeSenders();
    await expect(run(supabase, senders)).resolves.toBe('alerted');
    expect(supabase.insert).toHaveBeenCalledWith({
      merchant_id: 'merchant-1',
      order_id: 'order-1',
      review_id: 'review-1',
    });
    const [, title, body, data, channel] = vi.mocked(senders.sendPush).mock
      .calls[0];
    expect(title).toBe('Refund needs attention');
    expect(body).toContain('Refund for order #1042');
    expect(body).toContain('27,735');
    expect(data).toMatchObject({
      order_id: 'order-1',
      type: 'paystack_refund_needs_attention',
    });
    expect(channel).toBe('payments');
    const email = vi.mocked(senders.sendEmail).mock.calls[0][0];
    expect(email.to).toBe('owner@example.com');
    expect(email.textContent).toContain(
      'https://app.example.com/dashboard/orders/order-1'
    );
    expect(email.htmlContent).toContain(
      'href="https://app.example.com/dashboard/orders/order-1"'
    );
    expect(supabase.deleteEq).not.toHaveBeenCalled();
  });

  it('escapes quotes in the href with the attribute escaper', async () => {
    const supabase = makeSupabase();
    const senders = makeSenders();
    await alertMerchantOfRefundReview({
      merchant,
      order: { ...order, id: 'o"x' },
      review,
      senders,
      supabase: supabase as never,
    });
    const html = vi.mocked(senders.sendEmail).mock.calls[0][0].htmlContent;
    expect(html).not.toContain(
      'href="https://app.example.com/dashboard/orders/o"'
    );
    expect(html).toContain('o%22x');
  });

  it('stays silent when the review was already alerted', async () => {
    const senders = makeSenders();
    await expect(run(makeSupabase({ code: '23505' }), senders)).resolves.toBe(
      'skipped'
    );
    expect(senders.sendPush).not.toHaveBeenCalled();
    expect(senders.sendEmail).not.toHaveBeenCalled();
  });

  it('releases the claim when no channel delivers', async () => {
    const supabase = makeSupabase();
    const senders = makeSenders({
      sendEmail: vi.fn().mockResolvedValue({ success: false }),
      sendPush: vi.fn().mockRejectedValue(new Error('expo down')),
    });
    await expect(run(supabase, senders)).resolves.toBe('alerted');
    expect(supabase.deleteEq).toHaveBeenCalledWith('review_id', 'review-1');
  });

  it('keeps the claim when push is delivered but email fails', async () => {
    const supabase = makeSupabase();
    const senders = makeSenders({
      sendEmail: vi.fn().mockRejectedValue(new Error('smtp down')),
    });
    await run(supabase, senders);
    expect(supabase.deleteEq).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown outcome', { deliveryOutcome: 'unknown' as const, sent: 0 }],
    ['partial failure', { failed: 1, sent: 1 }],
    ['push error list', { errors: ['x'], failed: 0, sent: 1 }],
  ])('does not treat a %s push as delivered: falls through to email', async (_n, push) => {
    const supabase = makeSupabase();
    const senders = makeSenders({
      sendEmail: vi.fn().mockResolvedValue({ success: false }),
      sendPush: vi.fn().mockResolvedValue(push),
    });
    await run(supabase, senders);
    expect(senders.sendEmail).toHaveBeenCalledTimes(1);
    // Uncertain: may have reached a device, so no duplicate-prone retry.
    expect(supabase.deleteEq).not.toHaveBeenCalled();
  });

  it('counts an uncertain push as delivered when email succeeds', async () => {
    const supabase = makeSupabase();
    const senders = makeSenders({
      sendPush: vi
        .fn()
        .mockResolvedValue({ deliveryOutcome: 'unknown', sent: 0 }),
    });
    await run(supabase, senders);
    expect(supabase.deleteEq).not.toHaveBeenCalled();
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

  it('stops waiting at the deadline, keeps the claim, and never releases it later', async () => {
    vi.useFakeTimers();
    const supabase = makeSupabase();
    let finish: (v: { sent: number }) => void = () => {};
    const senders = makeSenders({
      sendPush: vi.fn(
        () =>
          new Promise<{ sent: number }>((resolve) => {
            finish = resolve;
          })
      ),
    });
    const deadlineMs = Date.now() + 10_000;
    const pending = run(supabase, senders, { deadlineMs });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toBe('alerted');
    finish({ sent: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(supabase.deleteEq).not.toHaveBeenCalled();
  });
});
