import { describe, expect, it, jest } from '@jest/globals';
import {
  mockFetchWithTimeout,
  mockGetSession,
} from '@/lib/wallet-top-up.test-utils';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

describe('storefront customer API client', () => {
  it('trims identifiers and falls back to the configured merchant slug', () => {
    const client = createStorefrontCustomerApiClient();

    expect(
      client.buildMerchantIdentifiers({
        merchantId: ' merchant-1 ',
        merchantSlug: ' ogabassey ',
      })
    ).toEqual({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });
    expect(client.buildMerchantIdentifiers({ merchantSlug: '   ' })).toEqual({
      merchantId: undefined,
      merchantSlug: 'demo-store',
    });
  });

  it('omits content-type for bodyless GET requests', async () => {
    const client = createStorefrontCustomerApiClient();
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true }),
    });

    await expect(
      client.fetchJson({
        path: '/api/storefront/customer/savings/goals',
        query: { merchantSlug: 'ogabassey' },
      })
    ).resolves.toEqual({ ok: true });

    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      'https://usebaci.com/api/storefront/customer/savings/goals?merchantSlug=ogabassey',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer token-123',
        },
        method: 'GET',
      })
    );
  });

  it('sends JSON bodies and authorization headers for POST requests', async () => {
    const client = createStorefrontCustomerApiClient();
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: true }),
    });

    await expect(
      client.fetchJson({
        body: { amount: 20000, goalId: 'goal-1' },
        method: 'POST',
        path: '/api/storefront/customer/savings/contributions/manual',
        query: { merchantId: 'merchant-1' },
      })
    ).resolves.toEqual({ success: true });

    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      'https://usebaci.com/api/storefront/customer/savings/contributions/manual?merchantId=merchant-1&merchantSlug=demo-store',
      expect.objectContaining({
        body: JSON.stringify({ amount: 20000, goalId: 'goal-1' }),
        headers: {
          Authorization: 'Bearer token-123',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })
    );
  });

  it('reuses unexpired access tokens and refreshes inside the safety window', async () => {
    const client = createStorefrontCustomerApiClient();
    const now = new Date('2026-05-24T10:00:00.000Z').getTime();
    const expiresAt = Math.floor((now + 120_000) / 1000);
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: { access_token: 'cached-token', expires_at: expiresAt },
      },
      error: null,
    });
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true }),
    });

    try {
      await client.fetchJson({
        path: '/api/storefront/customer/savings/goals',
      });
      await client.fetchJson({
        path: '/api/storefront/customer/savings/contributions',
      });

      expect(mockGetSession).toHaveBeenCalledTimes(1);
      expect(mockFetchWithTimeout).toHaveBeenNthCalledWith(
        2,
        'https://usebaci.com/api/storefront/customer/savings/contributions',
        expect.objectContaining({
          headers: { Authorization: 'Bearer cached-token' },
        })
      );

      dateNowSpy.mockReturnValue(expiresAt * 1000 - 29_000);
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: 'refreshed-token' } },
        error: null,
      });

      await client.fetchJson({
        path: '/api/storefront/customer/savings/summary',
      });

      expect(mockGetSession).toHaveBeenCalledTimes(2);
      expect(mockFetchWithTimeout).toHaveBeenNthCalledWith(
        3,
        'https://usebaci.com/api/storefront/customer/savings/summary',
        expect.objectContaining({
          headers: { Authorization: 'Bearer refreshed-token' },
        })
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it.each([
    { code: 'BAD_REQUEST', message: 'Invalid input', status: 400 },
    { code: 'UNAUTHORIZED', message: 'Unauthorized', status: 401 },
    { code: 'FORBIDDEN', message: 'Forbidden', status: 403 },
    { code: 'SERVER_ERROR', message: 'Server unavailable', status: 500 },
  ])('throws parsed API errors for HTTP $status responses', async ({
    code,
    message,
    status,
  }) => {
    const client = createStorefrontCustomerApiClient();
    mockFetchWithTimeout.mockResolvedValue({
      ok: false,
      status,
      statusText: 'Error',
      json: async () => ({ code, error: message }),
    });

    await expect(
      client.fetchJson({ path: '/api/storefront/customer/savings/goals' })
    ).rejects.toMatchObject({ code, message });
  });

  it('encodes merchant identifiers with special characters in query strings', async () => {
    const client = createStorefrontCustomerApiClient();
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true }),
    });

    await client.fetchJson({
      path: '/api/storefront/customer/savings/goals',
      query: {
        merchantId: 'merchant id/1',
        merchantSlug: 'ogabassey phones & gadgets',
      },
    });

    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      'https://usebaci.com/api/storefront/customer/savings/goals?merchantId=merchant+id%2F1&merchantSlug=ogabassey+phones+%26+gadgets',
      expect.any(Object)
    );
  });

  it('rejects malformed server JSON responses', async () => {
    const client = createStorefrontCustomerApiClient();
    mockFetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: () => Promise.reject(new Error('Unexpected token')),
    });

    await expect(
      client.fetchJson({ path: '/api/storefront/customer/savings/goals' })
    ).rejects.toThrow('Invalid server response (502 Bad Gateway)');
  });

  it('rejects missing customer sessions', async () => {
    const client = createStorefrontCustomerApiClient();
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(
      client.fetchJson({ path: '/api/storefront/customer/savings/goals' })
    ).rejects.toThrow('Authentication required. Please sign in again.');
  });

  it('sends with the bound token when the session user matches', async () => {
    const client = createStorefrontCustomerApiClient();
    mockGetSession.mockResolvedValue({
      data: {
        session: { access_token: 'token-a', user: { id: 'user-a' } },
      },
      error: null,
    });
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true }),
    });

    await client.fetchJson({
      path: '/api/storefront/customer/savings/goals',
      expectedUserId: 'user-a',
    });

    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { Authorization: 'Bearer token-a' },
      })
    );
  });

  it('throws before sending when the session user differs from expected', async () => {
    const client = createStorefrontCustomerApiClient();
    mockGetSession.mockResolvedValue({
      data: {
        session: { access_token: 'token-b', user: { id: 'user-b' } },
      },
      error: null,
    });
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true }),
    });

    await expect(
      client.fetchJson({
        path: '/api/storefront/customer/savings/goals',
        expectedUserId: 'user-a',
      })
    ).rejects.toThrow('The signed-in account changed. Please try again.');
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('re-reads the session instead of serving a stale cached token for a new account', async () => {
    const client = createStorefrontCustomerApiClient();
    const now = new Date('2026-05-24T10:00:00.000Z').getTime();
    const expiresAt = Math.floor((now + 120_000) / 1000);
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'token-a',
          expires_at: expiresAt,
          user: { id: 'user-a' },
        },
      },
      error: null,
    });
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true }),
    });

    try {
      await client.fetchJson({
        path: '/api/storefront/customer/savings/goals',
        expectedUserId: 'user-a',
      });
      // Account switch: the cached token belongs to the previous user.
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'token-b',
            expires_at: expiresAt,
            user: { id: 'user-b' },
          },
        },
        error: null,
      });
      await client.fetchJson({
        path: '/api/storefront/customer/savings/goals',
        expectedUserId: 'user-b',
      });

      expect(mockGetSession).toHaveBeenCalledTimes(2);
      expect(mockFetchWithTimeout).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({
          headers: { Authorization: 'Bearer token-b' },
        })
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });
});
