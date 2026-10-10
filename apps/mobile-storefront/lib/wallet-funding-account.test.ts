import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  mockFetchWithTimeout,
  mockGetSession,
} from '@/lib/wallet-top-up.test-utils';

let mockAuthUserId: string | null = null;
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      user: mockAuthUserId ? { id: mockAuthUserId } : null,
    }),
  },
}));

const { createWalletFundingAccount, getWalletFundingAccount } =
  require('@/lib/wallet-funding-account') as typeof import('@/lib/wallet-funding-account');
const { clearPiggyvestPrimaryCapabilityCache } =
  require('@/lib/piggyvest-primary-capability') as typeof import('@/lib/piggyvest-primary-capability');

describe('wallet funding account api client', () => {
  beforeEach(() => {
    clearPiggyvestPrimaryCapabilityCache();
    mockAuthUserId = null;
  });
  it('requires BVN only after the server confirms primary is available', async () => {
    mockFetchWithTimeout.mockClear();
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'pending', account: null }),
    });
    await expect(
      createWalletFundingAccount({
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      })
    ).rejects.toThrow('No bank account was created');
    expect(
      mockFetchWithTimeout.mock.calls.some(
        ([, options]) =>
          typeof options === 'object' &&
          options !== null &&
          (options as { method?: string }).method === 'POST'
      )
    ).toBe(false);
  });
  it('creates the legacy DVA when primary is unconfigured, even without BVN', async () => {
    mockFetchWithTimeout.mockClear();
    mockFetchWithTimeout
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({
          error: 'Wallet access is temporarily unavailable.',
          code: 'PIGGYVEST_NOT_READY',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          account: {
            accountName: 'Ogabassey/Jane Doe',
            accountNumber: '1234567890',
            bankName: 'Titan Paystack',
            provider: 'paystack',
          },
          requiresConsent: false,
        }),
      });
    await expect(
      createWalletFundingAccount({
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      })
    ).resolves.toMatchObject({
      account: { accountNumber: '1234567890', provider: 'paystack' },
    });
    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/storefront/customer/wallet/funding-account'
      ),
      expect.objectContaining({ method: 'POST' })
    );
  });
  it('revalidates a stale positive before demanding BVN, rerouting to legacy when the server stood down', async () => {
    mockFetchWithTimeout.mockClear();
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'pending', account: null }),
    });
    // First attempt observes primary-enabled and demands BVN.
    await expect(
      createWalletFundingAccount({
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      })
    ).rejects.toThrow('No bank account was created');
    // The server disables the integration afterwards: the next
    // BVN-less attempt must re-probe and mint legacy instead of
    // failing the preflight on the stale cached verdict.
    mockFetchWithTimeout.mockClear();
    mockFetchWithTimeout
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({
          error: 'Wallet access is temporarily unavailable.',
          code: 'PIGGYVEST_NOT_READY',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          account: {
            accountName: 'Ogabassey/Jane Doe',
            accountNumber: '1234567890',
            bankName: 'Titan Paystack',
            provider: 'paystack',
          },
          requiresConsent: false,
        }),
      });
    await expect(
      createWalletFundingAccount({
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      })
    ).resolves.toMatchObject({
      account: { accountNumber: '1234567890', provider: 'paystack' },
    });
    expect(mockFetchWithTimeout).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        '/api/storefront/customer/wallet/piggyvest-primary'
      ),
      expect.objectContaining({ method: 'GET' })
    );
    expect(mockFetchWithTimeout).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        '/api/storefront/customer/wallet/funding-account'
      ),
      expect.objectContaining({ method: 'POST' })
    );
  });
  it('keeps the BVN demand when revalidation fails ambiguously on a stale positive', async () => {
    mockFetchWithTimeout.mockClear();
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'pending', account: null }),
    });
    await expect(
      createWalletFundingAccount({
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      })
    ).rejects.toThrow('No bank account was created');
    mockFetchWithTimeout.mockClear();
    mockFetchWithTimeout.mockRejectedValue(new Error('network down'));
    await expect(
      createWalletFundingAccount({
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      })
    ).rejects.toThrow('No bank account was created');
    expect(
      mockFetchWithTimeout.mock.calls.some(
        ([, options]) =>
          typeof options === 'object' &&
          options !== null &&
          (options as { method?: string }).method === 'POST'
      )
    ).toBe(false);
  });
  it('probes an unobserved merchant before creating a legacy DVA', async () => {
    mockFetchWithTimeout.mockClear();
    mockFetchWithTimeout
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({
          error: 'Wallet access is temporarily unavailable.',
          code: 'PIGGYVEST_NOT_READY',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          account: {
            accountName: 'Ogabassey/Jane Doe',
            accountNumber: '1234567890',
            bankName: 'Titan Paystack',
            provider: 'paystack',
          },
          requiresConsent: false,
        }),
      });
    await expect(
      createWalletFundingAccount({
        merchantId: '00000000-0000-4000-8000-000000000002',
      })
    ).resolves.toMatchObject({
      account: { accountNumber: '1234567890', provider: 'paystack' },
    });
    // Authoritative negative first, legacy mint second — never legacy
    // on a cold-start guess.
    expect(mockFetchWithTimeout).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        '/api/storefront/customer/wallet/piggyvest-primary'
      ),
      expect.objectContaining({ method: 'GET' })
    );
    expect(mockFetchWithTimeout).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        '/api/storefront/customer/wallet/funding-account'
      ),
      expect.objectContaining({ method: 'POST' })
    );
  });
  it('routes an unobserved server-enabled merchant to primary, never legacy', async () => {
    mockFetchWithTimeout.mockClear();
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'pending', account: null }),
    });
    await expect(
      createWalletFundingAccount({
        merchantId: '00000000-0000-4000-8000-000000000003',
      })
    ).rejects.toThrow('No bank account was created');
    expect(
      mockFetchWithTimeout.mock.calls.some(
        ([, options]) =>
          typeof options === 'object' &&
          options !== null &&
          (options as { method?: string }).method === 'POST'
      )
    ).toBe(false);
  });
  it('binds primary creation to the signed-in account by default', async () => {
    mockAuthUserId = 'user-1';
    mockGetSession.mockResolvedValue({
      data: {
        session: { access_token: 'token-2', user: { id: 'user-2' } },
      },
      error: null,
    });
    mockFetchWithTimeout.mockClear();
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'pending', account: null }),
    });
    await expect(
      createWalletFundingAccount({
        merchantId: '00000000-0000-4000-8000-000000000005',
        bvn: '12345678901',
        consent: true,
      })
    ).rejects.toThrow('The signed-in account changed. Please try again.');
    // The verdict probe (merchant-wide boolean only) may run unbound,
    // but the BVN-carrying POST never leaves the device.
    expect(
      mockFetchWithTimeout.mock.calls.some(
        ([, options]) =>
          typeof options === 'object' &&
          options !== null &&
          (options as { method?: string }).method === 'POST'
      )
    ).toBe(false);
  });
  it('prefers an explicit caller userId over the signed-in account', async () => {
    mockAuthUserId = 'user-2';
    mockFetchWithTimeout.mockClear();
    mockFetchWithTimeout
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({
          error: 'Wallet access is temporarily unavailable.',
          code: 'PIGGYVEST_NOT_READY',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          account: {
            accountName: 'Ogabassey/Jane Doe',
            accountNumber: '1234567890',
            bankName: 'Titan Paystack',
            provider: 'paystack',
          },
          requiresConsent: false,
        }),
      });
    // Default session user is user-1: the explicit bind succeeds where
    // the signed-in default (user-2) would throw before sending.
    await expect(
      createWalletFundingAccount({
        merchantId: '00000000-0000-4000-8000-000000000006',
        userId: 'user-1',
      })
    ).resolves.toMatchObject({
      account: { accountNumber: '1234567890' },
    });
  });
  it('refuses to mint a legacy DVA when the probe fails ambiguously', async () => {
    mockFetchWithTimeout.mockClear();
    mockFetchWithTimeout.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      createWalletFundingAccount({
        merchantId: '00000000-0000-4000-8000-000000000004',
      })
    ).rejects.toThrow();
    expect(
      mockFetchWithTimeout.mock.calls.some(
        ([url]) =>
          typeof url === 'string' &&
          url.includes('/api/storefront/customer/wallet/funding-account')
      )
    ).toBe(false);
  });
  it('falls back to the legacy funding account when primary is unconfigured', async () => {
    mockFetchWithTimeout.mockClear();
    mockFetchWithTimeout
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({
          error: 'Wallet access is temporarily unavailable.',
          code: 'PIGGYVEST_NOT_READY',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          account: {
            accountName: 'Ogabassey/Jane Doe',
            accountNumber: '1234567890',
            bankName: 'Titan Paystack',
            provider: 'paystack',
          },
          requiresConsent: false,
        }),
      });
    await expect(
      getWalletFundingAccount({
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      })
    ).resolves.toMatchObject({
      account: { accountNumber: '1234567890', provider: 'paystack' },
    });
    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/storefront/customer/wallet/funding-account'
      ),
      expect.objectContaining({ method: 'GET' })
    );
  });
  it('does not return the legacy funding account for the PiggyVest primary merchant', async () => {
    mockFetchWithTimeout.mockClear();
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'pending', account: null }),
    });
    await expect(
      getWalletFundingAccount({
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      })
    ).resolves.toEqual({
      account: null,
      requiresConsent: true,
      provisioningStatus: 'pending',
    });
    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      'https://usebaci.com/api/storefront/customer/wallet/piggyvest-primary?merchantId=6b5cb8a4-5575-456c-b936-8cdfae30db74',
      expect.objectContaining({ method: 'GET' })
    );
  });
  it('fetches the customer funding account with merchant slug fallback', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        account: {
          accountName: 'Ogabassey/Jane Doe',
          accountNumber: '1234567890',
          bankName: 'Titan Paystack',
          provider: 'paystack',
        },
        requiresConsent: false,
      }),
    });

    await expect(getWalletFundingAccount({})).resolves.toEqual({
      account: {
        accountName: 'Ogabassey/Jane Doe',
        accountNumber: '1234567890',
        bankName: 'Titan Paystack',
        provider: 'paystack',
      },
      requiresConsent: false,
    });

    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      'https://usebaci.com/api/storefront/customer/wallet/funding-account?merchantSlug=demo-store',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer token-123',
        },
        method: 'GET',
      })
    );
  });

  it('creates the customer funding account with explicit merchant id and slug', async () => {
    mockFetchWithTimeout.mockClear();
    // Unobserved merchant: the capability probe runs first and its
    // authoritative negative routes this create to the legacy POST.
    mockFetchWithTimeout
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({
          error: 'Wallet access is temporarily unavailable.',
          code: 'PIGGYVEST_NOT_READY',
        }),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          account: {
            accountName: 'Ogabassey/Jane Doe',
            accountNumber: '1234567890',
            bankName: 'Titan Paystack',
            provider: 'paystack',
          },
          requiresConsent: false,
        }),
      });

    await expect(
      createWalletFundingAccount({
        merchantId: '00000000-0000-4000-8000-000000000001',
        merchantSlug: 'ogabassey',
      })
    ).resolves.toMatchObject({
      account: {
        accountNumber: '1234567890',
      },
      requiresConsent: false,
    });

    expect(mockFetchWithTimeout.mock.calls.length).toBeGreaterThan(1);
    const call = mockFetchWithTimeout.mock.calls.find(
      ([, options]) =>
        typeof options === 'object' &&
        options !== null &&
        (options as { method?: string }).method === 'POST'
    );
    expect(call).toBeDefined();
    const requestOptions = call?.[1];
    expect(requestOptions).toBeDefined();
    expect(requestOptions).toEqual(expect.any(Object));
    if (!requestOptions || typeof requestOptions !== 'object') {
      throw new Error('Expected request options');
    }
    expect(requestOptions).toEqual(
      expect.objectContaining({
        method: 'POST',
      })
    );
    const body = 'body' in requestOptions ? requestOptions.body : undefined;
    expect(typeof body).toBe('string');
    if (typeof body !== 'string') {
      throw new Error('Expected request body');
    }
    expect(JSON.parse(body)).toEqual({
      consent: true,
      merchantId: '00000000-0000-4000-8000-000000000001',
      merchantSlug: 'ogabassey',
    });
  });

  it('throws when auth session token is missing', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(createWalletFundingAccount({})).rejects.toThrow(
      'Authentication required. Please sign in again.'
    );
  });

  it('throws the server error message when the API returns a non-OK response', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({
        error: 'Wallet bank transfer funding is not enabled',
      }),
    });

    await expect(getWalletFundingAccount({})).rejects.toThrow(
      'Wallet bank transfer funding is not enabled'
    );
  });

  it('throws when the API response is not valid JSON', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => {
        throw new Error('Unexpected token');
      },
    });

    await expect(getWalletFundingAccount({})).rejects.toThrow(
      'Invalid server response (200 OK): Unexpected token'
    );
  });

  it('throws when the API payload does not match the funding account schema', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        account: {
          accountName: 'Ogabassey/Jane Doe',
          accountNumber: '1234567890',
          bankName: 'Titan Paystack',
          provider: 'other',
        },
        requiresConsent: false,
      }),
    });

    await expect(getWalletFundingAccount({})).rejects.toThrow(
      'Invalid wallet funding account get response'
    );
  });
});
