import { expect, it } from 'vitest';
import {
  experienceDraftApplyResult,
  experienceDraftApprovalResult,
} from './experience-draft-approval';

const id = '11111111-1111-4111-8111-111111111111';
const pending = {
  approvalId: id,
  merchantId: id,
  buildId: id,
  evidenceId: id,
  effectDigest: 'a'.repeat(64),
  expectedVersion: 0,
  expiresAt: '2026-11-10T15:00:00Z',
  status: 'confirmation-required',
};
const applied = {
  approvalId: id,
  merchantId: id,
  buildId: id,
  version: 1,
  status: 'applied',
};
it('distinguishes pending approvals from applied receipts', () => {
  expect(experienceDraftApprovalResult.parse(pending)).toEqual(pending);
  expect(experienceDraftApprovalResult.parse(applied)).toEqual(applied);
  for (const value of [
    { ...pending, effectDigest: 'bad' },
    { ...pending, evidenceId: 'bad' },
    { ...pending, expiresAt: 'later' },
    { ...pending, expectedVersion: -1 },
    { ...applied, version: 0 },
    { ...applied, evidenceId: id },
  ])
    expect(experienceDraftApprovalResult.safeParse(value).success).toBe(false);
});
it('accepts only a build ID and positive integer version in the confirmation result', () => {
  const receipt = { buildId: id, version: 1 };
  expect(experienceDraftApplyResult.parse(receipt)).toEqual(receipt);
  for (const patch of [
    { buildId: 'bad' },
    { version: 0 },
    { version: 1.5 },
    { approved: true },
  ]) {
    expect(
      experienceDraftApplyResult.safeParse({ ...receipt, ...patch }).success
    ).toBe(false);
  }
});
