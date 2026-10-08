import { beforeEach, expect, it, vi } from 'vitest';
import { checkPrimaryWalletSavingsStatus } from './primary-wallet-savings-status-runtime';

const mocks = vi.hoisted(() => ({
  readStatus: vi.fn(),
  reconcile: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('./primary-wallet-savings-store', () => ({
  createPrimaryWalletSavingsStore: () => ({
    readStatus: mocks.readStatus,
    cancelBeforeDispatch: mocks.cancel,
  }),
}));
vi.mock('./primary-wallet-savings-executor', () => ({
  createPrimaryWalletSavingsExecutor: () => vi.fn(),
}));
vi.mock('./primary-wallet-savings-reconciliation-runtime', () => ({
  runPrimaryWalletSavingsReconciliation: mocks.reconcile,
}));
const integrationId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const database = {
  host: 'db.example.com',
  port: 5432,
  name: 'postgres',
  password: 'test-only',
  certificateAuthority: 'test-ca',
};
const input = {
  configuration: {
    integrationId,
    environment: 'staging',
    database: { ...database, login: 'baci_piggyvest_primary_authorizer' },
  },
  reconciliationConfiguration: {
    integrationId,
    environment: 'staging',
    database: { ...database, login: 'baci_piggyvest_primary_evidence' },
  },
  scope: {
    integrationId,
    environment: 'staging',
    merchantId: '33333333-3333-4333-8333-333333333333',
    customerId: '44444444-4444-4444-8444-444444444444',
    userId: '55555555-5555-4555-8555-555555555555',
    businessId: 'business',
  },
  providerToken: 'test-only',
  operationId,
};
beforeEach(() => {
  vi.resetAllMocks();
});
it('does not query the provider for absent or another customer operation', async () => {
  mocks.readStatus.mockResolvedValue(null);
  expect(await checkPrimaryWalletSavingsStatus(input)).toEqual({
    status: 'not_found',
  });
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
it('returns confirmed without repeating provider verification or transfer submission', async () => {
  mocks.readStatus.mockResolvedValue('confirmed');
  expect(await checkPrimaryWalletSavingsStatus(input)).toEqual({
    status: 'confirmed',
  });
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
it('releases an abandoned reservation only before provider dispatch', async () => {
  mocks.readStatus
    .mockResolvedValueOnce('reserved')
    .mockResolvedValueOnce('cancelled');
  mocks.cancel.mockResolvedValue(undefined);
  expect(await checkPrimaryWalletSavingsStatus(input)).toEqual({
    status: 'cancelled',
  });
  expect(mocks.cancel).toHaveBeenCalledWith(operationId);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
it('reconciles without releasing funds if dispatch wins the cancellation race', async () => {
  mocks.readStatus
    .mockResolvedValueOnce('reserved')
    .mockResolvedValueOnce('dispatched');
  mocks.cancel.mockRejectedValue(new Error('dispatch won'));
  mocks.reconcile.mockResolvedValue({ status: 'pending' });
  expect(await checkPrimaryWalletSavingsStatus(input)).toEqual({
    status: 'pending',
  });
  expect(mocks.reconcile).toHaveBeenCalledTimes(1);
});
it('reconciles only a dispatched operation selected by the authenticated scope', async () => {
  mocks.readStatus.mockResolvedValue('dispatched');
  mocks.reconcile.mockResolvedValue({ status: 'pending' });
  expect(await checkPrimaryWalletSavingsStatus(input)).toEqual({
    status: 'pending',
  });
  expect(mocks.reconcile).toHaveBeenCalledWith({
    configuration: input.reconciliationConfiguration,
    providerToken: 'test-only',
    operationId,
  });
});
