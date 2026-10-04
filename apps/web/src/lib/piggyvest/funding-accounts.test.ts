import { describe, expect, it, vi } from 'vitest';
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
const mapping = {
  merchant_id: identity.merchantId,
  customer_id: identity.customerId,
  goal_id: identity.goalId,
};
const wallet = {
  id: identity.providerWalletId,
  business_id: configuration.expectedBusinessId,
  currency: 'NGN',
  balance: 0,
  status: 'active',
};
const account = {
  account_number: '0001234567',
  account_name: 'Synthetic Account',
  bank_name: 'Synthetic Bank',
  paypoint_name: null,
  paypoint_id: null,
};

function dependencies() {
  return {
    configuration,
    resolveTrustedIdentity: vi.fn(async () => identity),
    execute: vi.fn(async () => ({ rows: [mapping] })),
    fetchImplementation: vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: true, data: wallet }))
      .mockResolvedValueOnce(
        Response.json({
          status: true,
          data: [{ ...account, secret: 'private' }],
        })
      ),
  };
}

describe('retrievePiggyvestStagingFundingAccounts', () => {
  it('checks the private local binding before retrieving wallet and projected funding accounts', async () => {
    const options = dependencies();
    await expect(
      retrievePiggyvestStagingFundingAccounts(options)
    ).resolves.toEqual({ status: 'ready', accounts: [account] });
    expect(options.execute).toHaveBeenCalledExactlyOnceWith(
      'SELECT merchant_id, customer_id, goal_id FROM piggyvest_staging.resolve_wallet_mapping($1::uuid, $2::text, $3::text)',
      [
        identity.integrationId,
        identity.providerWalletId,
        identity.providerCustomerId,
      ]
    );
    expect(options.execute.mock.invocationCallOrder[0]).toBeLessThan(
      options.fetchImplementation.mock.invocationCallOrder[0]
    );
    expect(options.fetchImplementation).toHaveBeenNthCalledWith(
      1,
      'https://staging.piggyvest.business/api/v1/wallet/synthetic-wallet',
      expect.objectContaining({ method: 'GET' })
    );
    expect(options.fetchImplementation).toHaveBeenNthCalledWith(
      2,
      'https://staging.piggyvest.business/api/v1/wallet/synthetic-wallet/accounts',
      expect.objectContaining({ method: 'GET' })
    );
    expect(options.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('returns pending for no funding accounts without inventing account details', async () => {
    const options = dependencies();
    options.fetchImplementation
      .mockReset()
      .mockResolvedValueOnce(Response.json({ status: true, data: wallet }))
      .mockResolvedValueOnce(Response.json({ status: true, data: [] }));
    await expect(
      retrievePiggyvestStagingFundingAccounts(options)
    ).resolves.toEqual({ status: 'pending', accounts: [] });
  });

  it.each([
    'merchant_id',
    'customer_id',
    'goal_id',
  ] as const)('rejects mismatched local %s before any provider request', async (field) => {
    const options = dependencies();
    options.execute.mockResolvedValue({
      rows: [{ ...mapping, [field]: identity.integrationId }],
    });
    await expect(
      retrievePiggyvestStagingFundingAccounts(options)
    ).rejects.toMatchObject({ code: 'INVALID_MAPPING' });
    expect(options.fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'missing', rows: [] },
    { label: 'ambiguous', rows: [mapping, mapping] },
    { label: 'malformed', rows: [{ ...mapping, goal_id: undefined }] },
  ])('rejects $label local mappings before network', async ({ rows }) => {
    const options = dependencies();
    const execute = vi.fn(async () => ({ rows }));
    await expect(
      retrievePiggyvestStagingFundingAccounts({
        ...options,
        execute,
      })
    ).rejects.toMatchObject({ code: 'INVALID_MAPPING' });
    expect(execute).toHaveBeenCalledOnce();
    expect(options.fetchImplementation).not.toHaveBeenCalled();
  });

  it('redacts mapping failures and does not use a fallback provider wallet', async () => {
    const options = dependencies();
    options.execute.mockRejectedValue(new Error('private database detail'));
    await expect(
      retrievePiggyvestStagingFundingAccounts(options)
    ).rejects.toMatchObject({
      message: 'PiggyVest staging funding accounts failed: INVALID_MAPPING.',
    });
    expect(options.fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...identity, goalId: undefined },
    { ...identity, merchantId: 'untrusted' },
    { ...identity, arbitraryWallet: 'body-wallet' },
  ])('requires a complete strictly validated trusted identity', async (trustedIdentity) => {
    const options = dependencies();
    await expect(
      retrievePiggyvestStagingFundingAccounts({
        ...options,
        resolveTrustedIdentity: async () => trustedIdentity,
      })
    ).rejects.toMatchObject({ code: 'INVALID_IDENTITY' });
    expect(options.execute).not.toHaveBeenCalled();
    expect(options.fetchImplementation).not.toHaveBeenCalled();
  });

  it('redacts a failed trusted resolver before querying or fetching', async () => {
    const options = dependencies();
    options.resolveTrustedIdentity.mockRejectedValue(
      new Error('private auth detail')
    );
    await expect(
      retrievePiggyvestStagingFundingAccounts(options)
    ).rejects.toMatchObject({
      message: 'PiggyVest staging funding accounts failed: INVALID_IDENTITY.',
    });
    expect(options.execute).not.toHaveBeenCalled();
    expect(options.fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects invalid configuration before resolving identity', async () => {
    const options = dependencies();
    await expect(
      retrievePiggyvestStagingFundingAccounts({
        ...options,
        configuration: {
          ...configuration,
          apiBaseUrl: 'https://api.piggyvest.business',
        },
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    expect(options.resolveTrustedIdentity).not.toHaveBeenCalled();
    expect(options.execute).not.toHaveBeenCalled();
    expect(options.fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    { ...wallet, id: 'another-wallet' },
    { ...wallet, business_id: 'another-business' },
    { ...wallet, currency: 'USD' },
    { ...wallet, balance: '0' },
  ])('requires a verified provider wallet before fetching accounts', async (invalidWallet) => {
    const options = dependencies();
    options.fetchImplementation
      .mockReset()
      .mockResolvedValueOnce(
        Response.json({ status: true, data: invalidWallet })
      );
    await expect(
      retrievePiggyvestStagingFundingAccounts(options)
    ).rejects.toMatchObject({ code: 'WALLET_VERIFICATION_FAILED' });
    expect(options.fetchImplementation).toHaveBeenCalledOnce();
  });

  it.each([
    { status: false, message: 'private detail' },
    { status: true, data: null },
    { status: true, data: [{ ...account, account_number: 123 }] },
  ])('rejects invalid account responses instead of reporting pending', async (response) => {
    const options = dependencies();
    options.fetchImplementation
      .mockReset()
      .mockResolvedValueOnce(Response.json({ status: true, data: wallet }))
      .mockResolvedValueOnce(Response.json(response));
    await expect(
      retrievePiggyvestStagingFundingAccounts(options)
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('redacts account-fetch errors without retries', async () => {
    const options = dependencies();
    options.fetchImplementation
      .mockReset()
      .mockResolvedValueOnce(Response.json({ status: true, data: wallet }))
      .mockRejectedValueOnce(new Error('provider secret'));
    await expect(
      retrievePiggyvestStagingFundingAccounts(options)
    ).rejects.toMatchObject({
      message:
        'PiggyVest staging funding accounts failed: ACCOUNTS_REQUEST_FAILED.',
    });
    expect(options.fetchImplementation).toHaveBeenCalledTimes(2);
  });
});
