import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrimaryWalletProviderCustomer } from './primary-wallet-provider';

vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllGlobals());

describe('primary wallet provider adapter', () => {
  it('uses the existing provider client and routes main-wallet interest to the configured payout wallet', async () => {
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
          enable_interest_accrual: true,
          interest_payout_wallet: '01JBZ8Q5W3X9R2K4M6N8P0T2V4',
        }
      )
    ).resolves.toEqual({
      customer_id: 'provider-customer',
      wallet_id: 'provider-wallet',
      new_customer: true,
    });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.piggyvest.business/api/v1/customers?returnIfExist=true'
    );
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({
        enable_interest_accrual: true,
        interest_payout_wallet: '01JBZ8Q5W3X9R2K4M6N8P0T2V4',
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
          enable_interest_accrual: true,
          interest_payout_wallet: '01JBZ8Q5W3X9R2K4M6N8P0T2V4',
        }
      )
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
