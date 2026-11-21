import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  auditReviewsQuery,
  executeOrderCancellationSideEffect,
  merchant,
  mocks,
  order,
  transactionQuery,
} from './execute-order-cancellation-side-effect.accepted-refund.test-support';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

describe('cancellation with mixed refunds', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    { isLastAttempt: false, mismatch: false },
    { isLastAttempt: true, mismatch: false },
    { isLastAttempt: false, mismatch: true },
  ])('saves a later refund without completing a mixed refund run ($isLastAttempt, $mismatch)', async ({
    isLastAttempt,
    mismatch,
  }) => {
    const bankReference = `BCO-${'a'.repeat(32)}`;
    const refundInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 60,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: bankReference,
            id: 'payment-1',
          },
          {
            amount: 40,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'regular-fixture',
            id: 'payment-2',
          },
        ])
      )
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce(auditReviewsQuery([]))
      .mockReturnValue({ insert: refundInsert });
    const rpc = vi
      .fn()
      .mockResolvedValue(
        mismatch
          ? { data: null, error: null }
          : { data: null, error: { code: '57014' } }
      );
    mocks.initiateRefund.mockResolvedValue({
      success: true,
      data: {
        id: 42,
        status: 'pending',
        transaction: { id: 123, reference: 'regular-fixture' },
      },
    });

    const result = executeOrderCancellationSideEffect({
      isLastAttempt,
      merchant,
      order,
      step: 'refund',
      supabase: { from, rpc } as never,
    });
    if (isLastAttempt || mismatch) {
      await expect(result).rejects.toBeInstanceOf(DeliveryUncertainError);
      expect(refundInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_type: 'order_cancellation_refund_requires_review',
          candidates: [
            expect.objectContaining({ paymentTransactionId: 'payment-1' }),
          ],
          metadata: {
            accepted_refund_ids: [42],
            ambiguous_initiation: false,
            ...(mismatch
              ? {}
              : { bank_offer_capture_lookup_unavailable: true }),
          },
        })
      );
    } else {
      await expect(result).rejects.toMatchObject({
        message: 'Unable to verify bank card offer refund capture',
        refundIds: [42],
      });
    }
    expect(rpc).toHaveBeenCalledWith(
      'get_bank_card_offer_refundable_amount',
      expect.objectContaining({ p_reference: bankReference })
    );
    expect(mocks.initiateRefund).toHaveBeenCalledTimes(1);
    expect(mocks.initiateRefund).toHaveBeenCalledWith(
      'regular-fixture',
      4000,
      'Order cancelled',
      undefined
    );
    expect(refundInsert).toHaveBeenCalledWith(
      expect.objectContaining({ gateway_reference: '42' })
    );
  });
});
