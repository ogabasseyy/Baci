import { describe, expect, it } from '@jest/globals';
import {
  mockFetchWithTimeout,
  mockGetSession,
} from '@/lib/wallet-top-up.test-utils';

const { piggyvestPrimaryWalletApi } =
  require('./piggyvest-primary-wallet') as typeof import('./piggyvest-primary-wallet');
const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
describe('primary PiggyVest wallet API client', () => {
  it('reads authenticated PiggyVest details without using the legacy Paystack endpoint', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ready',
        balanceKobo: 12345,
        account: {
          accountNumber: '0123456789',
          accountName: 'Test Customer',
          bankName: 'Provider Bank',
          provider: 'piggyvest',
        },
      }),
    });
    expect(await piggyvestPrimaryWalletApi.read(merchantId)).toEqual(
      expect.objectContaining({
        account: expect.objectContaining({ provider: 'piggyvest' }),
        requiresConsent: false,
      })
    );
    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      `https://usebaci.com/api/storefront/customer/wallet/piggyvest-primary?merchantId=${merchantId}`,
      expect.objectContaining({ method: 'GET' })
    );
  });
  it('keeps an unconfirmed account pending rather than displaying invented details', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'pending', account: null }),
    });
    expect(await piggyvestPrimaryWalletApi.read(merchantId)).toEqual({
      account: null,
      requiresConsent: true,
      provisioningStatus: 'pending',
    });
  });
  it('requires consent and valid BVN before any request', async () => {
    await expect(
      piggyvestPrimaryWalletApi.create({
        merchantId,
        bvn: '123',
        consent: true,
      })
    ).rejects.toThrow('Enter a valid 11-digit BVN');
    await expect(
      piggyvestPrimaryWalletApi.create({
        merchantId,
        bvn: '00000000000',
        consent: false,
      })
    ).rejects.toThrow('accept wallet setup');
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });
  it('submits consent and BVN with CSRF and refreshes the provider account afterward', async () => {
    mockFetchWithTimeout
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'csrf-test' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ status: 'pending' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'pending', account: null }),
      });
    await piggyvestPrimaryWalletApi.create({
      merchantId,
      bvn: '00000000000',
      consent: true,
    });
    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      'https://usebaci.com/api/storefront/customer/wallet/piggyvest-primary',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-csrf-token': 'csrf-test' }),
        body: JSON.stringify({ merchantId, bvn: '00000000000', consent: true }),
      })
    );
  });
  it('looks up a fresh access token for every operation', async () => {
    // Far-future expiry: a shared client would cache token-user-a and reuse
    // it after the account switch, leaking the previous user's Bearer [REDACTED]
    mockGetSession
      .mockResolvedValueOnce({
        data: {
          session: { access_token: 'token-user-a', expires_at: 4102444800 },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          session: { access_token: 'token-user-b', expires_at: 4102444800 },
        },
        error: null,
      });
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ready',
        balanceKobo: 0,
        account: {
          accountNumber: '0123456789',
          accountName: 'Test Customer',
          bankName: 'Provider Bank',
          provider: 'piggyvest',
        },
      }),
    });
    await piggyvestPrimaryWalletApi.read(merchantId);
    await piggyvestPrimaryWalletApi.read(merchantId);
    expect(mockFetchWithTimeout).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-user-a',
        }),
      })
    );
    expect(mockFetchWithTimeout).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-user-b',
        }),
      })
    );
  });
});
