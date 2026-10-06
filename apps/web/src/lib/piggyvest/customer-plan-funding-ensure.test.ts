import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./provisioning-client', () => ({
  provisionPiggyvestStagingResource: vi.fn(),
}));
vi.mock('./provisioning-recovery-client', () => ({
  recoverPiggyvestProvisioning: vi.fn(),
}));
vi.mock('./provisioning-recovery-store', () => ({
  createPiggyvestProvisioningRecoveryStore: vi.fn(),
}));
vi.mock('./funding-accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./funding-accounts')>()),
  retrievePiggyvestStagingFundingAccounts: vi.fn(),
}));

import { piggyvestStagingConfigurationSchema } from '@/schemas/piggyvest-staging-configuration';
import { ensurePiggyvestPlanFunding } from './customer-plan-funding-ensure';
import { retrievePiggyvestStagingFundingAccounts } from './funding-accounts';
import { provisionPiggyvestStagingResource } from './provisioning-client';
import { recoverPiggyvestProvisioning } from './provisioning-recovery-client';
import { createPiggyvestProvisioningRecoveryStore } from './provisioning-recovery-store';

const merchantId = '10000000-0000-4000-8000-000000000001';
const customerId = '20000000-0000-4000-8000-000000000001';
const goalId = '30000000-0000-4000-8000-000000000001';
const configuration = {
  apiSecret: 'synthetic-secret',
  expectedBusinessId: 'synthetic-business',
  environment: 'staging',
  integrationId: '40000000-0000-4000-8000-000000000001',
  expectedMerchantId: merchantId,
  expectedProjectId: 'synthetic-project',
  actualProjectId: 'synthetic-project',
  allowlistedCustomerIds: [customerId],
  provisioningApproved: true,
  syntheticIdentityApproved: true,
  fingerprintKey: 'synthetic-fingerprint-key-0000000000',
};
const customer = {
  merchantId,
  customerId,
  goalId,
  bvn: '00000000000',
  name: 'Synthetic Customer',
  email: 'synthetic@example.test',
  phone: '+2340000000000',
};
const base = {
  configuration,
  customer,
  options: { reserveVirtualAccount: true, enableInterestAccrual: false },
  execute: vi.fn(),
  fetchImplementation: vi.fn() as unknown as typeof fetch,
};
const read = vi.fn();
const readCustomerMapping = vi.fn();
const accounts = [
  {
    account_number: '0001234567',
    account_name: 'Synthetic account',
    bank_name: 'Synthetic bank',
    paypoint_id: null,
    paypoint_name: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createPiggyvestProvisioningRecoveryStore).mockReturnValue({
    read,
    readCustomerMapping,
  } as unknown as ReturnType<typeof createPiggyvestProvisioningRecoveryStore>);
  readCustomerMapping.mockResolvedValue({
    outcome: 'none',
    provider_customer_id: null,
  });
  read.mockResolvedValue({
    provider_customer_id: 'synthetic-customer',
    provider_wallet_id: 'synthetic-wallet',
  });
  vi.mocked(provisionPiggyvestStagingResource).mockResolvedValue({
    status: 'awaiting_confirmation',
    intentId: '55555555-5555-4555-8555-555555555555',
  });
  vi.mocked(recoverPiggyvestProvisioning).mockResolvedValue({
    status: 'completed',
  });
  vi.mocked(retrievePiggyvestStagingFundingAccounts).mockResolvedValue({
    status: 'ready',
    accounts,
  });
  vi.mocked(base.execute).mockResolvedValue({ rows: [{ recorded: true }] });
});

describe('ensurePiggyvestPlanFunding', () => {
  it('keeps the customer default wallet ordinary while enabling an opted-in plan wallet', async () => {
    await ensurePiggyvestPlanFunding({
      ...base,
      options: { reserveVirtualAccount: true, enableInterestAccrual: true },
    });

    const commands = vi
      .mocked(provisionPiggyvestStagingResource)
      .mock.calls.map((call) => call[0].command);
    expect(commands[0]).toMatchObject({
      kind: 'create_customer',
      enableInterestAccrual: false,
    });
    expect(commands[1]).toMatchObject({
      kind: 'create_plan_wallet',
      enableInterestAccrual: true,
    });
  });

  it('provisions customer then plan wallet before reading mapped accounts', async () => {
    const result = await ensurePiggyvestPlanFunding(base);

    expect(result).toEqual({
      status: 'ready',
      accounts: [
        {
          accountNumber: '0001234567',
          accountName: 'Synthetic account',
          bankName: 'Synthetic bank',
        },
      ],
    });
    const commands = vi
      .mocked(provisionPiggyvestStagingResource)
      .mock.calls.map((call) => call[0].command);
    expect(commands[0]).toMatchObject({
      kind: 'create_customer',
      bvn: '00000000000',
    });
    expect(commands[1]).toMatchObject({
      kind: 'create_plan_wallet',
      goalId,
      providerCustomerId: 'synthetic-customer',
      reserveVirtualAccount: true,
      customerName: customer.name,
    });
    expect(commands[0]).not.toHaveProperty('goalId');
    const [fundingArguments] = vi.mocked(
      retrievePiggyvestStagingFundingAccounts
    ).mock.calls[0];
    expect(
      piggyvestStagingConfigurationSchema.safeParse(
        fundingArguments.configuration
      ).success
    ).toBe(true);
    expect(fundingArguments.configuration).toEqual({
      apiBaseUrl: 'https://staging.piggyvest.business',
      apiSecret: 'synthetic-secret',
      expectedBusinessId: 'synthetic-business',
      expectedCurrency: 'NGN',
      timeoutMs: 5000,
      maxResponseBytes: 65536,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /synthetic-customer|synthetic-wallet/
    );
    expect(base.execute).toHaveBeenCalledWith(
      expect.stringContaining('record_wallet_goal_mapping'),
      [
        configuration.integrationId,
        'synthetic-wallet',
        'synthetic-customer',
        merchantId,
        customerId,
        goalId,
      ]
    );
  });

  it('stays mapping-pending when the wallet binding cannot be proven durable', async () => {
    vi.mocked(base.execute).mockResolvedValueOnce({ rows: [] });

    const result = await ensurePiggyvestPlanFunding(base);

    expect(result).toEqual({ status: 'pending', code: 'MAPPING_PENDING' });
    expect(
      vi.mocked(retrievePiggyvestStagingFundingAccounts)
    ).not.toHaveBeenCalled();
  });

  it('recovers an already-dispatched customer before provisioning the wallet', async () => {
    vi.mocked(provisionPiggyvestStagingResource).mockResolvedValueOnce({
      status: 'already_dispatched',
      intentId: '55555555-5555-4555-8555-555555555555',
    });

    const result = await ensurePiggyvestPlanFunding(base);

    expect(recoverPiggyvestProvisioning).toHaveBeenCalledOnce();
    expect(result.status).toBe('ready');
  });

  it('reuses a trusted tenant-scoped customer mapping without creating a duplicate customer', async () => {
    readCustomerMapping.mockResolvedValue({
      outcome: 'mapped',
      provider_customer_id: 'mapped-provider-customer',
    });

    const result = await ensurePiggyvestPlanFunding(base);

    expect(result.status).toBe('ready');
    expect(provisionPiggyvestStagingResource).toHaveBeenCalledOnce();
    expect(provisionPiggyvestStagingResource).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({
          kind: 'create_plan_wallet',
          providerCustomerId: 'mapped-provider-customer',
        }),
      })
    );
  });

  it('fails closed on a stale or conflicting trusted customer mapping without provisioning', async () => {
    readCustomerMapping.mockResolvedValue({
      outcome: 'conflict',
      provider_customer_id: null,
    });

    expect(await ensurePiggyvestPlanFunding(base)).toEqual({
      status: 'unavailable',
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(provisionPiggyvestStagingResource).not.toHaveBeenCalled();
  });

  it.each([
    'disabled',
    'business_mismatch',
  ] as const)('does not create a customer when the registry is %s', async (outcome) => {
    readCustomerMapping.mockResolvedValue({
      outcome,
      provider_customer_id: null,
    });

    expect(await ensurePiggyvestPlanFunding(base)).toEqual({
      status: 'unavailable',
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(provisionPiggyvestStagingResource).not.toHaveBeenCalled();
  });

  it('returns unavailable for an unowned existing customer without creating or recovering a wallet', async () => {
    vi.mocked(provisionPiggyvestStagingResource).mockResolvedValueOnce({
      status: 'existing_customer_unowned',
      intentId: '55555555-5555-4555-8555-555555555555',
    });

    const result = await ensurePiggyvestPlanFunding(base);

    expect(result).toEqual({
      status: 'unavailable',
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(provisionPiggyvestStagingResource).toHaveBeenCalledOnce();
    expect(recoverPiggyvestProvisioning).not.toHaveBeenCalled();
    expect(retrievePiggyvestStagingFundingAccounts).not.toHaveBeenCalled();
  });

  it('waits when the wallet dispatch has no stored provider wallet yet', async () => {
    read
      .mockResolvedValueOnce({
        provider_customer_id: 'synthetic-customer',
        provider_wallet_id: 'synthetic-default-wallet',
      })
      .mockResolvedValueOnce({
        provider_customer_id: 'synthetic-customer',
        provider_wallet_id: null,
      });

    const result = await ensurePiggyvestPlanFunding(base);

    expect(result).toEqual({
      status: 'pending',
      code: 'PROVISIONING_IN_PROGRESS',
    });
    expect(retrievePiggyvestStagingFundingAccounts).not.toHaveBeenCalled();
  });

  it('recognizes the real mapping error code rather than its formatted message', async () => {
    const { PiggyvestStagingFundingAccountsError } = await import(
      './funding-accounts'
    );
    vi.mocked(retrievePiggyvestStagingFundingAccounts).mockRejectedValue(
      new PiggyvestStagingFundingAccountsError('INVALID_MAPPING')
    );

    const result = await ensurePiggyvestPlanFunding(base);

    expect(result).toEqual({ status: 'pending', code: 'MAPPING_PENDING' });
  });

  it('stays pending on a restricted wallet so retrieval resumes after the lift', async () => {
    const { PiggyvestStagingFundingAccountsError } = await import(
      './funding-accounts'
    );
    vi.mocked(retrievePiggyvestStagingFundingAccounts).mockRejectedValue(
      new PiggyvestStagingFundingAccountsError('WALLET_RESTRICTED')
    );

    expect(await ensurePiggyvestPlanFunding(base)).toEqual({
      status: 'pending',
      code: 'PROVIDER_UNAVAILABLE',
    });
  });

  it.each([
    'INVALID_CONFIGURATION',
    'INVALID_IDENTITY',
  ] as const)('fails closed for the real %s error', async (code) => {
    const { PiggyvestStagingFundingAccountsError } = await import(
      './funding-accounts'
    );
    vi.mocked(retrievePiggyvestStagingFundingAccounts).mockRejectedValue(
      new PiggyvestStagingFundingAccountsError(code)
    );

    expect(await ensurePiggyvestPlanFunding(base)).toEqual({
      status: 'unavailable',
      code: 'NOT_CONFIGURED',
    });
  });

  it('reports a provisioning conflict without starting a duplicate dispatch', async () => {
    vi.mocked(provisionPiggyvestStagingResource).mockResolvedValueOnce({
      status: 'conflict',
      intentId: '55555555-5555-4555-8555-555555555555',
    });

    const result = await ensurePiggyvestPlanFunding(base);

    expect(result).toEqual({
      status: 'unavailable',
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(provisionPiggyvestStagingResource).toHaveBeenCalledTimes(1);
  });

  it('stays unavailable without staged provisioning approval', async () => {
    const result = await ensurePiggyvestPlanFunding({
      ...base,
      configuration: { ...configuration, provisioningApproved: false },
    });

    expect(result).toEqual({ status: 'unavailable', code: 'NOT_CONFIGURED' });
    expect(provisionPiggyvestStagingResource).not.toHaveBeenCalled();
  });

  it('stays unavailable for a customer outside the staging allowlist', async () => {
    const result = await ensurePiggyvestPlanFunding({
      ...base,
      customer: {
        ...customer,
        customerId: '20000000-0000-4000-8000-000000000099',
      },
    });

    expect(result).toEqual({ status: 'unavailable', code: 'NOT_CONFIGURED' });
    expect(provisionPiggyvestStagingResource).not.toHaveBeenCalled();
  });
});
