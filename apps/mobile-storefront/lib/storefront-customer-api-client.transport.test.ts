import { describe, expect, it } from '@jest/globals';
import { mockFetchWithTimeout } from '@/lib/wallet-top-up.test-utils';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

describe('storefront customer API client', () => {
  it('preserves the exact goal ID in funding queries', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    const client = createStorefrontCustomerApiClient();
    await client.fetchJson({
      path: '/api/storefront/customer/savings/funding',
      query: { merchantId: 'merchant-1', goalId: ' goal-2 ' },
    });
    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      'https://usebaci.com/api/storefront/customer/savings/funding?merchantId=merchant-1&merchantSlug=demo-store&goalId=goal-2',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('sends authenticated PATCH JSON with the requested CSRF token', async () => {
    mockFetchWithTimeout
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'csrf-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });
    const client = createStorefrontCustomerApiClient();
    const signal = new AbortController().signal;
    await client.fetchJson({
      path: '/api/storefront/customer/savings/card-checkout',
      method: 'PATCH',
      includeCsrf: true,
      body: { goalId: 'goal-1' },
      signal,
    });
    expect(mockFetchWithTimeout).toHaveBeenNthCalledWith(
      1,
      'https://usebaci.com/api/csrf',
      expect.objectContaining({
        method: 'GET',
        signal,
        headers: { Authorization: 'Bearer token-123' },
      })
    );
    expect(mockFetchWithTimeout).toHaveBeenNthCalledWith(
      2,
      'https://usebaci.com/api/storefront/customer/savings/card-checkout',
      expect.objectContaining({
        method: 'PATCH',
        signal,
        body: JSON.stringify({ goalId: 'goal-1' }),
        headers: {
          Authorization: 'Bearer token-123',
          'Content-Type': 'application/json',
          'x-csrf-token': 'csrf-token',
        },
      })
    );
  });

  it.each([
    {},
    { token: '' },
    { token: 'unsafe\r\nheader' },
  ])('does not dispatch a mutation when CSRF response is invalid: %j', async (payload) => {
    mockFetchWithTimeout.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => payload,
    });
    const client = createStorefrontCustomerApiClient();
    await expect(
      client.fetchJson({
        path: '/api/storefront/customer/savings/card-checkout',
        method: 'POST',
        includeCsrf: true,
        body: { goalId: 'goal-1' },
      })
    ).rejects.toThrow();
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch a mutation when the CSRF endpoint rejects authentication', async () => {
    mockFetchWithTimeout.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });
    const client = createStorefrontCustomerApiClient();
    await expect(
      client.fetchJson({
        path: '/api/storefront/customer/savings/card-checkout',
        method: 'POST',
        includeCsrf: true,
        body: { goalId: 'goal-1' },
      })
    ).rejects.toThrow('Unauthorized');
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
  });
});
