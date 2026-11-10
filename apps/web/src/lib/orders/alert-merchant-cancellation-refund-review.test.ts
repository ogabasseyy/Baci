import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { logger } from '@/lib/logger';

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

function makeSupabase(
  insertError: { code: string } | null = null,
  reclaimed: unknown[] = [{ review_id: 'review-1' }]
) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const deleteEq = vi.fn().mockResolvedValue({ error: null });
  const confirmEq = vi.fn().mockResolvedValue({ error: null });
  const reclaimSelect = vi
    .fn()
    .mockResolvedValue({ data: reclaimed, error: null });
  const reclaimChain = {
    eq: vi.fn(() => reclaimChain),
    is: vi.fn(() => reclaimChain),
    select: reclaimSelect,
  };
  const update = vi.fn((values: Record<string, unknown>) =>
    'confirmed_at' in values ? { eq: confirmEq } : reclaimChain
  );
  const from = vi.fn(() => ({
    delete: vi.fn(() => ({ eq: deleteEq })),
    insert,
    update,
  }));
  return { confirmEq, deleteEq, from, insert, reclaimChain, update };
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
  extra: {
    deadlineMs?: number;
    prior?: { attempts: number } | null;
    review?: typeof review & { metadata?: unknown };
  } = {}
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

it('falls back to the root domain when the app URL is unset', async () => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
  const senders = makeSenders();
  await run(makeSupabase(), senders);
  expect(vi.mocked(senders.sendEmail).mock.calls[0][0].textContent).toContain(
    'https://usebaci.com/dashboard/orders/order-1'
  );
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
});

describe('alertMerchantOfRefundReview', () => {
  it('pushes and emails once with the order deep link', async () => {
    const supabase = makeSupabase();
    const senders = makeSenders();
    await expect(
      run(supabase, senders, {
        review: { ...review, metadata: { ambiguous_initiation: false } },
      })
    ).resolves.toBe('alerted');
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
    // Unconfirmed: left for the pending pass to re-drive after cool-down.
    expect(supabase.confirmEq).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        message: expect.stringContaining('timed out'),
      })
    );
  });

  it('confirms the claim once an alert is delivered', async () => {
    const supabase = makeSupabase();
    await run(supabase, makeSenders());
    expect(supabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ confirmed_at: expect.any(String) })
    );
    expect(supabase.confirmEq).toHaveBeenCalledWith('review_id', 'review-1');
  });

  it('keeps the claim when email reports an unknown outcome', async () => {
    const supabase = makeSupabase();
    const senders = makeSenders({
      sendEmail: vi
        .fn()
        .mockResolvedValue({ deliveryOutcome: 'unknown', success: false }),
      sendPush: vi.fn().mockResolvedValue({ sent: 0 }),
    });
    await expect(run(supabase, senders)).resolves.toBe('alerted');
    expect(supabase.deleteEq).not.toHaveBeenCalled();
    expect(supabase.confirmEq).not.toHaveBeenCalled();
  });

  it('still releases the claim for a definite email failure', async () => {
    const supabase = makeSupabase();
    const senders = makeSenders({
      sendEmail: vi.fn().mockResolvedValue({ success: false }),
      sendPush: vi.fn().mockResolvedValue({ sent: 0 }),
    });
    await run(supabase, senders);
    expect(supabase.deleteEq).toHaveBeenCalledWith('review_id', 'review-1');
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

    it('logs a terminal error when the final retry is still unconfirmed', async () => {
      const senders = makeSenders({
        sendEmail: vi.fn().mockResolvedValue({ success: false }),
        sendPush: vi.fn().mockResolvedValue({ sent: 0 }),
      });
      await run(makeSupabase(), senders, { prior: { attempts: 2 } });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('abandoned'),
          reviewId: 'review-1',
        })
      );
    });

    it('keeps the row (counting the attempt) when a retry definitively fails', async () => {
      const supabase = makeSupabase();
      const senders = makeSenders({
        sendEmail: vi.fn().mockResolvedValue({ success: false }),
        sendPush: vi.fn().mockResolvedValue({ sent: 0 }),
      });
      await run(supabase, senders, { prior: { attempts: 1 } });
      expect(supabase.deleteEq).not.toHaveBeenCalled();
    });
  });

  describe('alert copy', () => {
    const bodyFor = async (metadata: unknown) => {
      const senders = makeSenders();
      await run(makeSupabase(), senders, { review: { ...review, metadata } });
      return vi.mocked(senders.sendPush).mock.calls[0].slice(1, 3) as [
        string,
        string,
      ];
    };

    it('tells the merchant to refund manually only on a definite rejection', async () => {
      const [title, body] = await bodyFor({ ambiguous_initiation: false });
      expect(title).toBe('Refund needs attention');
      expect(body).toContain("couldn't be completed automatically");
      expect(body).toContain('refund manually');
    });

    it.each([
      ['ambiguous initiation', { ambiguous_initiation: true }],
      [
        'accepted provider refund id',
        {
          ambiguous_initiation: false,
          provider_refund_id: '123',
        },
      ],
      [
        'reference-only provider event',
        {
          audit_record_failed: true,
          reference_only_refund_event: true,
        },
      ],
      ['missing metadata', null],
    ])('asks for a Paystack check, not a manual refund, for %s', async (_n, metadata) => {
      const [title, body] = await bodyFor(metadata);
      expect(title).toBe('Refund needs your review');
      expect(body).toContain('check Paystack before refunding again');
      expect(body).not.toContain('refund manually');
      expect(body).not.toContain("couldn't be completed");
    });
  });
});
