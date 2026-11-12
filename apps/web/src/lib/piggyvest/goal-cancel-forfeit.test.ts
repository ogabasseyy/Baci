import { beforeEach, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { driveGoalCancelForfeit } from './goal-cancel-forfeit';

vi.mock('server-only', () => ({}));
const operationId = '00000000-0000-4000-8000-000000000002';
const forfeit = {
  operationId: '00000000-0000-4000-8000-000000000003',
  goalId: '00000000-0000-4000-8000-000000000001',
  amountKobo: 12000,
  sourceWalletId: 'goal-wallet',
  destinationWalletId: 'interest-wallet',
  reference: 'pvb-forfeit-00000000-0000-4000-8000-000000000001',
  businessId: 'business',
  providerCustomerId: 'customer',
};
function ports() {
  return {
    claim: vi.fn().mockResolvedValue({ status: 'claimed', forfeit }),
    transfer: vi.fn().mockResolvedValue({ accepted: true }),
    lookupTransfer: vi.fn().mockResolvedValue('not_found'),
    release: vi.fn().mockResolvedValue(true),
    reconcile: vi.fn().mockResolvedValue({ status: 'pending' }),
  };
}
beforeEach(() => vi.clearAllMocks());

it('sends the claimed interest to the interest wallet exactly once, then reads its status', async () => {
  const p = ports();
  expect(await driveGoalCancelForfeit(operationId, p)).toBe('pending');
  expect(p.transfer).toHaveBeenCalledOnce();
  expect(p.transfer).toHaveBeenCalledWith(forfeit);
  expect(p.reconcile).toHaveBeenCalledWith(forfeit.operationId);
});

it('reports confirmed when the status read settles it', async () => {
  const p = ports();
  p.reconcile.mockResolvedValue({ status: 'confirmed' });
  expect(await driveGoalCancelForfeit(operationId, p)).toBe('confirmed');
});

it('never resends an already dispatched forfeit; it only reads its status', async () => {
  const p = ports();
  p.claim.mockResolvedValue({
    status: 'pending',
    forfeitId: forfeit.operationId,
  });
  expect(await driveGoalCancelForfeit(operationId, p)).toBe('pending');
  expect(p.transfer).not.toHaveBeenCalled();
  expect(p.reconcile).toHaveBeenCalledWith(forfeit.operationId);
});

it.each([
  'waiting',
  'confirmed',
  'needs_review',
  'none',
  'unavailable',
] as const)('sends nothing when the claim answers %s', async (status) => {
  const p = ports();
  p.claim.mockResolvedValue({ status });
  expect(await driveGoalCancelForfeit(operationId, p)).toBe(status);
  expect(p.transfer).not.toHaveBeenCalled();
  expect(p.reconcile).not.toHaveBeenCalled();
});

it('keeps a timed-out forfeit pending and never resends it (202/timeout is indeterminate)', async () => {
  const p = ports();
  p.transfer.mockRejectedValue(
    new PiggyvestApiError('PIGGYVEST_NETWORK_ERROR', 'timeout')
  );
  expect(await driveGoalCancelForfeit(operationId, p)).toBe('pending');
  expect(p.transfer).toHaveBeenCalledOnce();
  expect(p.release).not.toHaveBeenCalled();
});

it('releases a definitively rejected forfeit only when no transfer exists under its reference', async () => {
  const p = ports();
  p.transfer.mockRejectedValue(
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'bad', 422)
  );
  expect(await driveGoalCancelForfeit(operationId, p)).toBe('released');
  expect(p.lookupTransfer).toHaveBeenCalledWith(forfeit);
  expect(p.release).toHaveBeenCalledWith(forfeit.operationId);
});

it('holds a rejected forfeit pending when the lookup finds a transfer', async () => {
  const p = ports();
  p.transfer.mockRejectedValue(
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'bad', 422)
  );
  p.lookupTransfer.mockResolvedValue('submitted');
  expect(await driveGoalCancelForfeit(operationId, p)).toBe('pending');
  expect(p.release).not.toHaveBeenCalled();
});

it('refuses a claim whose forfeit is not a forfeit transfer', async () => {
  const p = ports();
  p.claim.mockResolvedValue({
    status: 'claimed',
    forfeit: {
      ...forfeit,
      reference: 'pvb-cancel-00000000-0000-4000-8000-000000000001',
    },
  });
  await expect(driveGoalCancelForfeit(operationId, p)).rejects.toThrow();
  expect(p.transfer).not.toHaveBeenCalled();
});

it('answers pending without a status read when no reconciler is bound', async () => {
  const p = ports();
  const { reconcile: _reconcile, ...rest } = p;
  expect(await driveGoalCancelForfeit(operationId, rest)).toBe('pending');
});
