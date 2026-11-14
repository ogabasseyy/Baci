import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileWalletPayOutflowReferences } from './wallet-pay-outflow';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ reconcile: vi.fn(), runtime: vi.fn() }));
vi.mock('./wallet-pay-service', () => ({
  reconcileWalletPayReferences: mocks.reconcile,
}));
vi.mock('./wallet-pay-runtime', () => ({
  readWalletPayRecoveryRuntime: mocks.runtime,
}));

const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.runtime.mockReturnValue({ collectionWalletId: 'c' });
});

describe('reconcileWalletPayOutflowReferences', () => {
  it('ignores references that are not wallet pay without reading any configuration', async () => {
    await expect(
      reconcileWalletPayOutflowReferences(['pvb-save-1', 'PVB01'])
    ).resolves.toBe('unmatched');
    expect(mocks.runtime).not.toHaveBeenCalled();
  });

  it.each([
    ['confirmed', 'confirmed'],
    ['needs_review', 'confirmed'],
    ['refunding', 'confirmed'],
    ['released', 'cancelled'],
    ['unmatched', 'unmatched'],
  ] as const)('maps %s to the webhook outcome %s', async (outcome, expected) => {
    mocks.reconcile.mockResolvedValue(outcome);
    await expect(
      reconcileWalletPayOutflowReferences([`pvb-pay-${OP}`])
    ).resolves.toBe(expected);
  });

  it('stays retryable while PiggyVest cannot confirm yet', async () => {
    mocks.reconcile.mockResolvedValue('pending');
    await expect(
      reconcileWalletPayOutflowReferences([`pvb-refund-${OP}-1`])
    ).rejects.toThrow('Wallet pay outflow reconciliation inconclusive');
  });

  it('stays retryable when our own reference arrives while configuration is broken', async () => {
    mocks.runtime.mockImplementation(() => {
      throw new Error('misconfigured');
    });
    await expect(
      reconcileWalletPayOutflowReferences([`pvb-pay-${OP}`])
    ).rejects.toThrow();
  });
});
