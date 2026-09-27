// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function loadInternalApiSecret() {
  vi.resetModules();
  return import('./internal-api-secret');
}

describe('getInternalApiSecret', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('INTERNAL_API_SECRET', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses a trimmed runtime secret over the module-load fallback', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', 'initial-secret');
    const { getInternalApiSecret } = await loadInternalApiSecret();

    vi.stubEnv('INTERNAL_API_SECRET', '  rotated-secret  ');

    expect(getInternalApiSecret()).toBe('rotated-secret');
  });

  it.each([
    ['blank', '   '],
    ['missing', undefined],
  ])('uses the module-load secret when the runtime value becomes %s', async (_state, runtimeSecret) => {
    vi.stubEnv('INTERNAL_API_SECRET', 'initial-secret');
    const { getInternalApiSecret } = await loadInternalApiSecret();

    vi.stubEnv('INTERNAL_API_SECRET', runtimeSecret);

    expect(getInternalApiSecret()).toBe('initial-secret');
  });

  it('returns undefined when neither runtime nor module-load secret is present', async () => {
    const { getInternalApiSecret } = await loadInternalApiSecret();

    expect(getInternalApiSecret()).toBeUndefined();
  });

  it('rejects access from a real browser runtime', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('window', {});
    const { getInternalApiSecret } = await loadInternalApiSecret();

    expect(() => getInternalApiSecret()).toThrow(
      'INTERNAL_API_SECRET cannot be accessed on the client'
    );
  });

  it('allows the Vitest jsdom window shim', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', 'test-secret');
    vi.stubGlobal('window', {});
    const { getInternalApiSecret } = await loadInternalApiSecret();

    expect(getInternalApiSecret()).toBe('test-secret');
  });
});
