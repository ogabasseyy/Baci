import { beforeEach, expect, it, vi } from 'vitest';
import { submitPrimaryWalletSavings } from './primary-wallet-savings-submission-runtime';

const reconciliation = vi.hoisted(() => vi.fn());
vi.mock('./primary-wallet-savings-reconciliation-runtime', () => ({
  runPrimaryWalletSavingsReconciliation: reconciliation,
}));

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  claimDispatch: vi.fn(),
  cancelBeforeDispatch: vi.fn(),
  retrieve: vi.fn(),
  transfer: vi.fn(),
  executor: vi.fn(),
}));
vi.mock('./primary-wallet-savings-executor', () => ({
  createPrimaryWalletSavingsExecutor: mocks.executor,
}));
vi.mock('./primary-wallet-savings-store', () => ({
  createPrimaryWalletSavingsStore: () => ({
    reserve: mocks.reserve,
    claimDispatch: mocks.claimDispatch,
    cancelBeforeDispatch: mocks.cancelBeforeDispatch,
  }),
}));
vi.mock('./wallets', () => ({ retrievePiggyvestWallet: mocks.retrieve }));
vi.mock('./transfers', () => ({ transferToWallet: mocks.transfer }));
const integrationId = '11111111-1111-4111-8111-111111111111';
const configuration = {
  integrationId,
  environment: 'staging',
  database: {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'baci_piggyvest_primary_authorizer',
    password: 'test-only',
    certificateAuthority: 'test-ca',
  },
};
const scope = {
  integrationId,
  environment: 'staging',
  merchantId: '22222222-2222-4222-8222-222222222222',
  customerId: '33333333-3333-4333-8333-333333333333',
  userId: '44444444-4444-4444-8444-444444444444',
  businessId: 'business',
};
const request = {
  goalId: '55555555-5555-4555-8555-555555555555',
  operationId: '66666666-6666-4666-8666-666666666666',
  amountKobo: 2000,
};
beforeEach(() => {
  reconciliation.mockResolvedValue({ status: 'pending' });
  vi.clearAllMocks();
  mocks.claimDispatch.mockResolvedValue(true);
  mocks.reserve.mockResolvedValue({
    status: 'claimed',
    reservation: {
      ...request,
      sourceWalletId: 'source',
      destinationWalletId: 'destination',
      businessId: 'business',
      reference: 'stable-reference',
    },
  });
  mocks.retrieve.mockImplementation(async (_config, id: string) => ({
    id,
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
    balance: 3000,
  }));
  mocks.transfer.mockResolvedValue({ accepted: true });
});
it('checks pending operations without repeating provider submission', async () => {
  mocks.reserve.mockResolvedValue({ status: 'pending' });
  reconciliation.mockResolvedValue({ status: 'confirmed' });
  const evidence = {
    ...configuration,
    database: {
      ...configuration.database,
      login: 'baci_piggyvest_primary_evidence',
    },
  };
  expect(
    await submitPrimaryWalletSavings({
      configuration,
      reconciliationConfiguration: evidence,
      scope,
      request,
      providerToken: 'test-token',
    })
  ).toEqual({ status: 'confirmed' });
  expect(mocks.transfer).not.toHaveBeenCalled();
  expect(reconciliation).toHaveBeenCalledWith({
    configuration: evidence,
    providerToken: 'test-token',
    operationId: request.operationId,
  });
});
it('submits only the reserved wallets, reference and integer kobo through the existing provider adapter', async () => {
  expect(
    await submitPrimaryWalletSavings({
      configuration,
      scope,
      request,
      providerToken: 'test-token',
    })
  ).toEqual({ status: 'pending' });
  expect(mocks.transfer).toHaveBeenCalledWith(
    { token: 'test-token', baseUrl: 'https://staging.piggyvest.business' },
    {
      amountKobo: 2000,
      sourceWalletId: 'source',
      destinationWalletId: 'destination',
      reference: 'stable-reference',
      narration: 'Savings contribution',
    }
  );
});
it.each([
  ['staging', 'https://staging.piggyvest.business'],
  ['production', 'https://api.piggyvest.business'],
] as const)('binds wallet reads and transfers to the %s provider origin', async (environment, baseUrl) => {
  await submitPrimaryWalletSavings({
    configuration: { ...configuration, environment },
    scope: { ...scope, environment },
    request,
    providerToken: 'test-token',
  });
  expect(mocks.retrieve).toHaveBeenCalledWith(
    { token: 'test-token', baseUrl },
    'source'
  );
  expect(mocks.retrieve).toHaveBeenCalledWith(
    { token: 'test-token', baseUrl },
    'destination'
  );
  expect(mocks.transfer).toHaveBeenCalledWith(
    { token: 'test-token', baseUrl },
    expect.objectContaining({ reference: 'stable-reference' })
  );
});
it('refuses a substituted integration or business before provider submission', async () => {
  await expect(
    submitPrimaryWalletSavings({
      configuration,
      scope: { ...scope, environment: 'production' },
      request,
      providerToken: 'test-token',
    })
  ).rejects.toThrow();
  expect(mocks.reserve).not.toHaveBeenCalled();
  expect(mocks.transfer).not.toHaveBeenCalled();
});
it('does not dispatch stored reservations owned by another business', async () => {
  mocks.reserve.mockResolvedValue({
    status: 'claimed',
    reservation: {
      ...request,
      sourceWalletId: 'source',
      destinationWalletId: 'destination',
      businessId: 'foreign-business',
      reference: 'stable-reference',
    },
  });
  await expect(
    submitPrimaryWalletSavings({
      configuration,
      scope,
      request,
      providerToken: 'test-token',
    })
  ).rejects.toThrow();
  expect(mocks.transfer).not.toHaveBeenCalled();
});
