import { expect, it } from 'vitest';
import {
  experienceSourceCandidateInput,
  experienceSourceCandidateResult,
} from './experience-source-candidate';

const artifactId = '11111111-1111-4111-8111-111111111111';
const input = {
  artifactId,
  baseDigest: 'a'.repeat(64),
  expectedVersion: 0,
  idempotencyKey: '22222222-2222-4222-8222-222222222222',
};

it('accepts exact adoption requests at version zero and positive versions', () => {
  expect(experienceSourceCandidateInput.parse(input)).toEqual(input);
  expect(
    experienceSourceCandidateInput.safeParse({ ...input, expectedVersion: 7 })
      .success
  ).toBe(true);
  for (const patch of [
    { artifactId: 'bad' },
    { baseDigest: 'a'.repeat(63) },
    { baseDigest: 'A'.repeat(64) },
    { idempotencyKey: 'bad' },
    { expectedVersion: -1 },
    { expectedVersion: 0.5 },
    { expectedVersion: '0' },
    { merchantId: artifactId },
  ])
    expect(
      experienceSourceCandidateInput.safeParse({ ...input, ...patch }).success
    ).toBe(false);
});

it('requires an explicit conflict outcome and valid result bindings', () => {
  for (const conflict of [true, false]) {
    const result = { artifactId, version: 0, conflict };
    expect(experienceSourceCandidateResult.parse(result)).toEqual(result);
  }
  for (const invalid of [
    { artifactId, version: 0 },
    { artifactId, version: 0, conflict: 'false' },
    { artifactId: 'bad', version: 0, conflict: false },
    { artifactId, version: -1, conflict: false },
    { artifactId, version: 0.5, conflict: false },
    { artifactId, version: 0, conflict: false, approved: true },
  ])
    expect(experienceSourceCandidateResult.safeParse(invalid).success).toBe(
      false
    );
});
