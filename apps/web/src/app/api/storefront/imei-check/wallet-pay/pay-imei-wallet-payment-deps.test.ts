import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPayImeiWalletPaymentDeps } from './pay-imei-wallet-payment-deps';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  readStatus: vi.fn(),
  deliver: vi.fn(),
  refund: vi.fn(),
  claim: vi.fn(),
  finish: vi.fn(),
  identity: vi.fn(),
}));
vi.mock('@/env', () => ({
  getImeiDisabledTierKeys: () => [],
  getImeiHashSalt: () => 'salt',
  getImeiIdentifierEncryptionKey: () => undefined,
  getPetrockConfig: () => null,
  getPetrockEnabledTierKeys: () => [],
  getSickwApiKey: () => 'key',
  isPetrockEnabled: () => false,
}));
vi.mock('@/lib/imei-access', () => ({
  createImeiAccessClient: () => ({ readStatus: mocks.readStatus }),
}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: mocks.identity,
}));
vi.mock('@/lib/piggyvest/wallet-pay-runtime', () => ({
  readWalletPayRuntime: () => null,
  readWalletPayRecoveryRuntime: () => ({}),
}));
vi.mock('@/lib/piggyvest/wallet-pay-service', () => ({
  checkWalletPayment: vi.fn(),
  payFromWallet: vi.fn(),
  refundWalletPayment: mocks.refund,
  walletPayDelivery: () => ({ claim: mocks.claim, finish: mocks.finish }),
}));
vi.mock('../prepare-imei-provider', () => ({ prepareImeiProvider: vi.fn() }));
vi.mock('./deliver-paid-imei-lookup', () => ({
  deliverPaidImeiLookup: mocks.deliver,
}));

const auth = { supabase: {} as never, user: { id: 'u' } as never };
const identity = { merchantId: 'm', customerId: 'c', userId: 'u' };

beforeEach(() => vi.resetAllMocks());

describe('createPayImeiWalletPaymentDeps', () => {
  it('reads the lookup through the signed IMEI access client and fails loudly on errors', async () => {
    const deps = createPayImeiWalletPaymentDeps(auth);
    mocks.readStatus.mockResolvedValue({ data: { id: 'l' }, error: null });
    await expect(deps.readLookup(identity, 'l')).resolves.toEqual({ id: 'l' });
    mocks.readStatus.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(deps.readLookup(identity, 'l')).rejects.toThrow();
  });

  it('delivers with the wallet pay delivery claim and refunds through wallet pay', async () => {
    const deps = createPayImeiWalletPaymentDeps(auth);
    mocks.deliver.mockImplementation(async (_input, d) => {
      await d.refund('op');
      await d.claim('op');
      return new Response(null, { status: 204 });
    });
    const runtime = { tag: 'runtime' } as never;
    await deps.deliver({
      runtime,
      identity,
      lookup: {} as never,
      operationId: 'op',
      normalizedImei: 'I',
    });
    expect(mocks.refund).toHaveBeenCalledWith({ runtime, paymentId: 'op' });
    expect(mocks.claim).toHaveBeenCalledWith('op');
  });
});
