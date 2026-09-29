import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initiatePaystackCancellationRefunds } from './initiate-paystack-cancellation-refunds';
import {
  initiationOrder,
  initiationTransaction,
  mockAcceptedRefund,
} from './initiate-paystack-cancellation-refunds.test-helpers';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

const mocks = vi.hoisted(() => ({
  initiatePaystackRefund: vi.fn(),
  quarantineRefund: vi.fn(),
}));

vi.mock('@/lib/initiate-paystack-refund', () => ({
  initiateRefund: mocks.initiatePaystackRefund,
}));

vi.mock('./quarantine-order-cancellation-refund', () => ({
  quarantineRefund: mocks.quarantineRefund,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

describe('initiatePaystackCancellationRefunds failures', () => {
  const insert = vi.fn();
  const supabase = { from: vi.fn(() => ({ insert })) } as never;
  const order = initiationOrder;
  const transaction = initiationTransaction;

  beforeEach(() => {
    vi.resetAllMocks();
    insert.mockResolvedValue({ error: null });
  });

  function acceptedRefund(overrides: Record<string, unknown> = {}) {
    mockAcceptedRefund(mocks.initiatePaystackRefund, overrides);
  }

  it('bounds each leg to the remaining deadline', async () => {
    acceptedRefund();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_200_000);

    try {
      const refundIds = await initiatePaystackCancellationRefunds({
        deadlineMs: 1_270_000,
        order,
        refundedPaymentIds: new Set(),
        supabase,
        transactions: [transaction],
      });

      expect(refundIds).toEqual([101]);
      expect(mocks.initiatePaystackRefund).toHaveBeenCalledWith(
        'PSK-1',
        1250,
        'Order cancelled',
        70_000
      );
    } finally {
      now.mockRestore();
    }
  });

  it('throws a retryable error without calling the provider past the deadline', async () => {
    acceptedRefund();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_270_000);

    try {
      const failure = await initiatePaystackCancellationRefunds({
        deadlineMs: 1_270_000,
        order,
        refundedPaymentIds: new Set(),
        supabase,
        transactions: [transaction],
      }).then(
        () => {
          throw new Error('expected the deadline to throw');
        },
        (error: unknown) => error
      );

      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(DeliveryUncertainError);
      expect((failure as Error).message).toBe(
        'cancellation_refund_deadline_exceeded'
      );
      expect(mocks.initiatePaystackRefund).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
      expect(mocks.quarantineRefund).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it('throws a retriable error on ambiguous provider failures', async () => {
    mocks.initiatePaystackRefund.mockResolvedValue({
      code: 'NETWORK_ERROR',
      error: 'socket hangup',
      success: false,
    });

    const result = initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(),
      supabase,
      transactions: [transaction],
    });

    await expect(result).rejects.toThrow('socket hangup');
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          ambiguous_initiation: true,
          failed_payment_transaction_id: 'tx-1',
        }),
      })
    );
  });

  it('stays retryable when a later leg is rate limited after an accepted leg', async () => {
    const secondLeg = {
      ...transaction,
      gateway_reference: 'PSK-2',
      id: 'tx-2',
    };
    mocks.initiatePaystackRefund
      .mockResolvedValueOnce({
        data: {
          id: 101,
          status: 'queued',
          transaction: { id: 55, reference: 'PSK-1' },
        },
        success: true,
      })
      .mockResolvedValueOnce({
        code: 'HTTP_429',
        error: 'rate limited',
        success: false,
      });

    const failure = await initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(),
      supabase,
      transactions: [transaction, secondLeg],
    }).then(
      () => {
        throw new Error('expected the rate limit to throw');
      },
      (error: unknown) => error
    );

    // The 429 was definitely rejected: quarantining terminally would
    // strand the second leg after the accepted first leg settles. The
    // plain error keeps the step retryable; the drain defers while the
    // accepted leg is in flight, then resumes here with it skipped.
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(DeliveryUncertainError);
    expect((failure as Error).message).toBe('rate limited');
    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('quarantines a deterministic first-leg rejection instead of burning retries', async () => {
    mocks.initiatePaystackRefund.mockResolvedValue({
      code: 'VALIDATION_ERROR',
      error: 'Invalid transaction reference format',
      success: false,
    });
    mocks.quarantineRefund.mockRejectedValue(
      new DeliveryUncertainError('quarantined')
    );

    await expect(
      initiatePaystackCancellationRefunds({
        order,
        refundedPaymentIds: new Set(),
        supabase,
        transactions: [transaction],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    // The provider will never accept this leg on retry: leaving it
    // retryable would burn the five-attempt budget and exclude the row
    // permanently with the customer unrefunded and no review filed.
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          failed_payment_transaction_id: 'tx-1',
        }),
        // Nothing was accepted, so a transient review-write failure
        // must stay retryable instead of terminalizing the step.
        preflight: true,
        reason: expect.stringContaining('rejected'),
      })
    );
    expect(mocks.quarantineRefund.mock.calls[0]?.[0].metadata).toMatchObject({
      ambiguous_initiation: false,
    });
  });

  it('keeps an ambiguous first-leg failure terminal even when the review write fails', async () => {
    mocks.initiatePaystackRefund.mockResolvedValue({
      code: 'HTTP_503',
      error: 'upstream down',
      success: false,
    });
    mocks.quarantineRefund.mockRejectedValue(
      new DeliveryUncertainError('quarantined')
    );

    await expect(
      initiatePaystackCancellationRefunds({
        order,
        refundedPaymentIds: new Set(),
        supabase,
        transactions: [transaction],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    // The provider may have accepted despite the outage: retrying the
    // initiation could double-refund, so no preflight escape.
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        preflight: false,
        reason: expect.stringContaining('ambiguously'),
      })
    );
  });

  it('still quarantines an ambiguous later leg after an accepted leg', async () => {
    const secondLeg = {
      ...transaction,
      gateway_reference: 'PSK-2',
      id: 'tx-2',
    };
    mocks.initiatePaystackRefund
      .mockResolvedValueOnce({
        data: {
          id: 101,
          status: 'queued',
          transaction: { id: 55, reference: 'PSK-1' },
        },
        success: true,
      })
      .mockResolvedValueOnce({
        code: 'HTTP_503',
        error: 'upstream down',
        success: false,
      });
    mocks.quarantineRefund.mockRejectedValue(
      new DeliveryUncertainError('quarantined')
    );

    await expect(
      initiatePaystackCancellationRefunds({
        order,
        refundedPaymentIds: new Set(),
        supabase,
        transactions: [transaction, secondLeg],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    // The provider may have accepted the second leg despite the 503, so
    // it still quarantines terminally with the accepted IDs attached.
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          accepted_refund_ids: [101],
          failed_payment_transaction_id: 'tx-2',
        }),
      })
    );
  });
});
