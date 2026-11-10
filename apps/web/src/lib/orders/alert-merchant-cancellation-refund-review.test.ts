import { describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({ getAppUrl: () => 'https://app.example.com' }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import {
  alertMerchantOfCancellationRefundReview,
  type RefundReviewAlertSenders,
} from './alert-merchant-cancellation-refund-review';

const order = {
  currency: 'NGN',
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_number: '1042',
};
const merchant = { email: 'owner@example.com', id: 'merchant-1' };

function makeSupabase({
  insertError = null,
  reviews = [{ candidates: [{ amount: 27735 }], id: 'review-1' }],
  reviewError = null,
}: {
  insertError?: { code: string } | null;
  reviewError?: Error | null;
  reviews?: Array<{ candidates: unknown; id: string }>;
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const deleteEq = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === 'reconciliation_review') {
      const query = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockResolvedValue({ data: reviews, error: reviewError }),
        select: vi.fn().mockReturnThis(),
      };
      return query;
    }
    return { delete: vi.fn(() => ({ eq: deleteEq })), insert };
  });
  return { deleteEq, from, insert };
}

function makeSenders(
  overrides: Partial<RefundReviewAlertSenders> = {}
): RefundReviewAlertSenders {
  return {
    sendEmail: vi.fn().mockResolvedValue({ success: true }),
    sendPush: vi.fn().mockResolvedValue({ sent: 1 }),
    ...overrides,
  };
}

describe('alertMerchantOfCancellationRefundReview', () => {
  it('pushes and emails once with the order deep link', async () => {
    const supabase = makeSupabase();
    const senders = makeSenders();
    await alertMerchantOfCancellationRefundReview({
      merchant,
      order,
      senders,
      supabase: supabase as never,
    });

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
    expect(body).toContain('Open the order to refund manually.');
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
    expect(supabase.deleteEq).not.toHaveBeenCalled();
  });

  it('stays silent when the review was already alerted', async () => {
    const supabase = makeSupabase({ insertError: { code: '23505' } });
    const senders = makeSenders();
    await alertMerchantOfCancellationRefundReview({
      merchant,
      order,
      senders,
      supabase: supabase as never,
    });
    expect(senders.sendPush).not.toHaveBeenCalled();
    expect(senders.sendEmail).not.toHaveBeenCalled();
  });

  it('does nothing when no open review exists', async () => {
    const supabase = makeSupabase({ reviews: [] });
    const senders = makeSenders();
    await alertMerchantOfCancellationRefundReview({
      merchant,
      order,
      senders,
      supabase: supabase as never,
    });
    expect(supabase.insert).not.toHaveBeenCalled();
    expect(senders.sendPush).not.toHaveBeenCalled();
  });

  it('never throws and releases the claim when no channel delivers', async () => {
    const supabase = makeSupabase();
    const senders = makeSenders({
      sendEmail: vi.fn().mockRejectedValue(new Error('smtp down')),
      sendPush: vi.fn().mockRejectedValue(new Error('expo down')),
    });
    await expect(
      alertMerchantOfCancellationRefundReview({
        merchant,
        order,
        senders,
        supabase: supabase as never,
      })
    ).resolves.toBeUndefined();
    expect(supabase.deleteEq).toHaveBeenCalledWith('review_id', 'review-1');
  });

  it('keeps the claim when push is delivered but email fails', async () => {
    const supabase = makeSupabase();
    const senders = makeSenders({
      sendEmail: vi.fn().mockRejectedValue(new Error('smtp down')),
    });
    await alertMerchantOfCancellationRefundReview({
      merchant,
      order,
      senders,
      supabase: supabase as never,
    });
    expect(supabase.deleteEq).not.toHaveBeenCalled();
  });

  it('swallows a failed review lookup', async () => {
    const supabase = makeSupabase({ reviewError: new Error('db') });
    const senders = makeSenders();
    await expect(
      alertMerchantOfCancellationRefundReview({
        merchant,
        order,
        senders,
        supabase: supabase as never,
      })
    ).resolves.toBeUndefined();
    expect(senders.sendPush).not.toHaveBeenCalled();
  });
});
