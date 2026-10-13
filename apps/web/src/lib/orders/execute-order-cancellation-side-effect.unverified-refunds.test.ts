import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ initiateRefund: vi.fn() }));

vi.mock('@/lib/initiate-paystack-refund', () => ({
  initiateRefund: mocks.initiateRefund,
}));
vi.mock('@/lib/orders/build-order-cancellation-email-message', () => ({
  buildOrderCancellationEmailMessage: vi.fn(),
}));

import { executeOrderCancellationSideEffect } from './execute-order-cancellation-side-effect';
import { auditReviewsQuery } from './execute-order-cancellation-side-effect.test-support';
import {
  DeferredError,
  DeliveryUncertainError,
} from './run-order-cancellation-side-effect';

const merchant = {
  business_name: 'Store',
  cac_rc_number: null,
  email: 'store@example.com',
  email_sender_name: null,
  id: 'merchant-1',
  slug: 'store',
  support_email: null,
  tax_identification_number: null,
};
const order = {
  amount_paid: 100,
  currency: 'NGN',
  customer_email: 'buyer@example.com',
  customer_id: null,
  customer_name: 'Buyer',
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_items: [],
  order_number: 'ORD-1',
  payment_status: 'paid',
  total: 100,
};

function payment(
  id: string,
  amount: number,
  reference: string,
  status = 'completed'
) {
  return {
    amount,
    currency: 'NGN',
    gateway: 'paystack',
    gateway_reference: reference,
    id,
    status,
  };
}

function completedRefund(
  paymentId: string,
  overrides: Record<string, unknown> = {}
) {
  const { metadata, ...rest } = overrides as {
    metadata?: Record<string, unknown>;
  } & Record<string, unknown>;
  return {
    amount: 100,
    currency: 'NGN',
    gateway: 'paystack',
    gateway_reference: '42',
    metadata: {
      payment_transaction_id: paymentId,
      ...metadata,
    },
    status: 'completed',
    ...rest,
  };
}

function transactionQuery(data: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn().mockReturnThis(),
  };
}

async function runWithRefunds(
  payments: ReturnType<typeof payment>[],
  refunds: ReturnType<typeof completedRefund>[]
) {
  const eq = vi.fn().mockReturnThis();
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi
    .fn()
    .mockReturnValueOnce(transactionQuery(payments))
    .mockReturnValueOnce(transactionQuery(refunds))
    .mockReturnValueOnce(auditReviewsQuery([]))
    .mockReturnValueOnce({ update });
  const error = await executeOrderCancellationSideEffect({
    merchant,
    order,
    step: 'refund',
    supabase: { from } as never,
  }).catch((reason: unknown) => reason);
  return { error, from, update };
}

describe('cancellation unverified refunds', () => {
  beforeEach(() => vi.clearAllMocks());

  it('waits for verification of an unverified full-cover row', async () => {
    const { error, from, update } = await runWithRefunds(
      [payment('payment-1', 100, 'paystack-ref')],
      [completedRefund('payment-1')]
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DeliveryUncertainError);
    expect(error).toBeInstanceOf(DeferredError);
    expect((error as Error).message).toBe(
      'cancellation_refund_awaiting_provider_completion'
    );
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(4);
    expect(update).toHaveBeenCalledWith({ attempts: 0 });
  });

  it('waits instead of quarantining an unverified partial', async () => {
    const { error } = await runWithRefunds(
      [payment('payment-1', 100, 'paystack-ref')],
      [completedRefund('payment-1', { amount: 40 })]
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DeliveryUncertainError);
    expect((error as Error).message).toBe(
      'cancellation_refund_awaiting_provider_completion'
    );
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
  });

  it('defers a paystack leg stuck in refund-pending without initiating', async () => {
    const { error } = await runWithRefunds(
      [payment('payment-1', 100, 'paystack-ref', 'refund_pending')],
      []
    );

    expect(error).toBeInstanceOf(DeferredError);
    expect((error as Error).message).toBe(
      'cancellation_refund_awaiting_provider_completion'
    );
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
  });

  it('lets verified coverage complete despite unverified extras', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([payment('payment-1', 100, 'paystack-ref')])
      )
      .mockReturnValueOnce(
        transactionQuery([
          completedRefund('payment-1', {
            metadata: { provider_refund_status: 'processed' },
          }),
          completedRefund('payment-1', {
            amount: 50,
            gateway_reference: '43',
          }),
        ])
      )
      .mockReturnValueOnce(auditReviewsQuery([]));

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: { from } as never,
      })
    ).resolves.toEqual({ refundIds: [] });
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
  });

  it('waits when one leg is covered and another is unverified', async () => {
    const { error } = await runWithRefunds(
      [
        payment('payment-1', 60, 'paystack-ref-1'),
        payment('payment-2', 40, 'paystack-ref-2'),
      ],
      [
        completedRefund('payment-1', {
          amount: 60,
          metadata: { provider_refund_status: 'processed' },
        }),
        completedRefund('payment-2', { amount: 40 }),
      ]
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DeliveryUncertainError);
    expect((error as Error).message).toBe(
      'cancellation_refund_awaiting_provider_completion'
    );
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
  });
});
