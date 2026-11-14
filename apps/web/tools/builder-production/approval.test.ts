import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/experience/approval-service', () => ({
  loadDraftApproval: vi.fn(),
  confirmDraftApply: vi.fn(async () => ({ status: 'applied' })),
}));
vi.mock('@/lib/experience/publication-service', () => ({
  loadLifecycleApproval: vi.fn(),
}));

import {
  confirmDraftApply,
  loadDraftApproval,
} from '@/lib/experience/approval-service';
import { createBuilderDraftApproval } from './approval';

beforeEach(() => vi.clearAllMocks());

it('requires independent proof before confirming a fresh private draft', async () => {
  vi.mocked(loadDraftApproval).mockResolvedValue({
    status: 'confirmation-required',
  } as never);
  const attest = vi.fn(async () => {});
  const approval = createBuilderDraftApproval(attest);
  await approval.confirm({} as never, 'id');
  expect(attest).toHaveBeenCalledWith({}, 'id', 'draft');
  expect(confirmDraftApply).toHaveBeenCalledOnce();
});

it('never confirms after attestation failure, while reconciling an already applied draft', async () => {
  const attest = vi.fn(async () => {
    throw Error('proof unavailable');
  });
  const approval = createBuilderDraftApproval(attest);
  vi.mocked(loadDraftApproval).mockResolvedValueOnce({
    status: 'confirmation-required',
  } as never);
  await expect(approval.confirm({} as never, 'id')).rejects.toThrow(
    'proof unavailable'
  );
  expect(confirmDraftApply).not.toHaveBeenCalled();
  vi.mocked(loadDraftApproval).mockResolvedValueOnce({
    status: 'applied',
  } as never);
  await approval.confirm({} as never, 'id');
  expect(confirmDraftApply).toHaveBeenCalledOnce();
});

it('refuses publication and mode changes before any mutation', async () => {
  const approval = createBuilderDraftApproval(vi.fn());
  await expect(approval.confirmPublication({} as never, 'id')).rejects.toThrow(
    'PUBLIC_VERIFIER_NOT_INSTALLED'
  );
  await expect(approval.confirmModeExit({} as never, 'id')).rejects.toThrow(
    'PUBLIC_VERIFIER_NOT_INSTALLED'
  );
  expect(confirmDraftApply).not.toHaveBeenCalled();
});
