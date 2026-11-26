import { expect, it } from 'vitest';
import {
  publicHeadMerchant,
  publicHeadReceipt,
  verifierApprovalExpiry,
  verifierApprovalRecord,
  verifierPublicRecord,
} from './experience-verification-records';

const id = '11111111-1111-4111-8111-111111111111';
const digest = 'a'.repeat(64);

it('accepts only a supported receipt state with a valid merchant locator', () => {
  const input = {
    approvalId: id,
    merchantId: id,
    buildId: id,
    receiptId: id,
    effectDigest: digest,
    publishedVersion: 1,
    status: 'verifying',
    action: 'publish',
  };
  expect(publicHeadReceipt.parse(input)).toEqual(input);
  expect(
    publicHeadReceipt.safeParse({ ...input, status: 'pending' }).success
  ).toBe(false);
  expect(
    publicHeadReceipt.safeParse({ ...input, publishedVersion: 0 }).success
  ).toBe(false);
  expect(publicHeadMerchant.parse({ slug: 'my-shop' })).toEqual({
    slug: 'my-shop',
  });
  expect(publicHeadMerchant.safeParse({ slug: 'my.shop' }).success).toBe(false);
});

it('checks verifier records independently of their transport', () => {
  const record = { receiptId: id, effectDigest: digest, markerDigest: digest };
  expect(verifierPublicRecord.parse(record)).toEqual(record);
  expect(
    verifierPublicRecord.safeParse({ ...record, markerDigest: 'bad' }).success
  ).toBe(false);
  const approval = {
    approvalId: id,
    kind: 'draft',
    effectDigest: digest,
    markerDigest: digest,
    expiresAt: '2026-11-23T00:00:00Z',
  };
  expect(verifierApprovalRecord.parse(approval)).toEqual(approval);
  expect(
    verifierApprovalRecord.safeParse({ ...approval, expiresAt: 'later' })
      .success
  ).toBe(false);
});

it('preserves approval expiry timestamps with UTC or an explicit offset', () => {
  for (const value of ['2026-11-23T00:00:00Z', '2026-11-23T01:00:00+01:00'])
    expect(verifierApprovalExpiry.parse(value)).toBe(value);

  for (const value of [
    '2026-11-23T00:00:00',
    '2026-02-30T00:00:00Z',
    'later',
    undefined,
  ])
    expect(verifierApprovalExpiry.safeParse(value).success).toBe(false);
});
