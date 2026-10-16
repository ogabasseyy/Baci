/** @vitest-environment node */

import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { configSchema } from 'next/dist/server/config-schema';
import { normalizeConfig } from 'next/dist/server/config-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const guard = vi.hoisted(() => vi.fn());
vi.mock('./src/config/pilot-public-assets', () => ({
  assertPilotPublicAssets: guard,
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function enableSyntheticSourceMaps() {
  vi.stubEnv('POSTHOG_API_KEY', 'synthetic-source-map-key');
  vi.stubEnv('POSTHOG_PROJECT_ID', '123');
  vi.stubEnv('TURBOPACK', '1');
  vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
}

describe('Next configuration with PostHog source maps enabled', () => {
  it('resolves once to a valid config while preserving upload hooks and the pilot gate', async () => {
    enableSyntheticSourceMaps();
    const config = (await import('./next.config')).default;
    const resolved: unknown = await normalizeConfig(
      PHASE_PRODUCTION_BUILD,
      config
    );

    expect(typeof resolved).toBe('object');
    expect(configSchema.safeParse(resolved).success).toBe(true);
    expect(resolved).toEqual(
      expect.objectContaining({
        productionBrowserSourceMaps: true,
        webpack: expect.any(Function),
        compiler: expect.objectContaining({
          runAfterProductionCompile: expect.any(Function),
        }),
      })
    );
    expect(guard).toHaveBeenCalledWith(
      expect.stringMatching(/apps\/web\/public$/),
      undefined,
      'warn',
      'throw'
    );
  });

  it('still rejects unsafe staging synchronously before resolving PostHog', async () => {
    enableSyntheticSourceMaps();
    guard.mockImplementationOnce(() => {
      throw new Error('staged merchant pilot assets');
    });
    const config = (await import('./next.config')).default;
    expect(() => config(PHASE_PRODUCTION_BUILD)).toThrow(
      'staged merchant pilot assets'
    );
  });
});
