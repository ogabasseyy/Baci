import type { Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';
import { fileReferenceOnlyPaystackRefundReview } from './file-reference-only-paystack-refund-review';

function listQuery(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {
    limit: vi.fn().mockResolvedValue({ data, error }),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaited thenables.
    then: (resolve: (result: unknown) => void) => resolve({ data, error }),
  };
  for (const key of ['eq', 'gt', 'is', 'not', 'select']) {
    builder[key] = vi.fn().mockReturnValue(builder);
  }
  return builder as unknown as {
    eq: Mock;
    gt: Mock;
    is: Mock;
    limit: Mock;
    not: Mock;
    select: Mock;
  };
}

const reviewInput = {
  amount: 100,
  currency: 'NGN',
  merchantId: 'merchant-1',
  orderId: 'order-1',
  paymentId: 'payment-1',
  paymentReference: 'PSK-1',
};

const multiLegPayments = [
  { amount: 100, gateway: 'paystack' },
  { amount: 50, gateway: 'korapay' },
];

describe('fileReferenceOnlyPaystackRefundReview', () => {
  it('files a durable review when no completed linked row exists', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(listQuery([]))
      .mockReturnValueOnce(listQuery(multiLegPayments))
      .mockReturnValueOnce({ insert });
    const rpc = vi.fn();

    await fileReferenceOnlyPaystackRefundReview(
      { from, rpc } as never,
      reviewInput
    );

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        merchant_id: 'merchant-1',
        metadata: expect.objectContaining({
          audit_record_failed: true,
          payment_transaction_id: 'payment-1',
          reference_only_refund_event: true,
        }),
        order_id: 'order-1',
        paystack_ref: 'PSK-1',
        reason: expect.stringContaining('PSK-1'),
        txn_id: 'payment-1',
      })
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stays silent when a completed linked row already reconciled the payment', async () => {
    const insert = vi.fn();
    const from = vi
      .fn()
      .mockReturnValueOnce(listQuery([{ id: 'refund-9' }]))
      .mockReturnValueOnce({ insert });
    const rpc = vi.fn();

    await fileReferenceOnlyPaystackRefundReview(
      { from, rpc } as never,
      reviewInput
    );

    expect(insert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stays silent when a sole legacy refund already covered the payment', async () => {
    const insert = vi.fn();
    const from = vi
      .fn()
      .mockReturnValueOnce(listQuery([]))
      .mockReturnValueOnce(listQuery([{ amount: 100, gateway: 'paystack' }]))
      .mockReturnValueOnce(listQuery([{ amount: 100 }]))
      .mockReturnValueOnce({ insert });
    const rpc = vi.fn();

    await fileReferenceOnlyPaystackRefundReview(
      { from, rpc } as never,
      reviewInput
    );

    expect(insert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('files when legacy refunds only partially cover the sole payment', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(listQuery([]))
      .mockReturnValueOnce(listQuery([{ amount: 100, gateway: 'paystack' }]))
      .mockReturnValueOnce(listQuery([{ amount: 40 }]))
      .mockReturnValueOnce({ insert });

    await fileReferenceOnlyPaystackRefundReview(
      { from, rpc: vi.fn() } as never,
      reviewInput
    );

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
      })
    );
  });

  it('files when the sole external payment is not a Paystack leg', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(listQuery([]))
      .mockReturnValueOnce(listQuery([{ amount: 100, gateway: 'korapay' }]))
      .mockReturnValueOnce({ insert });

    await fileReferenceOnlyPaystackRefundReview(
      { from, rpc: vi.fn() } as never,
      reviewInput
    );

    expect(insert).toHaveBeenCalled();
  });

  it('merges into the open review on redelivery instead of duplicating', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const from = vi
      .fn()
      .mockReturnValueOnce(listQuery([]))
      .mockReturnValueOnce(listQuery(multiLegPayments))
      .mockReturnValueOnce({ insert });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await fileReferenceOnlyPaystackRefundReview(
      { from, rpc } as never,
      reviewInput
    );

    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_leg_evidence_v1',
      expect.objectContaining({
        p_ambiguous: true,
        p_merchant_id: 'merchant-1',
        p_order_id: 'order-1',
        p_payment_transaction_id: 'payment-1',
      })
    );
  });

  it('fails the webhook when the review cannot be persisted', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: 'ECONNRESET' } });
    const from = vi
      .fn()
      .mockReturnValueOnce(listQuery([]))
      .mockReturnValueOnce(listQuery(multiLegPayments))
      .mockReturnValueOnce({ insert });

    await expect(
      fileReferenceOnlyPaystackRefundReview(
        { from, rpc: vi.fn() } as never,
        reviewInput
      )
    ).rejects.toThrow('reference_only_refund_review_persistence_failed');
  });

  it('fails the webhook when the settled-row lookup fails', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(listQuery(null, new Error('db down')));

    await expect(
      fileReferenceOnlyPaystackRefundReview(
        { from, rpc: vi.fn() } as never,
        reviewInput
      )
    ).rejects.toThrow('refund_event_lookup_failed');
  });
});
