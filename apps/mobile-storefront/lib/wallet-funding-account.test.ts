import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  mockFetchWithTimeout,
  mockGetSession,
} from '@/lib/wallet-top-up.test-utils';

const { createWalletFundingAccount, getWalletFundingAccount } =
  require('@/lib/wallet-funding-account') as typeof import('@/lib/wallet-funding-account');
const { clearPiggyvestPrimaryCapabilityCache } =
  require('@/lib/piggyvest-primary-capability') as typeof import('@/lib/piggyvest-primary-capability');

describe('wallet funding account api client', () => {
  beforeEach(() => {
    clearPiggyvestPrimaryCapabilityCache();
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
