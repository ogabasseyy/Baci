import { describe, expect, it, vi } from 'vitest';
import { fileReferenceOnlyPaystackRefundReview } from './file-reference-only-paystack-refund-review';
import {
  listQuery,
  multiLegPayments,
  reviewInput,
} from './file-reference-only-paystack-refund-review.test-support';

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
          reference: 'PSK-1',
          reference_only_refund_event: true,
        }),
        order_id: 'order-1',
        // The open-by-paystack-ref index is global: stamping the shared
        // reference would let the first order's review collide every
        // later order's insert, failing redelivery forever since the
        // merge RPC only searches the colliding order.
        paystack_ref: null,
        reason: expect.stringContaining('PSK-1'),
        txn_id: 'payment-1',
      })
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stays silent when a verified linked row already reconciled the payment', async () => {
    const insert = vi.fn();
    const from = vi
      .fn()
      .mockReturnValueOnce(
        listQuery([
          {
            amount: 100,
            currency: 'NGN',
            metadata: { provider_refund_status: 'processed' },
          },
        ])
      )
      .mockReturnValueOnce({ insert });
    const rpc = vi.fn();

    await fileReferenceOnlyPaystackRefundReview(
      { from, rpc } as never,
      reviewInput
    );

    expect(insert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('files when verified linked rows only partially cover the payment', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        listQuery([
          {
            amount: 40,
            currency: 'NGN',
            metadata: { provider_refund_status: 'processed' },
          },
        ])
      )
      .mockReturnValueOnce(listQuery(multiLegPayments))
      .mockReturnValueOnce({ insert });

    await fileReferenceOnlyPaystackRefundReview(
      { from, rpc: vi.fn() } as never,
      reviewInput
    );

    // The 60 NGN balance may be the provider refund this ID-less event
    // evidences; suppressing would drop the only durable trace.
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
      })
    );
  });

  it('files when the linked row is completed but not provider-verified', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(listQuery([{ currency: 'NGN', metadata: {} }]))
      .mockReturnValueOnce(listQuery(multiLegPayments))
      .mockReturnValueOnce({ insert });

    await fileReferenceOnlyPaystackRefundReview(
      { from, rpc: vi.fn() } as never,
      reviewInput
    );

    // Verification may yet reject the local row; the ID-less event must
    // leave durable evidence instead of being discarded.
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
      })
    );
  });

  it('files when the linked row currency does not match the payment', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        listQuery([
          {
            currency: 'USD',
            metadata: { provider_refund_status: 'processed' },
          },
        ])
      )
      .mockReturnValueOnce(listQuery(multiLegPayments))
      .mockReturnValueOnce({ insert });

    await fileReferenceOnlyPaystackRefundReview(
      { from, rpc: vi.fn() } as never,
      reviewInput
    );

    expect(insert).toHaveBeenCalled();
  });

  it('stays silent when a sole legacy refund already covered the payment', async () => {
    const insert = vi.fn();
    const from = vi
      .fn()
      .mockReturnValueOnce(listQuery([]))
      .mockReturnValueOnce(
        listQuery([{ amount: 100, currency: 'NGN', gateway: 'paystack' }])
      )
      .mockReturnValueOnce(
        listQuery([
          {
            amount: 100,
            currency: 'NGN',
            metadata: { provider_refund_status: 'processed' },
          },
        ])
      )
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
      .mockReturnValueOnce(
        listQuery([{ amount: 100, currency: 'NGN', gateway: 'paystack' }])
      )
      .mockReturnValueOnce(
        listQuery([
          {
            amount: 40,
            currency: 'NGN',
            metadata: { provider_refund_status: 'processed' },
          },
        ])
      )
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

  it('files when sole legacy refunds are not provider-verified', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(listQuery([]))
      .mockReturnValueOnce(
        listQuery([{ amount: 100, currency: 'NGN', gateway: 'paystack' }])
      )
      .mockReturnValueOnce(
        listQuery([{ amount: 100, currency: 'NGN', metadata: {} }])
      )
      .mockReturnValueOnce({ insert });

    await fileReferenceOnlyPaystackRefundReview(
      { from, rpc: vi.fn() } as never,
      reviewInput
    );

    expect(insert).toHaveBeenCalled();
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
