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

describe('initiatePaystackCancellationRefunds config errors', () => {
  const insert = vi.fn();
  const supabase = { from: vi.fn(() => ({ insert })) } as never;
  const order = initiationOrder;
  const transaction = initiationTransaction;

  beforeEach(() => {
    vi.resetAllMocks();
    insert.mockResolvedValue({ error: null });
  });

  it('retries a missing-secret failure without quarantining', async () => {
    mocks.initiatePaystackRefund.mockResolvedValueOnce({
      code: 'CONFIG_ERROR',
      error: 'PAYSTACK_SECRET_KEY is not configured',
      success: false,
    });

    const failure = await initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(),
      supabase,
      transactions: [transaction],
    }).then(
      () => {
        throw new Error('expected the config error to throw');
      },
      (error: unknown) => error
    );

    // Nothing reached Paystack, so terminal quarantine would strand the
    // customer unrefunded behind a delivery_uncertain row that never
    // retries after the secret is restored.
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(DeliveryUncertainError);
    expect(failure).not.toBeInstanceOf(DeferredError);
    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
  });

  it('files durable evidence when the last attempt cannot configure Paystack', async () => {
    mocks.initiatePaystackRefund.mockResolvedValueOnce({
      code: 'CONFIG_ERROR',
      error: 'PAYSTACK_SECRET_KEY is not configured',
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
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          ambiguous_initiation: false,
          config_exhausted: true,
          failed_payment_transaction_id: 'tx-1',
        }),
        preflight: true,
        reason: expect.stringContaining('Paystack was not configured'),
      })
    );
  });
});
