// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./owner-mtls-fetch', () => ({ createOwnerMtlsFetch: () => vi.fn() }));
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
const owner = {
  ownerOrigin: 'https://builder-owner.usebaci.com',
  ownerCert: 'synthetic-cert',
  ownerKey: 'synthetic-key',
};

it('stays off unless a distinct canonical verifier key is explicitly enabled', () => {
  expect(configuredOwnerApproval({ enabled: false, key })).toBeUndefined();
  expect(
    configuredOwnerApproval({ enabled: true, key: 'bad' })
  ).toBeUndefined();
  expect(
    configuredOwnerApproval({ enabled: true, key, previewKey: key })
  ).toBeUndefined();
  expect(configuredOwnerApproval({ enabled: true, key })).toBeUndefined();
});
it('installs separate preparation and confirmation with no publication operation', async () => {
  const approval = configuredOwnerApproval({ enabled: true, key, ...owner });
  expect(approval?.prepareDraft).toBeTypeOf('function');
  f.confirm.mockResolvedValueOnce({ version: 1 });
  await expect(approval?.confirm({} as never, id)).resolves.toEqual({
    version: 1,
  });
  expect(f.attest).not.toHaveBeenCalled();
  expect(approval).not.toHaveProperty('confirmPublication');
  expect(approval).not.toHaveProperty('confirmModeExit');
});
