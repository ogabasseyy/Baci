import { describe, expect, it } from '@jest/globals';
import { mockFetchWithTimeout } from '@/lib/wallet-top-up.test-utils';

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
});
