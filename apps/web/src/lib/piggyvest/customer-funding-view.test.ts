import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPiggyvestCustomerFundingView } from './customer-funding-view';

const identity = {
  environment: 'staging',
  integrationId: '00000000-0000-4000-8000-000000000001',
  merchantId: '00000000-0000-4000-8000-000000000002',
  customerId: '00000000-0000-4000-8000-000000000003',
  goalId: '00000000-0000-4000-8000-000000000004',
  providerWalletId: 'synthetic-wallet',
  providerCustomerId: 'synthetic-customer',
};
const configuration = {
  apiSecret: 'synthetic-secret',
  expectedBusinessId: 'synthetic-business',
  environment: 'staging',
  integrationId: identity.integrationId,
  expectedMerchantId: identity.merchantId,
  expectedProjectId: 'synthetic-project',
  actualProjectId: 'synthetic-project',
  allowlistedCustomerIds: [identity.customerId],
  provisioningApproved: true,
  syntheticIdentityApproved: true,
  fingerprintKey: 'synthetic-fingerprint-key-0000000000',
  fundingDisplayEnabled: true,
};
const mapping = {
  merchant_id: identity.merchantId,
  customer_id: identity.customerId,
  goal_id: identity.goalId,
  restriction_status: 'ready',
};
const wallet = {
  id: identity.providerWalletId,
  business_id: configuration.expectedBusinessId,
  currency: 'NGN',
  status: 'active',
  balance: 0,
};
const account = {
  account_number: '0001234567',
  account_name: 'Synthetic account',
  bank_name: 'Synthetic bank',
  paypoint_id: 'private-paypoint',
  paypoint_name: 'Private paypoint',
  secret: 'private-metadata',
};
function dependencies() {
  return {
    configuration,
    resolveAuthenticatedGoal: vi.fn(async (): Promise<unknown> => identity),
    execute: vi.fn(
      async (): Promise<{ rows: unknown[] }> => ({ rows: [mapping] })
    ),
    fetchImplementation: vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: true, data: wallet }))
      .mockResolvedValueOnce(Response.json({ status: true, data: [account] })),
  };
}
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Global fetch prohibited');
    })
  );
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(console.log).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('readPiggyvestCustomerFundingView', () => {
  it('authenticates once and projects only verified display fields', async () => {
    const options = dependencies();
    await expect(readPiggyvestCustomerFundingView(options)).resolves.toEqual({
      status: 'ready',
      accounts: [
        {
          accountNumber: '0001234567',
          accountName: 'Synthetic account',
          bankName: 'Synthetic bank',
        },
      ],
    });
    expect(options.resolveAuthenticatedGoal).toHaveBeenCalledOnce();
    expect(options.execute).toHaveBeenCalledExactlyOnceWith(
      'SELECT merchant_id, customer_id, goal_id, restriction_status FROM piggyvest_staging.resolve_wallet_mapping($1::uuid, $2::text, $3::text)',
      [
        identity.integrationId,
        identity.providerWalletId,
        identity.providerCustomerId,
      ]
    );
    expect(
      options.resolveAuthenticatedGoal.mock.invocationCallOrder[0]
    ).toBeLessThan(options.execute.mock.invocationCallOrder[0]);
    expect(options.execute.mock.invocationCallOrder[0]).toBeLessThan(
      options.fetchImplementation.mock.invocationCallOrder[0]
    );
    expect(options.fetchImplementation).toHaveBeenCalledTimes(2);
    expect(options.fetchImplementation).toHaveBeenLastCalledWith(
      'https://staging.piggyvest.business/api/v1/wallet/synthetic-wallet/accounts',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
      })
    );
  });

  it.each([
    { fundingDisplayEnabled: false },
    { fundingDisplayEnabled: undefined },
    { environment: 'production' },
    { actualProjectId: 'other-project' },
    { provisioningApproved: false },
    { syntheticIdentityApproved: false },
    { expectedBusinessId: ' ' },
    { apiBaseUrl: 'https://attacker.invalid' },
    { apiBaseUrl: 'https://api.piggyvest.business' },
    { injected: 'metadata' },
  ])('blocks disabled or invalid deployment config before dependencies', async (override) => {
    const options = dependencies();
    await expect(
      readPiggyvestCustomerFundingView({
        ...options,
        configuration: { ...configuration, ...override },
      })
    ).resolves.toEqual({ status: 'unavailable' });
    expect(options.resolveAuthenticatedGoal).not.toHaveBeenCalled();
    expect(options.execute).not.toHaveBeenCalled();
    expect(options.fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    null,
    undefined,
    { ...identity, goalId: undefined },
    { ...identity, integrationId: identity.goalId },
    { ...identity, merchantId: identity.goalId },
    { ...identity, customerId: identity.goalId },
    { ...identity, environment: 'production' },
    { ...identity, accounts: [account] },
    { ...identity, providerWalletId: '../../other' },
  ])('returns unavailable for unauthenticated, mismatched or injected identity', async (resolved) => {
    const options = dependencies();
    options.resolveAuthenticatedGoal.mockResolvedValue(resolved);
    await expect(readPiggyvestCustomerFundingView(options)).resolves.toEqual({
      status: 'unavailable',
    });
    expect(options.resolveAuthenticatedGoal).toHaveBeenCalledOnce();
    expect(options.fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    'merchant_id',
    'customer_id',
    'goal_id',
  ] as const)('rejects stale or mismatched %s mapping before HTTP', async (field) => {
    const options = dependencies();
    options.execute.mockResolvedValue({
      rows: [{ ...mapping, [field]: identity.integrationId }],
    });
    await expect(readPiggyvestCustomerFundingView(options)).resolves.toEqual({
      status: 'unavailable',
    });
    expect(options.fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    { rows: [] },
    { rows: [mapping, mapping] },
    { rows: [{ ...mapping, goal_id: 'invalid' }] },
  ])('rejects missing or ambiguous mapping', async ({ rows }) => {
    const options = dependencies();
    options.execute.mockResolvedValue({ rows });
    await expect(readPiggyvestCustomerFundingView(options)).resolves.toEqual({
      status: 'unavailable',
    });
    expect(options.fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'other' },
    { business_id: 'other' },
    { status: 'inactive' },
    { currency: 'USD' },
  ])('rejects mismatched or inactive wallet', async (override) => {
    const options = dependencies();
    options.fetchImplementation
      .mockReset()
      .mockResolvedValueOnce(
        Response.json({ status: true, data: { ...wallet, ...override } })
      );
    await expect(readPiggyvestCustomerFundingView(options)).resolves.toEqual({
      status: 'unavailable',
    });
    expect(options.fetchImplementation).toHaveBeenCalledOnce();
  });

  it('redacts authentication, storage and provider errors without retry', async () => {
    const options = dependencies();
    options.resolveAuthenticatedGoal.mockRejectedValueOnce(
      new Error('private auth')
    );
    await expect(readPiggyvestCustomerFundingView(options)).resolves.toEqual({
      status: 'unavailable',
    });
    expect(options.execute).not.toHaveBeenCalled();
    options.execute.mockRejectedValueOnce(new Error('private storage'));
    await expect(readPiggyvestCustomerFundingView(options)).resolves.toEqual({
      status: 'unavailable',
    });
    expect(options.fetchImplementation).not.toHaveBeenCalled();
    options.fetchImplementation
      .mockReset()
      .mockResolvedValueOnce(Response.json({ status: true, data: wallet }))
      .mockRejectedValueOnce(new Error('private account number'));
    await expect(readPiggyvestCustomerFundingView(options)).resolves.toEqual({
      status: 'unavailable',
    });
    expect(options.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('drops prior ready accounts after auth loss, pending or malformed response', async () => {
    const options = dependencies();
    expect((await readPiggyvestCustomerFundingView(options)).status).toBe(
      'ready'
    );
    options.resolveAuthenticatedGoal.mockResolvedValueOnce(null);
    await expect(readPiggyvestCustomerFundingView(options)).resolves.toEqual({
      status: 'unavailable',
    });
    options.fetchImplementation
      .mockResolvedValueOnce(Response.json({ status: true, data: wallet }))
      .mockResolvedValueOnce(Response.json({ status: true, data: [] }));
    await expect(readPiggyvestCustomerFundingView(options)).resolves.toEqual({
      status: 'pending',
    });
    options.fetchImplementation
      .mockResolvedValueOnce(Response.json({ status: true, data: wallet }))
      .mockResolvedValueOnce(
        Response.json({
          status: true,
          data: [{ ...account, account_number: 123 }],
        })
      );
    await expect(readPiggyvestCustomerFundingView(options)).resolves.toEqual({
      status: 'unavailable',
    });
  });
});
