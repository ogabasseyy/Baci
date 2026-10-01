import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initiateRefund: vi.fn(),
  quarantineRefund: vi.fn(),
}));

vi.mock('@/lib/initiate-paystack-refund', () => ({
  initiateRefund: mocks.initiateRefund,
}));
vi.mock('@/lib/orders/build-order-cancellation-email-message', () => ({
  buildOrderCancellationEmailMessage: vi.fn(),
}));
// Bypass the quarantine gate to pin the fail-closed predicate below
// it: production quarantine always throws, but a corrupt amount must
// refuse the provider call on every layer.
vi.mock('@/lib/orders/quarantine-order-cancellation-refund', () => ({
  quarantineRefund: mocks.quarantineRefund,
}));

import { executeOrderCancellationSideEffect } from './execute-order-cancellation-side-effect';
import {
  auditReviewsQuery,
  merchant,
  order,
} from './execute-order-cancellation-side-effect.test-support';

function transactionQuery(data: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn().mockReturnThis(),
  };
}

describe('cancellation refund invalid amounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.quarantineRefund.mockResolvedValue(undefined);
  });

  function legQuery(amount: unknown) {
    return vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'paystack-ref',
            id: 'payment-1',
          },
        ])
      )
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce(auditReviewsQuery([]));
  }

  function runRefund(amount: unknown) {
    return executeOrderCancellationSideEffect({
      merchant,
      order,
      step: 'refund',
      supabase: { from: legQuery(amount) } as never,
    });
  }

  it.each([
    'NaN',
    Number.POSITIVE_INFINITY,
  ])('quarantines a non-finite leg amount (%s) without calling the provider', async (amount) => {
    // Quarantine is mocked to resolve here, so the fail-closed
    // predicate below it is the backstop under test.
    await expect(runRefund(amount)).rejects.toThrow(
      'Completed payment transaction has no refundable amount'
    );

    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining('invalid amount'),
      })
    );
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
  });

  it.each([
    0, -50,
  ])('keeps the fail-closed throw for a non-positive leg amount (%s)', async (amount) => {
    await expect(runRefund(amount)).rejects.toThrow(
      'Completed payment transaction has no refundable amount'
    );

    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
  });
});
