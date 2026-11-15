import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWalletPayPorts } from './wallet-pay-ports';
import { WALLET_PAY_WORKER_STATEMENTS } from './wallet-pay-statements';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  authorizer: vi.fn(),
  evidence: vi.fn(),
  transferToWallet: vi.fn(),
  lookup: vi.fn(),
  retrieve: vi.fn(),
}));
vi.mock('./primary-wallet-savings-executor', () => ({
  createPrimaryWalletSavingsExecutor: () => mocks.authorizer,
}));
vi.mock('./primary-wallet-evidence-executor', () => ({
  createPrimaryWalletEvidenceExecutor: () => mocks.evidence,
}));
vi.mock('./transfers', () => ({ transferToWallet: mocks.transferToWallet }));
vi.mock('./primary-wallet-savings-transfer-lookup', () => ({
  lookupSavingsTransferReference: mocks.lookup,
}));
vi.mock('./wallets', () => ({ retrievePiggyvestWallet: mocks.retrieve }));
vi.mock('./primary-wallet-savings-reconciliation-runtime', () => ({
  createSavingsVerifyQueryProvider: () => vi.fn(),
}));
vi.mock('./primary-wallet-provider-origin', () => ({
  getPrimaryWalletProviderOrigin: () => 'https://staging.example.test',
}));

const INTEGRATION = '8e3a5c62-4f4f-4a8e-9d73-5b6c7d8e9fa1';
const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';
const runtime = {
  configuration: { integrationId: INTEGRATION, environment: 'staging' },
  reconciliationConfiguration: {
    integrationId: INTEGRATION,
    environment: 'staging',
  },
  providerToken: 'token',
  collectionWalletId: 'collection-wallet',
} as never;
const transfer = {
  operationId: OP,
  purpose: 'vtu' as const,
  purchaseRef: 'vtu-1',
  amountKobo: 5000,
  sourceWalletId: 'main-wallet',
  destinationWalletId: 'collection-wallet',
  reference: `pvb-pay-${OP}`,
  businessId: 'business-1',
  providerCustomerId: 'customer-1',
};

beforeEach(() => vi.resetAllMocks());

describe('createWalletPayPorts', () => {
  it('posts exactly the reserved amount, wallets and reference', async () => {
    mocks.transferToWallet.mockResolvedValue({ accepted: true });
    await createWalletPayPorts(runtime).transfer(
      transfer,
      'Ogabassey purchase'
    );
    expect(mocks.transferToWallet).toHaveBeenCalledWith(
      { token: 'token', baseUrl: 'https://staging.example.test' },
      {
        amountKobo: 5000,
        sourceWalletId: 'main-wallet',
        destinationWalletId: 'collection-wallet',
        reference: `pvb-pay-${OP}`,
        narration: 'Ogabassey purchase',
      }
    );
  });

  it('looks a reference up on the sending wallet with the full binding', async () => {
    mocks.lookup.mockResolvedValue('not_found');
    await expect(
      createWalletPayPorts(runtime).lookupTransfer(transfer)
    ).resolves.toBe('not_found');
    expect(mocks.lookup).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: `pvb-pay-${OP}`,
        walletId: 'main-wallet',
        amountKobo: 5000,
        destinationWalletId: 'collection-wallet',
      })
    );
  });

  it('binds the worker store to the configured integration', async () => {
    mocks.authorizer.mockResolvedValue({
      rows: [{ result: { status: 'busy' } }],
    });
    await createWalletPayPorts(runtime).worker.claim(OP);
    expect(mocks.authorizer).toHaveBeenCalledWith(
      WALLET_PAY_WORKER_STATEMENTS.claim,
      [INTEGRATION, 'staging', OP]
    );
  });

  it('propagates a provider failure instead of hiding it', async () => {
    mocks.transferToWallet.mockRejectedValue(new Error('timeout'));
    await expect(
      createWalletPayPorts(runtime).transfer(transfer, 'x')
    ).rejects.toThrow('timeout');
  });
});
