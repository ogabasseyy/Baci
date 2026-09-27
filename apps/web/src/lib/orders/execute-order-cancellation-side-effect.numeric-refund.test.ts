import { expect, it, vi } from 'vitest';

const initiateRefund = vi.hoisted(() => vi.fn());
vi.mock('@/lib/initiate-paystack-refund', () => ({ initiateRefund }));
vi.mock('@/lib/orders/build-order-cancellation-email-message', () => ({
  buildOrderCancellationEmailMessage: vi.fn(),
}));

import { executeOrderCancellationSideEffect } from './execute-order-cancellation-side-effect';

it('records Paystack numeric transaction IDs for later provider verification', async () => {
  const refundInsert = vi.fn().mockResolvedValue({ error: null });
  const transactionQuery = (data: unknown) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error: null }),
  });
  const from = vi
    .fn()
    .mockReturnValueOnce(
      transactionQuery([
        {
          id: 'payment-1',
          amount: 100,
          currency: 'NGN',
          gateway: 'paystack',
          gateway_reference: 'PSK-1',
        },
      ])
    )
    .mockReturnValueOnce(transactionQuery([]))
    .mockReturnValueOnce({ insert: refundInsert });
  initiateRefund.mockResolvedValueOnce({
    success: true,
    data: { id: 42, status: 'pending', transaction: 123 },
  });

  await expect(
    executeOrderCancellationSideEffect({
      merchant: { id: 'merchant-1' } as never,
      order: {
        id: 'order-1',
        merchant_id: 'merchant-1',
        order_number: 'ORD-1',
        amount_paid: 100,
        currency: 'NGN',
        payment_status: 'paid',
      } as never,
      step: 'refund',
      supabase: { from } as never,
    })
  ).resolves.toEqual({ refundIds: [42] });

  expect(refundInsert).toHaveBeenCalledWith(
    expect.objectContaining({
      gateway_reference: '42',
      status: 'refund_pending',
      metadata: expect.objectContaining({
        payment_transaction_id: 'payment-1',
        provider_payment_transaction_id: 123,
      }),
    })
  );
});
