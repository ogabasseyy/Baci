// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const f = vi.hoisted(() => ({
  attest: vi.fn(),
  load: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('./verifier-attestation-client', () => ({
  createVerifierAttestationClient: () => f.attest,
}));
vi.mock('./approval-service', () => ({
  loadDraftApproval: f.load,
  confirmDraftApply: f.confirm,
}));

import { configuredOwnerApproval } from './owner-approval-web-config';

const key = Buffer.alloc(32, 7).toString('base64url');
const id = '11111111-1111-4111-8111-111111111111';

it('stays off unless a distinct canonical verifier key is explicitly enabled', () => {
  expect(configuredOwnerApproval({ enabled: false, key })).toBeUndefined();
  expect(
    configuredOwnerApproval({ enabled: true, key: 'bad' })
  ).toBeUndefined();
  expect(
    configuredOwnerApproval({ enabled: true, key, previewKey: key })
  ).toBeUndefined();
});
it('requires fresh verifier attestation before draft confirmation and exposes no publication operation', async () => {
  const approval = configuredOwnerApproval({ enabled: true, key });
  expect(approval).toBeDefined();
  f.load.mockResolvedValueOnce({ status: 'confirmation-required' });
  f.attest.mockRejectedValueOnce(Error('unavailable'));
  await expect(approval?.confirm({} as never, id)).rejects.toThrow(
    'unavailable'
  );
  expect(f.confirm).not.toHaveBeenCalled();
  f.load.mockResolvedValueOnce({ status: 'confirmation-required' });
  f.attest.mockResolvedValueOnce(undefined);
  f.confirm.mockResolvedValueOnce({ version: 1 });
  await expect(approval?.confirm({} as never, id)).resolves.toEqual({
    version: 1,
  });
  expect(f.attest).toHaveBeenLastCalledWith({}, id, 'draft');
  expect(approval).not.toHaveProperty('confirmPublication');
  expect(approval).not.toHaveProperty('confirmModeExit');
});
it('reconciles an already applied approval without repeating attestation', async () => {
  const approval = configuredOwnerApproval({ enabled: true, key });
  f.attest.mockClear();
  f.load.mockResolvedValueOnce({ status: 'applied' });
  f.confirm.mockResolvedValueOnce({ version: 2 });
  await expect(approval?.confirm({} as never, id)).resolves.toEqual({
    version: 2,
  });
  expect(f.attest).not.toHaveBeenCalled();
});
