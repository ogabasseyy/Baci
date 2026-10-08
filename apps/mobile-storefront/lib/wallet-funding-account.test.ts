import { describe, expect, it } from '@jest/globals';
import {
  mockFetchWithTimeout,
  mockGetSession,
} from '@/lib/wallet-top-up.test-utils';

const { createWalletFundingAccount, getWalletFundingAccount } =
  require('@/lib/wallet-funding-account') as typeof import('@/lib/wallet-funding-account');

describe('wallet funding account api client', () => {
  it('does not dispatch a Paystack creation for the PiggyVest primary merchant', async () => {
    mockFetchWithTimeout.mockClear();
    await expect(
      createWalletFundingAccount({
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      })
    ).rejects.toThrow('No bank account was created');
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
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

    expect(mockFetchWithTimeout.mock.calls.length).toBeGreaterThan(0);
    const call = mockFetchWithTimeout.mock.calls[0];
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
