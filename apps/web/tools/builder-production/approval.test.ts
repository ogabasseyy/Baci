import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/experience/approval-service', () => ({
  loadDraftApproval: vi.fn(),
  confirmDraftApply: vi.fn(async () => ({ status: 'applied' })),
}));
vi.mock('@/lib/experience/publication-service', () => ({
  loadLifecycleApproval: vi.fn(),
}));

import { confirmDraftApply } from '@/lib/experience/approval-service';
import { createBuilderDraftApproval } from './approval';

beforeEach(() => vi.clearAllMocks());

it('installs preparation separately from explicit draft confirmation', async () => {
  const attest = vi.fn();
  const approval = createBuilderDraftApproval(attest);
  expect(approval.prepareDraft).toBeTypeOf('function');
  await approval.confirm({} as never, 'id');
  expect(attest).not.toHaveBeenCalled();
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
