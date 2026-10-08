import { afterEach, expect, it, vi } from 'vitest';
import { createPrimaryWalletProviderCustomer } from './primary-wallet-provider';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { retrievePiggyvestFundingAccounts } from './wallet-funding';
import { retrievePiggyvestWallet } from './wallets';

vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllGlobals());

it.each([
  ['staging', 'https://staging.piggyvest.business'],
  ['production', 'https://api.piggyvest.business'],
])('uses the exact %s origin through the existing customer, wallet and account transports', async (environment, origin) => {
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(input);
    const data =
      url.pathname === '/api/v1/customers'
        ? {
            customer_id: 'customer-with-hyphens',
            wallet_id: 'wallet-with-hyphens',
            new_customer: true,
          }
        : url.pathname.endsWith('/accounts')
          ? [
              {
                account_number: '0123456789',
                account_name: 'Synthetic',
                bank_name: 'Synthetic Bank',
                paypoint_name: null,
                paypoint_id: null,
              },
            ]
          : {
              id: 'wallet-with-hyphens',
              business_id: 'business',
              name: 'Synthetic',
              status: 'active',
              type: 'api',
              currency: 'NGN',
              balance: 0,
              withdrawal_count: 0,
              creation_interest_rate: 0,
              current_interest_rate: 0,
            };
    return Response.json({ status: true, message: 'Synthetic fixture', data });
  });
  vi.stubGlobal('fetch', fetcher);
  const provider = {
    token: 'test-only-token',
    baseUrl: getPrimaryWalletProviderOrigin(environment),
  };
  await createPrimaryWalletProviderCustomer(provider, {
    bvn: '00000000000',
    email: 'fixture@example.com',
    name: 'Synthetic',
    phone: '08000000000',
    third_party_identifier: 'synthetic-correlation',
    enable_interest_accrual: false,
  });
  await retrievePiggyvestWallet(provider, 'wallet-with-hyphens');
  await retrievePiggyvestFundingAccounts(provider, 'wallet-with-hyphens');
  expect(fetcher).toHaveBeenNthCalledWith(
    1,
    `${origin}/api/v1/customers?returnIfExist=true`,
    expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"enable_interest_accrual":false'),
    })
  );
  expect(fetcher).toHaveBeenNthCalledWith(
    2,
    `${origin}/api/v1/wallet/wallet-with-hyphens`,
    expect.objectContaining({ method: 'GET' })
  );
  expect(fetcher).toHaveBeenNthCalledWith(
    3,
    `${origin}/api/v1/wallet/wallet-with-hyphens/accounts`,
    expect.objectContaining({ method: 'GET' })
  );
});

it.each([
  undefined,
  null,
  '',
  'production ',
  'https://caller.example',
  'sandbox',
])('rejects unknown environment %s instead of silently selecting production', (environment) => {
  expect(() => getPrimaryWalletProviderOrigin(environment)).toThrow();
});
