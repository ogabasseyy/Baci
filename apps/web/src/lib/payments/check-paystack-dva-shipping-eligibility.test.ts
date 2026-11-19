import { describe, expect, it, vi } from 'vitest';
import { checkPaystackDvaShippingEligibility } from '@/lib/payments/check-paystack-dva-shipping-eligibility';

vi.mock('server-only', () => ({}));

function check(rpcResult: { data: unknown; error: unknown }) {
  return checkPaystackDvaShippingEligibility({
    amountKobo: 500_000,
    client: { rpc: vi.fn().mockResolvedValue(rpcResult) },
    customerEmail: 'buyer@example.com',
    merchantId: 'merchant-1',
    orderId: 'order-1',
    platformFeeKobo: 7_500,
  });
}

describe('checkPaystackDvaShippingEligibility', () => {
  it('allows bank transfer when the order owes Baci no GIG delivery fee', async () => {
    await expect(check({ data: 0, error: null })).resolves.toEqual({
      ok: true,
    });
  });

  it('refuses bank transfer with 409 when a customer-paid GIG fee is still owed', async () => {
    await expect(check({ data: 120_000, error: null })).resolves.toEqual({
      code: 'PAYMENT_METHOD_UNAVAILABLE_FOR_SHIPPING',
      message:
        'Bank transfer is not available for orders with GIG delivery yet. Please pay by card.',
      ok: false,
      status: 409,
    });
  });

  it('fails closed with 503 when the delivery fee cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      check({
        data: null,
        error: { message: 'paystack_split_order_not_found' },
      })
    ).resolves.toEqual({
      code: 'PAYMENT_SPLIT_RESOLUTION_FAILED',
      message: 'Bank transfer is temporarily unavailable. Please pay by card.',
      ok: false,
      status: 503,
    });
  });
});
