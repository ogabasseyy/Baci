import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initiateRefund: vi.fn(),
}));

vi.mock('@/lib/orders/check-cancellation-refund-provider', () => ({
  checkCancellationRefundProvider: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/initiate-paystack-refund', () => ({
  initiateRefund: mocks.initiateRefund,
}));

import { executeOrderCancellationSideEffect } from './execute-order-cancellation-side-effect';
import {
  merchant,
  order,
  refundClient,
} from './execute-order-cancellation-side-effect.test-support';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

describe('executeOrderCancellationSideEffect rate-limit exhaustion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('files rate-limit evidence when the drain marks the final attempt', async () => {
    const supabase = refundClient();
    mocks.initiateRefund.mockResolvedValue({
      code: 'HTTP_429',
      error: 'rate limited',
      success: false,
    });

    const error = await executeOrderCancellationSideEffect({
      isLastAttempt: true,
      merchant,
      order,
      step: 'refund',
      supabase: supabase as never,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        reason: expect.stringContaining('rate limited on every retry'),
      })
    );
  });
});
