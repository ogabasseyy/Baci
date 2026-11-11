import { expect, it } from 'vitest';
import { experienceRunnerRequest } from './experience-runner-transport';

it('requires signed-envelope fields and rejects unknown lanes or executable configuration', () => {
  const envelope = {
    version: 1,
    nonce: 'a'.repeat(64),
    expiresAt: 1000,
    toolchainDigest: 'b'.repeat(64),
    lane: 'owner',
    kind: 'compile',
    payload: {},
  };
  expect(experienceRunnerRequest.safeParse(envelope).success).toBe(true);
  for (const extra of [
    { lane: 'admin' },
    { nonce: 'short' },
    { version: 2 },
    { command: 'sh' },
  ])
    expect(
      experienceRunnerRequest.safeParse({ ...envelope, ...extra }).success
    ).toBe(false);
});
