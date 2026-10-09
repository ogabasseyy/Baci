import { beforeEach, expect, it, vi } from 'vitest';
import { reconcileSavingsOutflowReferences } from './primary-wallet-savings-outflow-processor';

const mockReconcile = vi.fn();
vi.mock('./primary-wallet-savings-outflow-reconciliation', () => ({
  runPrimaryWalletSavingsOutflowReconciliation: (...args: unknown[]) =>
    mockReconcile(...args),
}));
const savingsRuntime = {
  reconciliationConfiguration: {},
  providerToken: 'token',
};
beforeEach(() => {
  vi.clearAllMocks();
  mockReconcile.mockResolvedValue('unmatched');
});
it.each([
  'confirmed',
  'cancelled',
  'unmatched',
] as const)('passes a %s attribution through with the runtime and references', async (outcome) => {
  mockReconcile.mockResolvedValue(outcome);
  await expect(
    reconcileSavingsOutflowReferences(['ref-1'], {
      savingsRuntime,
      fetchImplementation: fetch,
    })
  ).resolves.toBe(outcome);
  expect(mockReconcile).toHaveBeenCalledWith({
    configuration: {},
    providerToken: 'token',
    references: ['ref-1'],
    fetchImplementation: fetch,
  });
});
it('stays retryable when the provider re-query cannot confirm', async () => {
  mockReconcile.mockResolvedValue('pending');
  await expect(
    reconcileSavingsOutflowReferences(['ref-1'], { savingsRuntime })
  ).rejects.toThrow('Primary savings outflow reconciliation inconclusive');
});
it('skips reconciliation when the savings runtime is absent', async () => {
  await expect(
    reconcileSavingsOutflowReferences(['ref-1'], { savingsRuntime: null })
  ).resolves.toBe('unmatched');
  expect(mockReconcile).not.toHaveBeenCalled();
});
it('reads the runtime from the environment when no override is injected', async () => {
  const previous = process.env.PIGGYVEST_PRIMARY_SAVINGS_ENABLED;
  delete process.env.PIGGYVEST_PRIMARY_SAVINGS_ENABLED;
  try {
    await expect(
      reconcileSavingsOutflowReferences(['ref-1'], {})
    ).resolves.toBe('unmatched');
    expect(mockReconcile).not.toHaveBeenCalled();
  } finally {
    if (previous === undefined)
      delete process.env.PIGGYVEST_PRIMARY_SAVINGS_ENABLED;
    else process.env.PIGGYVEST_PRIMARY_SAVINGS_ENABLED = previous;
  }
});
