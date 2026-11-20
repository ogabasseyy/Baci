import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { finalizeVerificationResponse } from './finalize-verification-response';

it('reports a recorded bank-offer reversal with the real order number', async () => {
  const finalize = vi
    .fn()
    .mockResolvedValue({ kind: 'bank_offer_terminal', status: 'reversed' });
  const response = await finalizeVerificationResponse(
    {
      gateway: 'paystack',
      reference: 'BCO-reference',
      orderId: 'order',
      transaction: {
        amount: 95,
        currency: 'NGN',
        gateway_reference: 'BCO-reference',
        id: 'transaction',
        merchant_id: 'merchant',
        platform_fee: null,
        status: 'completed',
      },
      existingOrder: { order_number: 'ORD-1', total: 95 },
      isBankOfferReference: true,
      supabase: {} as SupabaseClient,
    },
    finalize
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    status: 'reversed',
    success: false,
    orderId: 'order',
    orderNumber: 'ORD-1',
  });
  expect(finalize).toHaveBeenCalledWith(
    expect.objectContaining({ wonTransactionFlip: false })
  );
});
