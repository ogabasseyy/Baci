import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('./approval-service', () => ({ loadDraftApproval: vi.fn() }));
vi.mock('./publication-service', () => ({ loadLifecycleApproval: vi.fn() }));

import { loadDraftApproval } from './approval-service';
import { createIndependentApprovalVerifier } from './independent-approval-verifier';
import { loadLifecycleApproval } from './publication-service';

const id = '11111111-1111-4111-8111-111111111111';
const approval = {
  status: 'confirmation-required',
  approvalId: id,
  merchantId: id,
  evidenceId: id,
  expectedVersion: 0,
  expiresAt: '2099-01-01T00:00:00Z',
  buildId: id,
  effectDigest: 'a'.repeat(64),
} satisfies Extract<
  Awaited<ReturnType<typeof loadDraftApproval>>,
  { status: 'confirmation-required' }
>;
beforeEach(() => {
  vi.mocked(loadDraftApproval).mockResolvedValue(approval);
  vi.mocked(loadLifecycleApproval).mockResolvedValue(approval);
});
function setup() {
  const deps = {
    capture: vi.fn(async () => ({
      buildId: id,
      effectDigest: approval.effectDigest,
      artifactReceipt: 'b'.repeat(64),
      evidenceDigest: 'c'.repeat(64),
      routes: ['/'],
    })),
    record: vi.fn(async () => {}),
    verifyPublic: vi.fn(async () => {}),
  };
  return { deps, verifier: createIndependentApprovalVerifier(deps) };
}
it('records independent evidence only after owner effect and build match a second current read', async () => {
  const f = setup();
  await f.verifier.attest({} as never, id, 'draft');
  expect(f.deps.record).toHaveBeenCalledWith({
    approvalId: id,
    kind: 'draft',
    effectDigest: approval.effectDigest,
    markerDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  await f.verifier.verifyCommitted({} as never, { receiptId: id });
  expect(f.deps.verifyPublic).toHaveBeenCalledWith({}, { receiptId: id });
});
it('rejects forged effects and invalidated approvals without writing proof', async () => {
  const f = setup();
  f.deps.capture.mockResolvedValueOnce({
    ...(await f.deps.capture()),
    effectDigest: 'd'.repeat(64),
  });
  await expect(f.verifier.attest({} as never, id, 'lifecycle')).rejects.toThrow(
    'APPROVAL_MISMATCH'
  );
  expect(f.deps.record).not.toHaveBeenCalled();
  vi.mocked(loadDraftApproval)
    .mockResolvedValueOnce(approval)
    .mockResolvedValueOnce({ ...approval, effectDigest: 'd'.repeat(64) });
  await expect(f.verifier.attest({} as never, id, 'draft')).rejects.toThrow(
    'APPROVAL_MISMATCH'
  );
  expect(f.deps.record).not.toHaveBeenCalled();
});
it('reconciled receipt does not request or write fresh evidence', async () => {
  const f = setup();
  vi.mocked(loadDraftApproval).mockResolvedValue({
    status: 'applied',
    approvalId: id,
    merchantId: id,
    buildId: id,
    version: 1,
  });
  await f.verifier.attest({} as never, id, 'draft');
  expect(f.deps.capture).not.toHaveBeenCalled();
  expect(f.deps.record).not.toHaveBeenCalled();
});
