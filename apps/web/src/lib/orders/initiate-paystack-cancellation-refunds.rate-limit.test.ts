import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initiatePaystackCancellationRefunds } from './initiate-paystack-cancellation-refunds';
import {
  initiationOrder,
  initiationTransaction,
} from './initiate-paystack-cancellation-refunds.test-helpers';
import {
  DeferredError,
  DeliveryUncertainError,
} from './run-order-cancellation-side-effect';

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

describe('initiatePaystackCancellationRefunds rate-limit exhaustion', () => {
  const insert = vi.fn();
  const eq = vi.fn();
  const update = vi.fn();
  const supabase = { from: vi.fn(() => ({ insert, update })) } as never;
  const order = initiationOrder;
  const transaction = initiationTransaction;

  beforeEach(() => {
    vi.resetAllMocks();
    insert.mockResolvedValue({ error: null });
    eq.mockReturnThis();
    update.mockReturnValue({ eq });
  });

  it('files durable evidence when the last attempt is rate limited', async () => {
    mocks.initiatePaystackRefund.mockResolvedValueOnce({
      code: 'HTTP_429',
      error: 'rate limited',
      success: false,
    });
    mocks.quarantineRefund.mockRejectedValue(
      new DeliveryUncertainError('quarantined')
    );

    await expect(
      initiatePaystackCancellationRefunds({
        isLastAttempt: true,
        order,
        refundedPaymentIds: new Set(),
        supabase,
        transactions: [transaction],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    // Attempts-capped rows never reselect: without this review the leg
    // would strand while cron reports success.
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          ambiguous_initiation: false,
          failed_payment_transaction_id: 'tx-1',
          rate_limit_exhausted: true,
        }),
        preflight: true,
        reason: expect.stringContaining('rate limited on every retry'),
      })
    );
  });

  it('defers with a fresh budget when the last attempt rate limits a later leg after progress', async () => {
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
    mocks.quarantineRefund.mockRejectedValue(
      new DeliveryUncertainError('quarantined')
    );

    // The order-level budget was consumed by the earlier leg: the later
    // leg may never have been attempted, so terminalizing it as
    // exhausted would strand an untouched leg. Defer uncapped instead —
    // the resume retries it with fresh attempts.
    await expect(
      initiatePaystackCancellationRefunds({
        isLastAttempt: true,
        order,
        refundedPaymentIds: new Set(),
        supabase,
        transactions: [transaction, secondLeg],
      })
    ).rejects.toBeInstanceOf(DeferredError);
    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
    // The defer is only safe because the budget reset landed: the
    // resumed run retries the untouched leg fresh instead of
    // mistaking its first failure for exhaustion.
    expect(update).toHaveBeenCalledWith({ attempts: 0 });
  });

  it('defers when the last-attempt rate-limit review cannot be filed', async () => {
    mocks.initiatePaystackRefund.mockResolvedValueOnce({
      code: 'HTTP_429',
      error: 'rate limited',
      success: false,
    });
    mocks.quarantineRefund.mockRejectedValue(
      new Error('Refund requires reconciliation, but filing the review failed')
    );

    const failure = await initiatePaystackCancellationRefunds({
      isLastAttempt: true,
      order,
      refundedPaymentIds: new Set(),
      supabase,
      transactions: [transaction],
    }).then(
      () => {
        throw new Error('expected the filing failure to throw');
      },
      (error: unknown) => error
    );

    // The budget is spent, so a retryable error would strand the leg
    // without evidence; deferred rows reselect uncapped until the review
    // lands.
    expect(failure).toBeInstanceOf(DeferredError);
  });
});
