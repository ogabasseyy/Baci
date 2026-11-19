import { expect, it } from 'vitest';
import { experienceBuildInput } from './experience-job';

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
