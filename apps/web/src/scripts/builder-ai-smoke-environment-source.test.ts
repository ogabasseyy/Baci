import { describe, expect, it } from 'vitest';
import {
  validateBuilderAiSmokeEnvironmentSource,
  type BuilderAiSmokeEnvironmentSourceDependencies,
} from './builder-ai-smoke-environment-source';

function dependencies(
  overrides: Partial<BuilderAiSmokeEnvironmentSourceDependencies> = {}
): BuilderAiSmokeEnvironmentSourceDependencies {
  return {
    isIgnored: async () => true,
    lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }),
    primaryCheckout: '/primary',
    realpath: async (path) => path,
    ...overrides,
  };
}

describe('Builder AI smoke environment source validation', () => {
  it('accepts only a canonical gitignored primary-checkout env file', async () => {
    await expect(
      validateBuilderAiSmokeEnvironmentSource(
        '/primary/apps/web/.env',
        dependencies()
      )
    ).resolves.toEqual({ path: '/primary/apps/web/.env' });
  });

  it.each([
    '/other/apps/web/.env',
    '/primary/apps/web/.env.backup',
    '/primary/apps/api/.env',
  ])('rejects a matching suffix outside the exact allowlist: %s', async (source) => {
    await expect(
      validateBuilderAiSmokeEnvironmentSource(source, dependencies())
    ).resolves.toBeNull();
  });

  it('rejects symlinks, realpath escapes, non-files, and nonignored sources', async () => {
    for (const overrides of [
      { lstat: async () => ({ isFile: () => true, isSymbolicLink: () => true }) },
      { realpath: async () => '/outside/.env' },
      { lstat: async () => ({ isFile: () => false, isSymbolicLink: () => false }) },
      { isIgnored: async () => false },
    ]) {
      await expect(
        validateBuilderAiSmokeEnvironmentSource(
          '/primary/apps/web/.env',
          dependencies(overrides)
        )
      ).resolves.toBeNull();
    }
  });
});
