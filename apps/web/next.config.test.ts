import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import rawNextConfig from './next.config';
import {
  getStorefrontMetadataCacheBucket,
  STOREFRONT_METADATA_BLOCKING_BOT_USER_AGENT_REGEX,
} from './src/config/storefront-metadata-cache-bots';

type NextConfigFunction = (
  phase: string,
  context: { defaultConfig: NextConfig }
) => NextConfig | Promise<NextConfig>;

type ResolvableNextConfig = NextConfig | NextConfigFunction;

function resolveNextConfig(config: ResolvableNextConfig): Promise<NextConfig> {
  if (typeof config === 'function') {
    return Promise.resolve(
      config(PHASE_PRODUCTION_BUILD, { defaultConfig: {} })
    );
  }

  return Promise.resolve(config);
}

describe('next.config core options', () => {
  let nextConfig: NextConfig;

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    nextConfig = await resolveNextConfig(rawNextConfig as ResolvableNextConfig);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('lets proxy handle legacy Klump webhook trailing slash compatibility', () => {
    expect(nextConfig.skipTrailingSlashRedirect).toBe(true);
  });

  it('bounds static generation pressure and retries transient page failures', () => {
    expect(nextConfig.experimental).toEqual(
      expect.objectContaining({
        cpus: 1,
        staticGenerationMaxConcurrency: 1,
        staticGenerationMinPagesPerWorker: 1_600,
        staticGenerationRetryCount: 3,
      })
    );
  });

  it('does not pass the removed viewTransition experiment to Next 16.3', () => {
    expect(nextConfig.experimental).not.toHaveProperty('viewTransition');
  });

  it('uses the TypeScript CLI so Next can run the TypeScript 7 compiler', () => {
    expect(nextConfig.experimental?.useTypeScriptCli).toBe(true);
  });

  it('publishes only public PostHog release context envs to the browser bundle', () => {
    expect(nextConfig.env).toEqual(
      expect.not.objectContaining({
        VERCEL_DEPLOYMENT_ID: expect.any(String),
        VERCEL_GIT_COMMIT_REF: expect.any(String),
        VERCEL_GIT_COMMIT_SHA: expect.any(String),
        VERCEL_URL: expect.any(String),
      })
    );
    expect(Object.keys(nextConfig.env ?? {})).toEqual(
      expect.arrayContaining(['NEXT_PUBLIC_VERCEL_ENV'])
    );
  });

  it('keeps server PDF dependencies externalized for Node PDF generation', () => {
    expect(nextConfig.serverExternalPackages).toEqual(
      expect.arrayContaining(['jspdf', 'jspdf-autotable'])
    );
  });

  it('allows tuned OgaBassey image quality values', () => {
    expect(nextConfig.images?.qualities).toEqual([
      35, 50, 60, 70, 75, 80, 85, 90, 100,
    ]);
  });

  it('uses the shared custom next/image loader instead of the default optimizer', () => {
    const loaderFile = nextConfig.images?.loaderFile;

    expect(nextConfig.images?.loader).toBe('custom');
    expect(typeof loaderFile).toBe('string');
    expect(loaderFile).toBe('./src/lib/image-loader.ts');
    expect(existsSync(resolve(process.cwd(), String(loaderFile)))).toBe(true);
  });

  it('uses the same metadata-blocking bot classifier as storefront cache buckets', () => {
    expect(nextConfig.htmlLimitedBots?.source).toBe(
      STOREFRONT_METADATA_BLOCKING_BOT_USER_AGENT_REGEX.source
    );
    expect(nextConfig.htmlLimitedBots?.flags).toContain('i');
    expect(getStorefrontMetadataCacheBucket('Googlebot/2.1')).toBe(
      'metadata-blocking'
    );
    expect(getStorefrontMetadataCacheBucket('Twitterbot/1.0')).toBe(
      'metadata-blocking'
    );
    expect(getStorefrontMetadataCacheBucket('SemrushBot/7~bl')).toBe(
      'metadata-blocking'
    );
    expect(getStorefrontMetadataCacheBucket('GPTBot/1.1')).toBe(
      'metadata-blocking'
    );
    expect(getStorefrontMetadataCacheBucket('ClaudeBot/1.0')).toBe(
      'metadata-blocking'
    );
    expect(getStorefrontMetadataCacheBucket('Claude-User/1.0')).toBe(
      'metadata-blocking'
    );
    expect(getStorefrontMetadataCacheBucket('PerplexityBot/1.0')).toBe(
      'metadata-blocking'
    );
    expect(getStorefrontMetadataCacheBucket('Perplexity-User/1.0')).toBe(
      'metadata-blocking'
    );
    expect(nextConfig.htmlLimitedBots?.test('SemrushBot/7~bl')).toBe(true);
    expect(nextConfig.htmlLimitedBots?.test('GPTBot/1.1')).toBe(true);
    expect(nextConfig.htmlLimitedBots?.test('ClaudeBot/1.0')).toBe(true);
    expect(nextConfig.htmlLimitedBots?.test('Claude-User/1.0')).toBe(true);
    expect(nextConfig.htmlLimitedBots?.test('PerplexityBot/1.0')).toBe(true);
    expect(nextConfig.htmlLimitedBots?.test('Perplexity-User/1.0')).toBe(true);
    expect(
      getStorefrontMetadataCacheBucket(
        'Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0 Safari/537.36'
      )
    ).toBe('streaming');
    expect(
      getStorefrontMetadataCacheBucket('Instagram 350.0.0.29.93 Android')
    ).toBe('streaming');
  });
});
