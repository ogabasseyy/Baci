import { expect, it } from 'vitest';
import {
  experienceRunnerInstallationPin,
  experienceToolchainDigest,
} from './experience-runner-installation';

it('accepts only a 64-character lowercase hexadecimal toolchain digest', () => {
  const digest = '0123456789abcdef'.repeat(4);
  expect(experienceToolchainDigest.parse(digest)).toBe(digest);
  for (const invalid of [
    digest.slice(1),
    `${digest}0`,
    digest.toUpperCase(),
    'g'.repeat(64),
  ]) {
    expect(experienceToolchainDigest.safeParse(invalid).success).toBe(false);
  }
});

it('requires complete immutable installation digests and explicit tool versions', () => {
  const digest = 'a'.repeat(64);
  const pin = {
    format: 'baci.runner-installation-pin/v2',
    toolchainDigest: digest,
    rootfs: { node24: digest, browser: digest },
    runscDigest: digest,
    gvisorBinDigest: digest,
    versions: {
      compilerNode: 'v24.1.0',
      captureNode: 'v24.1.0',
      runsc: 'release-20261019.0',
    },
  };
  expect(experienceRunnerInstallationPin.safeParse(pin).success).toBe(true);
  expect(
    experienceRunnerInstallationPin.safeParse({
      ...pin,
      gvisorBinDigest: undefined,
    }).success
  ).toBe(false);
  expect(
    experienceRunnerInstallationPin.safeParse({ ...pin, runscDigest: 'latest' })
      .success
  ).toBe(false);
  expect(
    experienceRunnerInstallationPin.safeParse({ ...pin, command: 'untrusted' })
      .success
  ).toBe(false);
});
