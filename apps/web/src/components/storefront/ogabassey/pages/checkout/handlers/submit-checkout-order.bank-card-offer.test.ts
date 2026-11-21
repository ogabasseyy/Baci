import { expect, it, vi } from 'vitest';
import { submitCheckoutOrder } from './submit-checkout-order';
import { orderRequest, response } from './submit-checkout-order.test-support';

it('sends the browser CSRF token and the order idempotency key for a bank offer', async () => {
  const browserFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValue(response({ order: { id: 'new-order' } }));
  vi.stubGlobal('document', { cookie: 'csrf-token=checkout-proof' });
  vi.stubGlobal('fetch', browserFetch);
  try {
    const result = await submitCheckoutOrder({
      resolvedPendingOrder: { reusableOrder: null, clearStoredOrder: false },
      getIdempotencyKey: async () => 'bank-offer-key',
      orderRequest: { ...orderRequest(), payment_method: 'bank_card_offer' },
      paymentMethod: 'paystack',
      total: 4200,
      onVoucherRejected: vi.fn(),
      onPendingOrderInvalidated: vi.fn(async () => undefined),
      onShippingRateRejected: vi.fn(),
      getOrderErrorMessage: () => 'unreachable',
    });

    expect(result.order.id).toBe('new-order');
    expect(browserFetch).toHaveBeenCalledTimes(1);
    expect(browserFetch).toHaveBeenCalledWith(
      '/api/orders',
      expect.objectContaining({ credentials: 'include', method: 'POST' })
    );
    const headers = new Headers(browserFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('x-csrf-token')).toBe('checkout-proof');
    expect(headers.get('idempotency-key')).toBe('bank-offer-key');
  } finally {
    vi.unstubAllGlobals();
  }
});
