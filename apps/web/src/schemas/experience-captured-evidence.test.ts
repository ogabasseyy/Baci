import { expect, it } from 'vitest';
import { experienceCapturedEvidence } from './experience-captured-evidence';

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
