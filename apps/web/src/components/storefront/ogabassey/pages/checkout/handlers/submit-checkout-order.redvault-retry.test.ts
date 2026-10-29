import { describe, expect, it, vi } from 'vitest';
import { submitCheckoutOrder } from './submit-checkout-order';

const quote = {
  product_subtotal_kobo: 10_000,
  eligible_subtotal_kobo: 10_000,
  ineligible_subtotal_kobo: 0,
  discount_kobo: 500,
  assurance_fee_kobo: 0,
  tax_kobo: 750,
  shipping_kobo: 0,
  gift_wrapping_kobo: 0,
  payable_kobo: 10_250,
  mixed_basket: false,
};

function options(request: typeof fetch, overrides: Record<string, unknown> = {}) {
  return {
    resolvedPendingOrder: { reusableOrder: null, clearStoredOrder: false },
    getIdempotencyKey: vi.fn().mockResolvedValue('original-attempt-key'),
    orderRequest: {
      merchant_id: 'merchant-1',
      payment_method: 'uba_redvault',
      items: [{ product_id: 'product-1' }],
      shared_cart: {
        cart_id: 'cart-1', cart_version: 3, checkout_generation: 1,
        checkout_session_id: 'session-1',
      },
    },
    paymentMethod: 'uba_redvault',
    total: 102.5,
    onVoucherRejected: vi.fn(),
    onPendingOrderInvalidated: vi.fn(),
    onShippingRateRejected: vi.fn(),
    getOrderErrorMessage: vi.fn().mockReturnValue('Checkout failed'),
    request,
    ...overrides,
  };
}

describe('REDVAULT bound-order response loss', () => {
  it('retries a lost response once with the exact same binding, body and idempotency key', async () => {
    const request = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('network response lost'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        order: { id: 'same-order', total: 102.5 }, redvault: { quote },
      }), { status: 201 }));
    const input = options(request);
    const result = await submitCheckoutOrder(input as never);
    expect(result.order.id).toBe('same-order');
    expect(result.amountDueToGateway).toBe(102.5);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
    expect(input.getIdempotencyKey).toHaveBeenCalledOnce();
    expect(input.onPendingOrderInvalidated).not.toHaveBeenCalled();
  });

  it('stops after one retry and retains the recovery identity if both responses are lost', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    const input = options(request);
    await expect(submitCheckoutOrder(input as never)).rejects.toThrow('offline');
    expect(request).toHaveBeenCalledTimes(2);
    expect(input.getIdempotencyKey).toHaveBeenCalledOnce();
    expect(input.onPendingOrderInvalidated).not.toHaveBeenCalled();
  });

  it('does not retry when the server responds with an error status', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 })
    );
    const input = options(request);
    await expect(submitCheckoutOrder(input as never)).rejects.toThrow('Checkout failed');
    expect(request).toHaveBeenCalledOnce();
    expect(input.onPendingOrderInvalidated).not.toHaveBeenCalled();
  });

  it('does not restart a request deliberately aborted by the caller', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(
      new DOMException('aborted', 'AbortError')
    );
    await expect(submitCheckoutOrder(options(request) as never)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([
    { paymentMethod: 'paystack' },
    { orderRequest: { payment_method: 'uba_redvault', items: [] } },
    { orderRequest: { payment_method: 'uba_redvault', items: [{ voucher_token: 'voucher' }], shared_cart: {} } },
  ])('does not add retries outside the idempotent REDVAULT shared-cart path: %j', async (override) => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    await expect(submitCheckoutOrder(options(request, override) as never)).rejects.toThrow('offline');
    expect(request).toHaveBeenCalledOnce();
  });
});
