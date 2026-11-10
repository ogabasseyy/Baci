import { expect, it } from 'vitest';
import { experienceRunnerInstallationPin } from './experience-runner-installation';

it('requires complete immutable installation digests and explicit tool versions', () => {
  const digest = 'a'.repeat(64);
  const pin = {
    format: 'baci.runner-installation-pin/v1',
    toolchainDigest: digest,
    rootfs: { node24: digest, browser: digest },
    runscDigest: digest,
    versions: {
      compilerNode: 'v24.1.0',
      captureNode: 'v24.1.0',
      runsc: 'release-20261019.0',
    },
  };
  expect(experienceRunnerInstallationPin.safeParse(pin).success).toBe(true);
  expect(
    experienceRunnerInstallationPin.safeParse({ ...pin, runscDigest: 'latest' })
      .success
  ).toBe(false);
  expect(
    experienceRunnerInstallationPin.safeParse({ ...pin, command: 'untrusted' })
      .success
  ).toBe(false);
});
