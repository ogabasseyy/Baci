import { beforeEach, expect, it, vi } from 'vitest';
import { provisioningFixture } from './primary-savings-provisioning.test-support';
import {
  readPrimarySavingsProvisioningRuntime,
  runPrimarySavingsProvisioning,
} from './primary-savings-provisioning-runtime';

const mocks = vi.hoisted(() => ({
  primary: vi.fn(),
  executor: vi.fn(),
  store: vi.fn(),
  provision: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  wallet: vi.fn(),
  accounts: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./primary-wallet-runtime', () => ({
  readPrimaryWalletRuntime: mocks.primary,
}));
vi.mock('./primary-savings-provisioning-executor', () => ({
  createPrimarySavingsProvisioningExecutor: mocks.executor,
}));
vi.mock('./primary-savings-provisioning-store', () => ({
  createPrimarySavingsProvisioningStore: mocks.store,
}));
vi.mock('./primary-savings-provisioning', () => ({
  provisionPrimarySavingsWallet: mocks.provision,
}));
vi.mock('./wallets', () => ({
  createPiggyvestWallet: mocks.create,
  retrievePiggyvestWallet: mocks.wallet,
}));
vi.mock('./primary-savings-provisioning-pagination', () => ({
  listPrimarySavingsProvisioningWallets: mocks.list,
}));
vi.mock('./wallet-funding', () => ({
  retrievePiggyvestFundingAccounts: mocks.accounts,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.primary.mockReturnValue(provisioningFixture.configuration);
  mocks.provision.mockResolvedValue({ status: 'pending' });
});
it('stays disabled without explicit provisioning activation', () => {
  expect(
    readPrimarySavingsProvisioningRuntime({ NODE_ENV: 'test' })
  ).toBeNull();
  expect(mocks.primary).not.toHaveBeenCalled();
});
it('requires a separately provisioned restricted database credential', () => {
  expect(
    readPrimarySavingsProvisioningRuntime({
      NODE_ENV: 'test',
      PIGGYVEST_PRIMARY_SAVINGS_PROVISIONING_ENABLED: 'true',
    })
  ).toBeNull();
  const result = readPrimarySavingsProvisioningRuntime({
    NODE_ENV: 'test',
    PIGGYVEST_PRIMARY_SAVINGS_PROVISIONING_ENABLED: 'true',
    PIGGYVEST_PRIMARY_GOAL_PROVISIONER_DB_PASSWORD: 'test-only-password',
  });
  expect(result?.database.login).toBe(
    'baci_piggyvest_primary_goal_provisioner'
  );
});
it('inherits the primary environment and business-binding fail-closed gate', () => {
  mocks.primary.mockReturnValue(null);
  expect(
    readPrimarySavingsProvisioningRuntime({
      NODE_ENV: 'test',
      PIGGYVEST_PRIMARY_SAVINGS_PROVISIONING_ENABLED: 'true',
    })
  ).toBeNull();
});
it.each([
  'merchantId',
  'integrationId',
  'businessId',
  'environment',
] as const)('refuses configuration/scope mismatch for %s before any effects', async (field) => {
  const scope = {
    ...provisioningFixture.scope,
    [field]:
      field === 'environment'
        ? 'production'
        : field === 'businessId'
          ? 'other'
          : '00000000-0000-4000-8000-000000000099',
  };
  await expect(
    runPrimarySavingsProvisioning({
      configuration: provisioningFixture.configuration,
      scope,
      goalId: provisioningFixture.goalId,
      mode: 'provision',
    })
  ).rejects.toThrow('Savings provisioning configuration unavailable');
  expect(mocks.executor).not.toHaveBeenCalled();
  expect(mocks.provision).not.toHaveBeenCalled();
});
it('wires durable storage and documented provider adapters with a fixed environment origin', async () => {
  await runPrimarySavingsProvisioning({
    configuration: provisioningFixture.configuration,
    scope: provisioningFixture.scope,
    goalId: provisioningFixture.goalId,
    mode: 'recover',
  });
  const adapter = mocks.provision.mock.calls[0][0];
  await adapter.listWallets('customer');
  await adapter.retrieveWallet('wallet');
  await adapter.retrieveAccounts('wallet');
  await adapter.createWallet({
    customerId: 'customer',
    subaccountName: 'name',
    reserveVirtualAccount: true,
    enableInterestAccrual: false,
  });
  const provider = {
    token: 'test-only-token',
    baseUrl: 'https://staging.piggyvest.business',
  };
  expect(mocks.list).toHaveBeenCalledWith(provider, {
    customerId: 'customer',
    walletName: `baci-save:${provisioningFixture.scope.integrationId}:${provisioningFixture.goalId}`,
  });
  expect(mocks.wallet).toHaveBeenCalledWith(provider, 'wallet');
  expect(mocks.accounts).toHaveBeenCalledWith(provider, 'wallet');
  expect(mocks.create).toHaveBeenCalledWith(
    provider,
    expect.objectContaining({ enableInterestAccrual: false })
  );
});
