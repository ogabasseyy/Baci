import { expect, it, vi } from 'vitest';

vi.mock('../experience-runner/helper-preflight', () => ({
  createHelperPreflight: vi.fn(() => async () => ({
    toolchainDigest: 'a'.repeat(64),
  })),
}));
vi.mock('./public-verification-qualified', () => ({
  createQualifiedPublicObserver: vi.fn(
    async (settings: {
      toolchainDigest: string;
      verifyInstallation(): Promise<{ toolchainDigest: string }>;
    }) => {
      const receipt = await settings.verifyInstallation();
      if (receipt.toolchainDigest !== settings.toolchainDigest)
        throw Error('TOOLCHAIN_MISMATCH');
      return 'observer';
    }
  ),
}));

import { createHelperPreflight } from '../experience-runner/helper-preflight';
import { runCommand } from '../experience-runner/linux-runner';
import { createLocalPinnedPublicObserver } from './public-verification-local';

it('uses the fixed helper preflight for the configured toolchain pin', async () => {
  await expect(
    createLocalPinnedPublicObserver({
      productOrigin: 'https://project.supabase.co',
      toolchainDigest: 'a'.repeat(64),
    })
  ).resolves.toBe('observer');
  expect(createHelperPreflight).toHaveBeenCalledWith(runCommand);
});

it('refuses an installation receipt for a different toolchain', async () => {
  await expect(
    createLocalPinnedPublicObserver({
      productOrigin: 'https://project.supabase.co',
      toolchainDigest: 'b'.repeat(64),
    })
  ).rejects.toThrow('TOOLCHAIN_MISMATCH');
});
