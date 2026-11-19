import { expect, it } from 'vitest';
import { experienceSourcePatch } from './experience-source-patch';

const input = {
  baseDigest: 'a'.repeat(64),
  expectedVersion: 0,
  files: [{ path: 'src/App.tsx', content: 'synthetic' }],
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
};
it('accepts bounded source patches and rejects unsafe paths, stale versions and extra fields', () => {
  expect(experienceSourcePatch.parse(input)).toEqual(input);
  for (const invalid of [
    { ...input, files: [] },
    { ...input, files: Array.from({ length: 129 }, () => input.files[0]) },
    { ...input, files: [{ path: '../private', content: '' }] },
    { ...input, expectedVersion: -1 },
    { ...input, approved: true },
  ])
    expect(experienceSourcePatch.safeParse(invalid).success).toBe(false);
});
