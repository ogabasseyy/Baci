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

import { confirmDraftApply } from './approval-service';
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
it('draft confirmation reconciles through SQL without starting a capture', async () => {
  const f = setup();
  await f.approval?.confirm({} as never, id);
  expect(f.verifier.attest).not.toHaveBeenCalled();
  expect(confirmDraftApply).toHaveBeenCalled();
});
it('failed delivery remains verifying; replay verifies same receipt without fresh attestation or republish attempt', async () => {
  const f = setup();
  vi.mocked(loadLifecycleApproval).mockResolvedValue({ status: 'verifying' });
  vi.mocked(confirmExperiencePublication).mockResolvedValue({
    status: 'verifying',
    receiptId: id,
  });
  const { signal } = new AbortController();
  f.verifier.verifyCommitted.mockRejectedValueOnce(Error('browser offline'));
  await expect(
    f.approval?.confirmPublication?.({} as never, id, signal)
  ).resolves.toEqual({ status: 'verifying', receiptId: id });
  expect(f.verifier.verifyCommitted).toHaveBeenCalledWith(
    {},
    { status: 'verifying', receiptId: id, approvalId: id },
    signal
  );
  expect(f.verifier.attest).not.toHaveBeenCalled();
  vi.mocked(loadLifecycleApproval).mockResolvedValueOnce({ status: 'live' });
  await expect(
    f.approval?.confirmPublication?.({} as never, id)
  ).resolves.toEqual({ status: 'live' });
  expect(f.verifier.verifyCommitted).toHaveBeenCalledTimes(2);
  expect(f.verifier.attest).not.toHaveBeenCalled();
});
