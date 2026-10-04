import { afterEach, describe, expect, it, vi } from 'vitest';
import { retrievePiggyvestStagingFundingAccounts } from './funding-accounts';

const configuration = {
  apiSecret: 'synthetic-secret',
  expectedBusinessId: 'synthetic-business',
};
const identity = {
  environment: 'staging',
  integrationId: '00000000-0000-4000-8000-000000000001',
  merchantId: '00000000-0000-4000-8000-000000000002',
  customerId: '00000000-0000-4000-8000-000000000003',
  goalId: '00000000-0000-4000-8000-000000000004',
  providerWalletId: 'synthetic-wallet',
  providerCustomerId: 'synthetic-customer',
};

function dependencies() {
  return {
    configuration,
    resolveTrustedIdentity: vi.fn(async () => identity),
    execute: vi.fn(async () => ({
      rows: [
        {
          merchant_id: identity.merchantId,
          customer_id: identity.customerId,
          goal_id: identity.goalId,
        },
      ],
    })),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('funding account boundary regressions', () => {
  it.each([
    {},
    { fetchImplementation: undefined },
    { fetchImplementation: null },
    { fetchImplementation: {} },
    { fetchImplementation: 'fetch' },
  ])('rejects missing or non-function fetch before identity, DB or global network', async (injection) => {
    const options = dependencies();
    const globalFetch = vi.fn().mockRejectedValue(new Error('synthetic-only'));
    vi.stubGlobal('fetch', globalFetch);

    const result = await retrievePiggyvestStagingFundingAccounts({
      ...options,
      ...injection,
    } as unknown as Parameters<
      typeof retrievePiggyvestStagingFundingAccounts
    >[0]).catch((error: unknown) => error);

    expect(globalFetch).not.toHaveBeenCalled();
    expect(options.resolveTrustedIdentity).not.toHaveBeenCalled();
    expect(options.execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      code: 'INVALID_FETCH_IMPLEMENTATION',
      message:
        'PiggyVest staging funding accounts failed: INVALID_FETCH_IMPLEMENTATION.',
    });
  });

  it.each([
    'pending',
    'frozen',
    'unknown-provider-status',
    'ACTIVE',
    ' active ',
  ])('does not fetch accounts or return ready for wallet status %s', async (status) => {
    const options = dependencies();
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          status: true,
          data: {
            id: identity.providerWalletId,
            business_id: configuration.expectedBusinessId,
            currency: 'NGN',
            balance: 0,
            status,
          },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          status: true,
          data: [
            {
              account_number: '0001234567',
              account_name: 'Synthetic Account',
              bank_name: 'Synthetic Bank',
              paypoint_name: null,
              paypoint_id: null,
            },
          ],
        })
      );

    const result = await retrievePiggyvestStagingFundingAccounts({
      ...options,
      fetchImplementation,
    }).catch((error: unknown) => error);

    expect(fetchImplementation).toHaveBeenCalledExactlyOnceWith(
      'https://staging.piggyvest.business/api/v1/wallet/synthetic-wallet',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toMatchObject({ code: 'WALLET_VERIFICATION_FAILED' });
    expect(result).not.toHaveProperty('accounts');
    expect(result).not.toHaveProperty('status', 'ready');
  });
});
