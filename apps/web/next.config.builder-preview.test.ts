import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { describe, expect, it } from 'vitest';
import rawNextConfig from './next.config';

type NextConfigFunction = (
  phase: string,
  context: { defaultConfig: NextConfig }
) => NextConfig | Promise<NextConfig>;

async function resolveNextConfig(): Promise<NextConfig> {
  if (typeof rawNextConfig === 'function') {
    return rawNextConfig(PHASE_PRODUCTION_BUILD, { defaultConfig: {} });
  }
  return rawNextConfig as NextConfigFunction as unknown as NextConfig;
}

describe('next.config builder preview headers', () => {
  it('adds only the explicit private no-store cache rule for the builder preview', async () => {
    const nextConfig = await resolveNextConfig();
    expect(typeof nextConfig.headers).toBe('function');
    const headers = await nextConfig.headers();

    expect(headers).toEqual(
      expect.arrayContaining([
        {
          headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
          source: '/template-preview/builder-preview',
        },
      ])
    );
  });
});
