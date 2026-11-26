import { expect, it } from 'vitest';
import {
  experienceCapturedEvidence,
  experienceCaptureRecordBindingSchema,
} from './experience-captured-evidence';

const digest = 'a'.repeat(64);
const value = {
  effectDigest: digest,
  artifactReceipt: digest,
  evidenceDigest: digest,
  routes: ['/'],
};
it('validates independent evidence and rejects malformed bindings and extra fields', () => {
  expect(experienceCapturedEvidence.parse(value)).toEqual(value);
  for (const invalid of [
    { ...value, effectDigest: 'bad' },
    { ...value, routes: [] },
    { ...value, routes: ['x'.repeat(241)] },
    { ...value, buildId: 'bad' },
    { ...value, approved: true },
  ])
    expect(experienceCapturedEvidence.safeParse(invalid).success).toBe(false);
});

it('requires all capture record UUIDs and SHA-256 digests before storage', () => {
  const binding = {
    id: '11111111-1111-4111-8111-111111111111',
    merchantId: '22222222-2222-4222-8222-222222222222',
    buildId: '33333333-3333-4333-8333-333333333333',
    buildDigest: digest,
    keyDigest: digest,
    evidenceDigest: digest,
  };
  expect(experienceCaptureRecordBindingSchema.parse(binding)).toEqual(binding);
  for (const key of Object.keys(binding)) {
    expect(
      experienceCaptureRecordBindingSchema.safeParse({
        ...binding,
        [key]: 'invalid',
      }).success
    ).toBe(false);
    expect(
      experienceCaptureRecordBindingSchema.safeParse({
        ...binding,
        [key]: undefined,
      }).success
    ).toBe(false);
  }
});
