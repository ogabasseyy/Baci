import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import rawNextConfig from './next.config';

type NextConfigFunction = (
  phase: string,
  context: { defaultConfig: NextConfig }
) => NextConfig | Promise<NextConfig>;

type ResolvableNextConfig = NextConfig | NextConfigFunction;

async function resolveNextConfig(
  config: ResolvableNextConfig
): Promise<NextConfig> {
  if (typeof config === 'function') {
    return config(PHASE_PRODUCTION_BUILD, { defaultConfig: {} });
  }
  return config;
}

describe('next.config static asset headers', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sets immutable caching only for Next hashed static assets', async () => {
    const nextConfig = await resolveNextConfig(rawNextConfig);
    expect(typeof nextConfig.headers).toBe('function');
    const headers = await nextConfig.headers();
    const assetRule = headers.find(
      (entry) => entry.source === '/_next/static/:path*'
    );

    expect(assetRule?.headers).toContainEqual({
      key: 'Cache-Control',
      value: 'public, max-age=31536000, immutable',
    });
    expect(
      headers.some(
        (entry) =>
          entry.source === '/api/:path*' &&
          entry.headers.some((header) => header.key === 'Cache-Control')
      )
    ).toBe(false);
    expect(
      headers.some(
        (entry) =>
          entry.source === '/(.*)' &&
          entry.headers.some((header) => header.key === 'Cache-Control')
      )
    ).toBe(false);
  });

  it('leaves Next development assets under the built-in no-cache policy', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const nextConfig = await resolveNextConfig(rawNextConfig);
    expect(typeof nextConfig.headers).toBe('function');
    const headers = await nextConfig.headers();
    expect(
      headers.some(
        (entry) =>
          entry.source === '/_next/static/:path*' &&
          entry.headers.some((header) => header.key === 'Cache-Control')
      )
    ).toBe(false);
  });
  it('does not emit OgaBassey hero image preload Link headers from next.config', async () => {
    const nextConfig = await resolveNextConfig(rawNextConfig);
    expect(typeof nextConfig.headers).toBe('function');
    const headers = await nextConfig.headers();
    expect(headers).toBeDefined();

    const homeLinkRules =
      headers?.filter(
        (entry) =>
          entry.source === '/' &&
          entry.headers.some((header) => header.key === 'Link')
      ) ?? [];

    const linkHeaderValues = homeLinkRules.flatMap((rule) =>
      rule.headers
        .filter((header) => header.key === 'Link')
        .map((header) => header.value)
    );

    expect(
      linkHeaderValues.some((value) =>
        /iphone-17-pro-max-(mobile|desktop).*rel=preload/.test(value)
      )
    ).toBe(false);
  });

  it('does not route OgaBassey hero assets through next.config headers matchers', async () => {
    const nextConfig = await resolveNextConfig(rawNextConfig);
    expect(typeof nextConfig.headers).toBe('function');
    const headers = await nextConfig.headers();
    expect(headers).toBeDefined();
    const heroAssetHeaders = headers.find((entry) =>
      entry.source.includes('ogabassey-hero')
    );

    expect(heroAssetHeaders).toBeUndefined();
  });
});
