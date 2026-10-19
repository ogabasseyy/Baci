import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetcher = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/orders/authenticated-fetch', () => ({
  createAuthenticatedFetch: fetcher,
}));
vi.mock('./api-client', () => ({ BASE_URL: 'https://example.test' }));

import { requestCheckoutShippingRecovery } from './checkout-shipping-recovery';

const body = {
  action: 'confirm' as const,
  previewId: 'p',
  confirmDestination: true as const,
};
describe('requestCheckoutShippingRecovery', () => {
  beforeEach(() => fetcher.mockReset());
  it('uses authenticated POST and validates confirmation', async () => {
    fetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ quoteId: 'q', confirmed: true }),
    });
    expect(await requestCheckoutShippingRecovery('o', body)).toEqual({
      quoteId: 'q',
      confirmed: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/api/orders/o/shipping/checkout-recovery',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }),
      30000
    );
  });
  it('shows server error and rejects malformed success', async () => {
    fetcher.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Not authorized' }),
    });
    await expect(requestCheckoutShippingRecovery('o', body)).rejects.toThrow(
      'Not authorized'
    );
    fetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ confirmed: false }),
    });
    await expect(requestCheckoutShippingRecovery('o', body)).rejects.toThrow();
  });
  it.each([
    null,
    {},
    { error: 123 },
  ])('uses the fallback for malformed server error %j', async (payload) => {
    fetcher.mockResolvedValue({ ok: false, json: async () => payload });
    await expect(requestCheckoutShippingRecovery('o', body)).rejects.toThrow(
      'Shipping recovery request failed. Please retry.'
    );
  });
});
