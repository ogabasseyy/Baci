import { beforeEach, expect, it, vi } from 'vitest';
import { checkPrimaryWalletSavingsStatus } from './primary-wallet-savings-status-runtime';

const mocks = vi.hoisted(() => ({
  readStatus: vi.fn(),
  reconcile: vi.fn(),
  cancelStale: vi.fn(),
  adoptPending: vi.fn(),
  releaseAfterRejection: vi.fn(),
  lookupTransfer: vi.fn(),
  retrieveWallet: vi.fn(),
  transfer: vi.fn(),
}));
vi.mock('./primary-wallet-savings-store', () => ({
  createPrimaryWalletSavingsStore: () => ({
    readStatus: mocks.readStatus,
    cancelStaleReservation: mocks.cancelStale,
    adoptPending: mocks.adoptPending,
    releaseAfterRejection: mocks.releaseAfterRejection,
  }),
}));
vi.mock('./primary-wallet-savings-executor', () => ({
  createPrimaryWalletSavingsExecutor: () => vi.fn(),
}));
vi.mock('./primary-wallet-savings-reconciliation-runtime', () => ({
  runPrimaryWalletSavingsReconciliation: mocks.reconcile,
}));
vi.mock('./primary-wallet-savings-transfer-lookup', () => ({
  lookupSavingsTransferReference: mocks.lookupTransfer,
}));
vi.mock('./wallets', () => ({
  retrievePiggyvestWallet: mocks.retrieveWallet,
}));
vi.mock('./transfers', () => ({
  transferToWallet: mocks.transfer,
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
  mocks.cancelStale.mockResolvedValue(true);
  expect(await checkPrimaryWalletSavingsStatus(input)).toEqual({
    status: 'cancelled',
  });
  expect(mocks.cancelStale).toHaveBeenCalledWith(operationId);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
it('keeps a live reservation pending instead of releasing it under the active submission', async () => {
  mocks.readStatus
    .mockResolvedValueOnce('reserved')
    .mockResolvedValueOnce('reserved');
  mocks.cancelStale.mockResolvedValue(false);
  expect(await checkPrimaryWalletSavingsStatus(input)).toEqual({
    status: 'pending',
  });
  expect(mocks.cancelStale).toHaveBeenCalledWith(operationId);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
it('reconciles without releasing funds if dispatch wins the cancellation race', async () => {
  mocks.readStatus
    .mockResolvedValueOnce('reserved')
    .mockResolvedValueOnce('dispatched');
  mocks.cancelStale.mockRejectedValue(new Error('dispatch won'));
  mocks.adoptPending.mockResolvedValue({ status: 'existing' });
  mocks.reconcile.mockResolvedValue({ status: 'pending' });
  expect(await checkPrimaryWalletSavingsStatus(input)).toEqual({
    status: 'pending',
  });
  expect(mocks.reconcile).toHaveBeenCalledTimes(1);
});
it('reconciles only a dispatched operation selected by the authenticated scope', async () => {
  mocks.readStatus.mockResolvedValue('dispatched');
  mocks.adoptPending.mockResolvedValue({ status: 'existing' });
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
it('resubmits a stale dispatched operation the provider never received', async () => {
  // claimDispatch succeeded but the provider request died pre-transfer:
  // the wallet hold and goal slot pin forever unless status drives the
  // lookup-gated reclaim — the client only polls status, never re-posts.
  const reservation = {
    operationId,
    goalId: '33333333-3333-4333-8333-333333333333',
    amountKobo: 25000,
    sourceWalletId: 'source-wallet',
    destinationWalletId: 'destination-wallet',
    reference: 'pvb-save-stale',
    businessId: 'business',
    providerCustomerId: 'provider-customer',
  };
  mocks.readStatus.mockResolvedValue('dispatched');
  mocks.adoptPending.mockResolvedValue({ status: 'reclaimed', reservation });
  mocks.lookupTransfer.mockResolvedValue('absent');
  mocks.retrieveWallet.mockImplementation(
    async (_provider: unknown, walletId: string) => ({
      id: walletId,
      api_customer_id: 'provider-customer',
      business_id: 'business',
      currency: 'NGN',
      status: 'active',
      balance: 50000,
    })
  );
  mocks.transfer.mockResolvedValue({ accepted: true });
  mocks.reconcile.mockResolvedValue({ status: 'pending' });
  expect(await checkPrimaryWalletSavingsStatus(input)).toEqual({
    status: 'pending',
  });
  expect(mocks.transfer).toHaveBeenCalledTimes(1);
  expect(mocks.reconcile).toHaveBeenCalledTimes(1);
});
it('leaves a fresh dispatched operation to its live holder', async () => {
  mocks.readStatus.mockResolvedValue('dispatched');
  mocks.adoptPending.mockResolvedValue({ status: 'existing' });
  mocks.reconcile.mockResolvedValue({ status: 'pending' });
  expect(await checkPrimaryWalletSavingsStatus(input)).toEqual({
    status: 'pending',
  });
  expect(mocks.lookupTransfer).not.toHaveBeenCalled();
  expect(mocks.transfer).not.toHaveBeenCalled();
  expect(mocks.reconcile).toHaveBeenCalledTimes(1);
});
it('does not resubmit when the provider already holds the transfer', async () => {
  mocks.readStatus.mockResolvedValue('dispatched');
  mocks.adoptPending.mockResolvedValue({
    status: 'reclaimed',
    reservation: {
      operationId,
      goalId: '33333333-3333-4333-8333-333333333333',
      amountKobo: 25000,
      sourceWalletId: 'source-wallet',
      destinationWalletId: 'destination-wallet',
      reference: 'pvb-save-landed',
      businessId: 'business',
      providerCustomerId: 'provider-customer',
    },
  });
  mocks.lookupTransfer.mockResolvedValue('submitted');
  mocks.reconcile.mockResolvedValue({ status: 'pending' });
  expect(await checkPrimaryWalletSavingsStatus(input)).toEqual({
    status: 'pending',
  });
  expect(mocks.transfer).not.toHaveBeenCalled();
  expect(mocks.reconcile).toHaveBeenCalledTimes(1);
});
it('still reconciles when the reclaim attempt fails', async () => {
  mocks.readStatus.mockResolvedValue('dispatched');
  mocks.adoptPending.mockRejectedValue(new Error('adopt unavailable'));
  mocks.reconcile.mockResolvedValue({ status: 'pending' });
  expect(await checkPrimaryWalletSavingsStatus(input)).toEqual({
    status: 'pending',
  });
  expect(mocks.reconcile).toHaveBeenCalledTimes(1);
});
