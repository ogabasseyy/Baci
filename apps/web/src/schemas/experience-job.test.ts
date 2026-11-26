import { expect, it } from 'vitest';
import {
  experienceBuildInput,
  experienceFinalizedOperation,
} from './experience-job';

it('queue input cannot select worker commands or forge accepted evidence', () => {
  expect(
    experienceBuildInput.safeParse({
      artifactId: '10000000-0000-4000-8000-000000000001',
      idempotencyKey: '20000000-0000-4000-8000-000000000001',
    }).success
  ).toBe(true);
  expect(
    experienceBuildInput.safeParse({
      artifactId: '10000000-0000-4000-8000-000000000001',
      idempotencyKey: '20000000-0000-4000-8000-000000000001',
      command: 'shell',
      accepted: true,
    }).success
  ).toBe(false);
});

it('requires finalized operation IDs and digests while leaving other job fields to the caller', () => {
  const build = {
    buildId: '11111111-1111-4111-8111-111111111111',
    buildDigest: 'a'.repeat(64),
  };
  expect(
    experienceFinalizedOperation.parse({ ...build, status: 'finalized' })
  ).toEqual(build);
  expect(
    experienceFinalizedOperation.safeParse({ ...build, buildDigest: 'bad' })
      .success
  ).toBe(false);
});
