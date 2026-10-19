import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STOREFRONT_EDGE_NEXT_REDIRECT_ROWS } from './storefront-edge-next-redirect-rows';

const normalizeNextRedirectSource = (source: string) =>
  source
    .replace(/:([A-Za-z][A-Za-z0-9_]*)\*/g, '{*$1?}')
    .replace(/:([A-Za-z][A-Za-z0-9_]*)/g, '{$1}');

const collapsePairedNextRedirectSources = (patterns: readonly string[]) => {
  const uniquePatterns = [...new Set(patterns)];
  return new Set(
    uniquePatterns.filter(
      (pattern) =>
        !uniquePatterns.some(
          (candidate) =>
            candidate.startsWith(`${pattern}/`) &&
            /\/\{\*[^}]+\?\}$/.test(candidate)
        )
    )
  );
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('STOREFRONT_EDGE_NEXT_REDIRECT_ROWS', () => {
  it('pins every reviewed next.config redirect as a document redirect', () => {
    expect(STOREFRONT_EDGE_NEXT_REDIRECT_ROWS).toHaveLength(27);
    expect(
      STOREFRONT_EDGE_NEXT_REDIRECT_ROWS.every(
        ({ decision, methods, reason }) =>
          decision === 'edge_redirect' &&
          reason === 'next_config_redirect' &&
          methods.join(',') === 'ANY'
      )
    ).toBe(true);
    expect(STOREFRONT_EDGE_NEXT_REDIRECT_ROWS.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['next:user-legacy', 'next:blog-wwdc'])
    );
    expect(
      STOREFRONT_EDGE_NEXT_REDIRECT_ROWS.find(({ id }) => id === 'next:macbook')
        ?.hostCondition?.hostnameIn
    ).toEqual(['ogabassey.com']);
    expect(
      STOREFRONT_EDGE_NEXT_REDIRECT_ROWS.find(
        ({ id }) => id === 'next:product-category'
      )?.hostCondition?.hostnameIn
    ).toEqual(['ogabassey.com', 'www.ogabassey.com']);
  });

  it.each([
    false,
    true,
  ])('matches active Next redirects with source maps enabled: %s', async (sourceMapsEnabled) => {
    // Arrange
    vi.stubEnv(
      'POSTHOG_API_KEY',
      sourceMapsEnabled ? 'synthetic-source-map-key' : ''
    );
    vi.stubEnv('POSTHOG_PROJECT_ID', sourceMapsEnabled ? '123' : '');
    vi.stubEnv('TURBOPACK', '1');
    const nextConfig = (await import('../../next.config')).default;
    // The config export is a function of Next's phase: resolve the
    // shipped (production-build) config before reading redirects.
    const config = await nextConfig(PHASE_PRODUCTION_BUILD);
    const redirects = await config.redirects?.();
    if (!redirects)
      throw new Error('active Next config does not declare redirects');

    // Act
    const configuredPatterns = collapsePairedNextRedirectSources(
      redirects.map(({ source }) => normalizeNextRedirectSource(source))
    );
    const inventoryPatterns = new Set(
      STOREFRONT_EDGE_NEXT_REDIRECT_ROWS.map(({ routePattern }) => routePattern)
    );

    // Assert
    expect(inventoryPatterns).toEqual(configuredPatterns);
  });
});
