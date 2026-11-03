import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock('./petrock-remediation-reconcile-state', async () => {
  const actual = await vi.importActual<
    typeof import('./petrock-remediation-reconcile-state')
  >('./petrock-remediation-reconcile-state');
  return {
    ...actual,
    claimPetrockRemediationOrders: mocks.claim,
    createPetrockRemediationReconcileState: () => ({}),
    readApprovedPetrockRemediationProducts: vi.fn().mockResolvedValue([]),
  };
});
vi.mock('./petrock-remediation-reconciler', () => ({
  reconcilePetrockRemediationOrder: mocks.reconcile,
}));

import { runPetrockRemediationReconciliation } from './run-petrock-remediation-reconciliation';

describe('runPetrockRemediationReconciliation', () => {
  it('counts unresolved paid submissions needing manual review', async () => {
    mocks.claim.mockResolvedValue([{ id: 'one' }]);
    mocks.reconcile.mockResolvedValue({
      kind: 'submission_unknown',
      needsReview: true,
    });
    await expect(
      runPetrockRemediationReconciliation({
        client: {} as never,
        encryptionKey: Buffer.alloc(32, 7).toString('base64'),
        origin: 'https://usebaci.com',
        supabaseAdmin: {} as never,
      })
    ).resolves.toMatchObject({ submissionUnknown: 1, manualReview: 1 });
  });

  it('leases and summarizes remediation work independently per order', async () => {
    mocks.claim.mockResolvedValue([{ id: 'one' }, { id: 'two' }]);
    mocks.reconcile.mockReset();
    mocks.reconcile
      .mockResolvedValueOnce({ kind: 'completed' })
      .mockResolvedValueOnce({ kind: 'pending' });

    await expect(
      runPetrockRemediationReconciliation({
        client: {} as never,
        encryptionKey: Buffer.alloc(32, 7).toString('base64'),
        origin: 'https://usebaci.com',
        supabaseAdmin: {} as never,
      })
    ).resolves.toEqual({
      claimed: 2,
      completed: 1,
      eligibilityAdvanced: 0,
      errored: 0,
      failed: 0,
      manualReview: 0,
      pending: 1,
      submissionUnknown: 0,
    });
  });
});
