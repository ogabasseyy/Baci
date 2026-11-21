import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { finalizeVerificationResponse } from './finalize-verification-response';

const bankOfferInput = {
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
} as const;

it('reports a recorded bank-offer reversal with the real order number', async () => {
  const finalize = vi
    .fn()
    .mockResolvedValue({ kind: 'bank_offer_terminal', status: 'reversed' });
  const response = await finalizeVerificationResponse(bankOfferInput, finalize);

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

it.each([
  [false, 202, null],
  [true, 503, '15'],
] as const)('returns pending or backs off if Paystack is unavailable (%s)', async (providerUnavailable, status, retryAfter) => {
  const finalize = vi.fn().mockResolvedValue({
    kind: 'bank_offer_verification_wait',
    providerUnavailable,
  });
  const response = await finalizeVerificationResponse(bankOfferInput, finalize);
  expect(response.status).toBe(status);
  expect(response.headers.get('Retry-After')).toBe(retryAfter);
  await expect(response.json()).resolves.toMatchObject({
    success: false,
    status: 'pending',
  });
});
