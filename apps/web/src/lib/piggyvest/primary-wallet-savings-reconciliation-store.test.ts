import { expect, it, vi } from 'vitest';
import { createPrimaryWalletSavingsReconciliationStore } from './primary-wallet-savings-reconciliation-store';

const integrationId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const proof = {
  status: 'verified' as const,
  operationId,
  providerTransactionId: 'transaction',
  reference: 'reference',
  amountKobo: 100,
  sourceWalletId: 'source',
  destinationWalletId: 'destination',
  businessId: 'business',
};
it('uses only environment-bound parameterized read and settlement statements', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ result: null }] })
    .mockResolvedValueOnce({ rows: [{ result: 'confirmed' }] });
  const store = createPrimaryWalletSavingsReconciliationStore({
    integrationId,
    environment: 'staging',
    execute,
  });
  expect(await store.loadDispatched(operationId)).toBeNull();
  expect(await store.settle(proof)).toBe('confirmed');
  expect(execute).toHaveBeenNthCalledWith(
    1,
    'SELECT piggyvest_primary.read_dispatched_savings($1::uuid,$2::text,$3::uuid) AS result',
    [integrationId, 'staging', operationId]
  );
  const { status: _status, ...receipt } = proof;
  expect(execute).toHaveBeenNthCalledWith(
    2,
    'SELECT piggyvest_primary.settle_savings($1::uuid,$2::text,$3::jsonb) AS result',
    [integrationId, 'staging', JSON.stringify(receipt)]
  );
});
it('rejects unknown acknowledgements instead of claiming settlement', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: 'credited' }] });
  const store = createPrimaryWalletSavingsReconciliationStore({
    integrationId,
    environment: 'staging',
    execute,
  });
  await expect(store.settle(proof)).rejects.toThrow('settlement unavailable');
});
it('releases failed holds through the same parameterized receipt without settling', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ result: 'released' }] })
    .mockResolvedValueOnce({ rows: [{ result: 'credited' }] });
  const store = createPrimaryWalletSavingsReconciliationStore({
    integrationId,
    environment: 'staging',
    execute,
  });
  const failed = { ...proof, status: 'failed' as const };
  expect(await store.release(failed)).toBe('released');
  const { status: _status, ...receipt } = failed;
  expect(execute).toHaveBeenNthCalledWith(
    1,
    'SELECT piggyvest_primary.release_failed_savings($1::uuid,$2::text,$3::jsonb) AS result',
    [integrationId, 'staging', JSON.stringify(receipt)]
  );
  await expect(store.release(failed)).rejects.toThrow('settlement unavailable');
});
it('rejects malformed operation IDs before storage', async () => {
  const execute = vi.fn();
  const store = createPrimaryWalletSavingsReconciliationStore({
    integrationId,
    environment: 'staging',
    execute,
  });
  await expect(store.loadDispatched('foreign-sql')).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
