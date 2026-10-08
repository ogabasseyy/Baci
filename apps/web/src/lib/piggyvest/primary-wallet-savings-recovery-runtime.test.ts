import { expect, it, vi } from 'vitest';
import { recoverPrimaryWalletSavings } from './primary-wallet-savings-recovery-runtime';

const recover = vi.hoisted(() => vi.fn());
vi.mock('./primary-wallet-savings-store', () => ({
  createPrimaryWalletSavingsStore: () => ({ recoverPending: recover }),
}));
vi.mock('./primary-wallet-savings-executor', () => ({
  createPrimaryWalletSavingsExecutor: () => vi.fn(),
}));
const integrationId = '11111111-1111-4111-8111-111111111111';
const goalId = '22222222-2222-4222-8222-222222222222';
const input = {
  configuration: {
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
  },
  scope: {
    integrationId,
    environment: 'staging',
    merchantId: goalId,
    customerId: goalId,
    userId: goalId,
    businessId: 'business',
  },
  goalId,
};
it('returns the stored operation without submitting a transfer', async () => {
  const operation = {
    operationId: goalId,
    goalId,
    amountKobo: 100,
    state: 'dispatched',
  };
  recover.mockResolvedValue(operation);
  expect(await recoverPrimaryWalletSavings(input)).toEqual(operation);
  expect(recover).toHaveBeenCalledWith(goalId);
});
it('rejects mismatched integration bindings before recovery', async () => {
  recover.mockClear();
  await expect(
    recoverPrimaryWalletSavings({
      ...input,
      scope: { ...input.scope, environment: 'production' },
    })
  ).rejects.toThrow();
  expect(recover).not.toHaveBeenCalled();
});
