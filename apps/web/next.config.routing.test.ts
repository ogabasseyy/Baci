import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import rawNextConfig from './next.config';
import { STOREFRONT_METADATA_CACHE_BUCKET_HEADER } from './src/config/storefront-metadata-cache-bots';
import {
  DEFAULT_POSTHOG_ASSETS_HOST,
  DEFAULT_POSTHOG_INGEST_HOST,
  DEFAULT_POSTHOG_PROXY_PATH,
} from './src/lib/posthog/config';

type NextConfigFunction = (
  phase: string,
  context: { defaultConfig: NextConfig }
) => NextConfig | Promise<NextConfig>;

type ResolvableNextConfig = NextConfig | NextConfigFunction;

function expectStructuredRewrites(
  rewrites: unknown
): asserts rewrites is { beforeFiles?: unknown[]; afterFiles?: unknown[] } {
  expect(Array.isArray(rewrites)).toBe(false);
  expect(typeof rewrites).toBe('object');
  expect(rewrites).not.toBeNull();
}

function resolveNextConfig(config: ResolvableNextConfig): Promise<NextConfig> {
  if (typeof config === 'function') {
    return Promise.resolve(
      config(PHASE_PRODUCTION_BUILD, { defaultConfig: {} })
    );
  }

  return Promise.resolve(config);
}

describe('next.config rewrites and redirects', () => {
  let nextConfig: NextConfig;

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    nextConfig = await resolveNextConfig(rawNextConfig as ResolvableNextConfig);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('rewrites agent-readable homepage and robots probes to machine endpoints', async () => {
    expect(typeof nextConfig.rewrites).toBe('function');
    const rewrites = await nextConfig.rewrites();
    expectStructuredRewrites(rewrites);
    const beforeFiles = rewrites.beforeFiles ?? [];

    expect(beforeFiles).toEqual(
      expect.arrayContaining([
        {
          source: `${DEFAULT_POSTHOG_PROXY_PATH}/static/:path*`,
          destination: `${DEFAULT_POSTHOG_ASSETS_HOST}/static/:path*`,
        },
        {
          source: `${DEFAULT_POSTHOG_PROXY_PATH}/array/:path*`,
          destination: `${DEFAULT_POSTHOG_ASSETS_HOST}/array/:path*`,
        },
        {
          source: `${DEFAULT_POSTHOG_PROXY_PATH}/:path*`,
          destination: `${DEFAULT_POSTHOG_INGEST_HOST}/:path*`,
        },
        {
          source: '/',
          has: [
            {
              type: 'header',
              key: 'accept',
              value: '(?<accept>.*text/markdown.*)',
            },
          ],
          destination: '/llms-full.txt',
        },
        {
          source:
            '/:storefrontIdentifier((?!(?:auth\\.md|openapi\\.json|agent-commerce\\.json|agent-trust\\.json|llms\\.txt|llms-full\\.txt|robots\\.txt|api|_next|\\.well-known)(?:$|/)).+)',
          has: [
            {
              type: 'header',
              key: 'accept',
              value: '(?<accept>.*text/markdown.*)',
            },
          ],
          destination: '/llms-full.txt',
        },
        {
          source: '/robots.txt',
          destination: '/api/robots',
        },
      ])
    );

    expect(
      beforeFiles.some(
        (rewrite) =>
          rewrite.source === '/:storefrontIdentifier' &&
          rewrite.destination === '/llms-full.txt'
      )
    ).toBe(false);
  });

  it('keeps MCP proxy rewrites when MCP_SERVER_URL is configured', async () => {
    expect(typeof nextConfig.rewrites).toBe('function');
    const originalMcpServerUrl = process.env.MCP_SERVER_URL;
    process.env.MCP_SERVER_URL = 'https://mcp.example.test';

    try {
      const rewrites = await nextConfig.rewrites();

      expect(Array.isArray(rewrites)).toBe(false);
      expect(rewrites).toMatchObject({
        afterFiles: expect.arrayContaining([
          {
            source: '/mcp/sse',
            destination: 'https://mcp.example.test/sse',
          },
          {
            source: '/mcp/messages',
            destination: 'https://mcp.example.test/messages',
          },
        ]),
      });
    } finally {
      if (originalMcpServerUrl === undefined) {
        delete process.env.MCP_SERVER_URL;
      } else {
        process.env.MCP_SERVER_URL = originalMcpServerUrl;
      }
    }
  });

  it('does not partition OgaBassey storefront HTML cache by raw user agent', async () => {
    expect(typeof nextConfig.headers).toBe('function');
    const headers = await nextConfig.headers();

    const varyValues =
      headers?.flatMap((entry) =>
        entry.headers
          .filter((header) => header.key.toLowerCase() === 'vary')
          .map((header) => header.value)
      ) ?? [];

    expect(varyValues).not.toContain('User-Agent');
  });

  it('partitions HTML document cache by the normalized metadata bucket header', async () => {
    expect(typeof nextConfig.headers).toBe('function');
    const headers = await nextConfig.headers();

    expect(headers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source:
            '/((?!api(?:/|$)|_next(?:/|$)|.*\\.(?:avif|css|eot|gif|ico|jpe?g|js|json|map|png|svg|ttf|txt|webmanifest|webp|woff2?|xml)$).*)',
          headers: expect.arrayContaining([
            {
              key: 'Vary',
              value: [
                STOREFRONT_METADATA_CACHE_BUCKET_HEADER,
                'rsc',
                'next-router-state-tree',
                'next-router-prefetch',
                'next-router-segment-prefetch',
              ].join(', '),
            },
          ]),
        }),
      ])
    );
  });

  it('redirects the imported encoded blog slug to its ASCII canonical URL', async () => {
    expect(typeof nextConfig.redirects).toBe('function');
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source:
            '/blog/wwdc-2025-5-game%e2%80%91changing-apple-announcements/:path*',
          destination: '/blog/wwdc-2025-5-game-changing-apple-announcements',
          permanent: true,
        }),
        expect.objectContaining({
          source:
            '/blog/2025/06/10/wwdc-2025-5-game%e2%80%91changing-apple-announcements/:path*',
          destination: '/blog/wwdc-2025-5-game-changing-apple-announcements',
          permanent: true,
        }),
        expect.objectContaining({
          source:
            '/blog/wwdc%e2%80%912025%e2%80%915-game-changing-apple-announcements/:path*',
          destination: '/blog/wwdc-2025-5-game-changing-apple-announcements',
          permanent: true,
        }),
        expect.objectContaining({
          source:
            '/blog/wwdc%25e2%2580%25912025%25e2%2580%25915-game-changing-apple-announcements/:path*',
          destination: '/blog/wwdc-2025-5-game-changing-apple-announcements',
          permanent: true,
        }),
      ])
    );
  });

  it('redirects retired off-topic blog imports back to the tech blog index', async () => {
    expect(typeof nextConfig.redirects).toBe('function');
    const redirects = await nextConfig.redirects?.();
    const retiredRedirectSources = [
      '/blog/abubakar-malami-remanded-former-nigerian-agf-faces-multi-billion-naira-property-charges',
      '/blog/cbn-forecast-nigerias-external-reserves-projected-to-hit-5104-billion-by-2026',
    ];

    for (const source of retiredRedirectSources) {
      const sourceRedirects = redirects?.filter(
        (entry) =>
          entry.source === source &&
          entry.destination === '/blog' &&
          entry.permanent === true
      );
      expect(sourceRedirects).toHaveLength(2);

      const hostMatchers =
        sourceRedirects?.flatMap(
          (entry) =>
            entry.has
              ?.filter((condition) => condition.type === 'host')
              .map((condition) => condition.value)
              .filter((value): value is string => typeof value === 'string') ??
            []
        ) ?? [];

      const matchesHost = (host: string) =>
        hostMatchers.some((matcher) => new RegExp(`^${matcher}$`).test(host));

      expect(matchesHost('ogabassey.com')).toBe(true);
      expect(matchesHost('www.ogabassey.com')).toBe(true);
      expect(matchesHost('shop.ogabassey.com')).toBe(false);
    }
  });
});
