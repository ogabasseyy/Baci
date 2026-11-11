import { expect, it, vi } from 'vitest';

vi.mock('./approval-service', () => ({
  loadDraftApproval: vi.fn(),
  confirmDraftApply: vi.fn(async () => ({ version: 1 })),
}));
vi.mock('./publication-service', () => ({
  loadLifecycleApproval: vi.fn(),
  confirmExperiencePublication: vi.fn(),
}));
vi.mock('./mode-exit-service', () => ({
  confirmExperienceModeExit: vi.fn(async () => ({ status: 'legacy' })),
}));

import { confirmDraftApply, loadDraftApproval } from './approval-service';
import { createOwnerLifecycleRuntime } from './owner-lifecycle-runtime';
import {
  confirmExperiencePublication,
  loadLifecycleApproval,
} from './publication-service';

const id = '11111111-1111-4111-8111-111111111111';
function setup() {
  const verifier = {
    attest: vi.fn(async () => {}),
    verifyCommitted: vi.fn(async () => {}),
  };
  return {
    verifier,
    approval: createOwnerLifecycleRuntime(vi.fn(), verifier).approval,
  };
}
it('response-loss reconciliation skips recapture after applied receipt; fresh approval requires independent proof', async () => {
  const f = setup();
  vi.mocked(loadDraftApproval).mockResolvedValueOnce({
    status: 'applied',
  } as never);
  await f.approval?.confirm({} as never, id);
  expect(f.verifier.attest).not.toHaveBeenCalled();
  expect(confirmDraftApply).toHaveBeenCalled();
  vi.mocked(loadDraftApproval).mockResolvedValueOnce({
    status: 'confirmation-required',
  } as never);
  await f.approval?.confirm({} as never, id);
  expect(f.verifier.attest).toHaveBeenCalledWith({}, id, 'draft');
});
it('failed delivery remains verifying; replay verifies same receipt without fresh attestation or republish attempt', async () => {
  const f = setup();
  vi.mocked(loadLifecycleApproval).mockResolvedValue({ status: 'verifying' });
  vi.mocked(confirmExperiencePublication).mockResolvedValue({
    status: 'verifying',
    receiptId: id,
  });
  f.verifier.verifyCommitted.mockRejectedValueOnce(Error('browser offline'));
  await expect(
    f.approval?.confirmPublication?.({} as never, id)
  ).resolves.toEqual({ status: 'verifying', receiptId: id });
  expect(f.verifier.attest).not.toHaveBeenCalled();
  vi.mocked(loadLifecycleApproval)
    .mockResolvedValueOnce({ status: 'verifying' })
    .mockResolvedValueOnce({ status: 'live' });
  await expect(
    f.approval?.confirmPublication?.({} as never, id)
  ).resolves.toEqual({ status: 'live' });
  expect(f.verifier.verifyCommitted).toHaveBeenCalledTimes(2);
  expect(f.verifier.attest).not.toHaveBeenCalled();
});
it('independent proof failure prevents confirmation', async () => {
  const f = setup();
  vi.mocked(confirmDraftApply).mockClear();
  vi.mocked(loadDraftApproval).mockResolvedValue({
    status: 'confirmation-required',
  } as never);
  f.verifier.attest.mockRejectedValue(Error('mismatch'));
  await expect(f.approval?.confirm({} as never, id)).rejects.toThrow(
    'mismatch'
  );
  expect(confirmDraftApply).not.toHaveBeenCalled();
});
