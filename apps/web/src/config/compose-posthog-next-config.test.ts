/** @vitest-environment node */

import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { afterEach, expect, it, vi } from 'vitest';
import { composePostHogNextConfig } from './compose-posthog-next-config';

afterEach(() => vi.unstubAllEnvs());

it('resolves a disabled composition without adding upload hooks', async () => {
  const resolve = composePostHogNextConfig({ poweredByHeader: false });
  expect(await resolve(PHASE_PRODUCTION_BUILD)).toEqual({
    poweredByHeader: false,
  });
});

it('resolves actual async PostHog composition for direct callers without a context', async () => {
  vi.stubEnv('TURBOPACK', '1');
  const resolve = composePostHogNextConfig(
    { poweredByHeader: false },
    {
      personalApiKey: 'synthetic-source-map-key',
      projectId: '123',
      sourcemaps: { enabled: true },
    }
  );
  expect(await resolve(PHASE_PRODUCTION_BUILD)).toEqual(
    expect.objectContaining({
      poweredByHeader: false,
      productionBrowserSourceMaps: true,
      compiler: expect.objectContaining({
        runAfterProductionCompile: expect.any(Function),
      }),
    })
  );
});
