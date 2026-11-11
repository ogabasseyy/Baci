import { expect, it } from 'vitest';
import {
  experienceApplyInput,
  experienceApprovalPost,
  experienceApprovalRef,
  experienceLifecyclePublicationBinding,
  experiencePublicationInput,
} from './experience-publication';

const id = '11111111-1111-4111-8111-111111111111';
const apply = {
  buildId: id,
  evidenceId: id,
  expectedVersion: 0,
  idempotencyKey: id,
};
it('admits exact apply/publication identifiers and nonnegative integer versions', () => {
  expect(experienceApplyInput.parse(apply)).toEqual(apply);
  const publication = {
    ...apply,
    expectedPublishedVersion: Number.MAX_SAFE_INTEGER,
  };
  expect(experiencePublicationInput.parse(publication)).toEqual(publication);
  for (const invalid of [
    { ...apply, buildId: 'bad' },
    { ...apply, evidenceId: 'bad' },
    { ...apply, idempotencyKey: 'bad' },
    ...[-1, 0.5, '0', Number.MAX_SAFE_INTEGER + 1].map((expectedVersion) => ({
      ...apply,
      expectedVersion,
    })),
    { ...apply, approved: true },
  ])
    expect(experienceApplyInput.safeParse(invalid).success).toBe(false);
  for (const expectedPublishedVersion of [-1, 0.5, '0', undefined])
    expect(
      experiencePublicationInput.safeParse({
        ...publication,
        expectedPublishedVersion,
      }).success
    ).toBe(false);
  expect(
    experiencePublicationInput.safeParse({ ...publication, approved: true })
      .success
  ).toBe(false);
});
it.each([
  'confirm-draft',
  'confirm-publication',
  'confirm-mode-exit',
])('accepts only the exact %s approval request', (action) => {
  expect(experienceApprovalPost.parse({ action, approvalId: id })).toEqual({
    action,
    approvalId: id,
  });
  expect(
    experienceApprovalPost.safeParse({ action, approvalId: 'bad' }).success
  ).toBe(false);
  expect(
    experienceApprovalPost.safeParse({ action, approvalId: id, approved: true })
      .success
  ).toBe(false);
});
it('rejects unknown actions and invalid approval reference bindings', () => {
  expect(
    experienceApprovalPost.safeParse({ action: 'publish', approvalId: id })
      .success
  ).toBe(false);
  const ref = {
    approvalId: id,
    effectDigest: 'a'.repeat(64),
    expiresAt: '2026-11-05T12:00:00+01:00',
    status: 'confirmation-required',
  };
  expect(experienceApprovalRef.parse(ref)).toEqual(ref);
  for (const invalid of [
    { ...ref, approvalId: 'bad' },
    { ...ref, effectDigest: 'bad' },
    { ...ref, expiresAt: 'tomorrow' },
    { ...ref, status: 'live' },
    { ...ref, token: 'private' },
  ])
    expect(experienceApprovalRef.safeParse(invalid).success).toBe(false);
});
it('defaults uncommitted lifecycle bindings and admits every committed receipt status', () => {
  const binding = { merchantId: id, buildId: id, action: 'publish' };
  expect(experienceLifecyclePublicationBinding.parse(binding).status).toBe(
    'confirmation-required'
  );
  for (const status of [
    'confirmation-required',
    'verifying',
    'live',
    'superseded',
  ]) {
    expect(
      experienceLifecyclePublicationBinding.parse({
        ...binding,
        action: 'rollback',
        status,
        receiptId: id,
      })
    ).toMatchObject({ status, receiptId: id });
  }
  for (const invalid of [
    { ...binding, merchantId: 'bad' },
    { ...binding, buildId: 'bad' },
    { ...binding, action: 'apply' },
    { ...binding, status: 'unknown' },
    { ...binding, receiptId: 'bad' },
  ])
    expect(
      experienceLifecyclePublicationBinding.safeParse(invalid).success
    ).toBe(false);
  // RPC bindings may contain other receipt fields; they are not forwarded as authority.
  expect(
    experienceLifecyclePublicationBinding.parse({
      ...binding,
      extra: 'discard',
    })
  ).not.toHaveProperty('extra');
});

it('defaults the owner approval page to draft and validates lifecycle receipts', async () => {
  const { experienceApprovalPageInput, experienceLifecycleReceipt } =
    await import('./experience-publication');
  expect(experienceApprovalPageInput.parse({ approval: id })).toEqual({
    approval: id,
    kind: 'draft',
  });
  expect(
    experienceApprovalPageInput.safeParse({ approval: id, kind: 'unknown' })
      .success
  ).toBe(false);
  expect(
    experienceLifecycleReceipt.parse({ status: 'verifying', receipt: { id } })
  ).toEqual({ status: 'verifying', receipt: { id } });
  expect(experienceLifecycleReceipt.safeParse([]).success).toBe(false);
});
