import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockApiPost } = vi.hoisted(() => ({
  mockApiPost: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiPost: mockApiPost,
}));

import { requestShippingOptions } from './shipping-options-quote-request';

describe('requestShippingOptions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockApiPost.mockReset();
  });

  it('uses the web storefront marker while posting the domestic quote request', async () => {
    mockApiPost.mockResolvedValue({ ok: true });

    await expect(
      requestShippingOptions({
        merchantId: 'merchant-1',
        receiverCity: 'Lagos',
        receiverState: 'Lagos',
        receiverAddress: '1 Marina Road',
        receiverPhone: '08000000000',
        receiverName: 'Ada',
        quoteItems: [{ name: 'Phone', quantity: 1, weight: 1, value: 5000 }],
        cartSubtotal: 5000,
      })
    ).resolves.toEqual({ ok: true });

    expect(mockApiPost).toHaveBeenCalledWith(
      '/api/shipping/quotes',
      expect.objectContaining({
        merchantId: 'merchant-1',
        shipmentType: 'domestic',
        cart_subtotal: 5000,
      }),
      { headers: { 'x-baci-client': 'web-storefront' } }
    );
  });

  it('forwards the selected destination pin to the courier quote request', async () => {
    mockApiPost.mockResolvedValue({ quotes: [] });
    await requestShippingOptions({
      merchantId: 'merchant-1',
      receiverCity: 'Ikeja',
      receiverState: 'Lagos',
      receiverAddress: '1 Synthetic Road',
      receiverPhone: '08000000000',
      receiverName: 'Test Buyer',
      receiverLatitude: 6.6,
      receiverLongitude: 3.35,
      quoteItems: [],
      cartSubtotal: 5000,
    });
    expect(mockApiPost).toHaveBeenCalledWith(
      '/api/shipping/quotes',
      expect.objectContaining({
        receiver: expect.objectContaining({ latitude: 6.6, longitude: 3.35 }),
      }),
      expect.any(Object)
    );
  });

  it('propagates quote request failures without hiding the provider error', async () => {
    const error = new Error('quote request failed');
    mockApiPost.mockRejectedValue(error);

    await expect(
      requestShippingOptions({
        merchantId: 'merchant-1',
        receiverCity: 'Lagos',
        receiverState: 'Lagos',
        receiverAddress: '1 Marina Road',
        receiverPhone: '08000000000',
        receiverName: 'Ada',
        quoteItems: [{ name: 'Phone', quantity: 1, weight: 1, value: 5000 }],
        cartSubtotal: 5000,
      })
    ).rejects.toBe(error);

    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });
});
