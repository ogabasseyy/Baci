import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrimaryWalletProviderCustomer } from './primary-wallet-provider';

vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllGlobals());

describe('primary wallet provider adapter', () => {
  it('uses the existing provider client and transmits explicit ordinary-wallet interest policy', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          message: 'Created',
          data: {
            customer_id: 'provider-customer',
            wallet_id: 'provider-wallet',
            new_customer: true,
          },
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetcher);
    await expect(
      createPrimaryWalletProviderCustomer(
        { token: 'test-token' },
        {
          bvn: '00000000000',
          email: 'test@example.com',
          name: 'Test Customer',
          phone: '08000000000',
          third_party_identifier: 'test-correlation',
          enable_interest_accrual: false,
        }
      )
    ).resolves.toEqual({
      customer_id: 'provider-customer',
      wallet_id: 'provider-wallet',
      new_customer: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.piggyvest.business/api/v1/customers?returnIfExist=true',
      expect.objectContaining({
        body: expect.stringContaining('"enable_interest_accrual":false'),
      })
    );
  });

  it('rejects malformed BVN without contacting the provider', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      createPrimaryWalletProviderCustomer(
        { token: 'test-token' },
        {
          bvn: '123',
          email: 'test@example.com',
          name: 'Test Customer',
          phone: '08000000000',
          third_party_identifier: 'test-correlation',
          enable_interest_accrual: false,
        }
      )
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
