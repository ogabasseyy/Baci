import { describe, expect, it } from 'vitest';
import { createStorefrontEdgeEntrypointRows } from './create-storefront-edge-entrypoint-rows';
import { STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS } from './storefront-edge-entrypoint-classifications';

const routeRoot = 'apps/web/src/app/(storefront)/[slug]';

function entrypointSource(relativeSourcePath: string) {
  const isRouteHandler =
    relativeSourcePath.endsWith('route.ts') ||
    relativeSourcePath.endsWith('route.tsx') ||
    relativeSourcePath.endsWith('route.js') ||
    relativeSourcePath.endsWith('route.jsx');
  return {
    bytes: Buffer.from(
      isRouteHandler
        ? 'export async function GET() {}'
        : 'export default function Page() {}'
    ),
    sourcePath: `${routeRoot}/${relativeSourcePath}`,
  };
}

describe('createStorefrontEdgeEntrypointRows', () => {
  it('maps page, handler, and metadata conventions to public route patterns', () => {
    // Arrange
    const routeSources = [
      ...STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.keys().map(
        entrypointSource
      ),
      entrypointSource('(home)/page.ts'),
      {
        bytes: Buffer.from('export default function Layout() {}'),
        sourcePath: `${routeRoot}/layout.tsx`,
      },
    ];

    // Act
    const rows = createStorefrontEdgeEntrypointRows(routeRoot, routeSources);

    // Assert
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routePattern: '/',
          decision: 'edge_release',
        }),
        expect.objectContaining({
          routePattern: '/blog/{*catchAll}',
          decision: 'origin_dynamic',
          methods: ['GET', 'HEAD'],
        }),
        expect.objectContaining({ routePattern: '/blog/sitemap.xml' }),
        expect.objectContaining({ routePattern: '/opengraph-image' }),
        expect.objectContaining({
          decision: 'origin_dynamic',
          routePattern: '/product/{productSlug}',
        }),
        expect.objectContaining({
          id: 'storefront:(home)/page.ts',
          routePattern: '/',
          decision: 'edge_release',
        }),
        expect.objectContaining({
          id: 'storefront:(customer)/account/callback/route.ts:slug-prefixed',
          routePattern: '/{storefrontIdentifier}/account/callback',
        }),
      ])
    );
    expect(rows.length).toBeGreaterThan(78);
    const indexOf = (pattern: string) =>
      rows.findIndex((row) => row.routePattern === pattern);
    expect(indexOf('/blog/news-sitemap.xml')).toBeLessThan(
      indexOf('/blog/{postSlug}')
    );
    expect(indexOf('/blog/{postSlug}')).toBeLessThan(
      indexOf('/blog/{*catchAll}')
    );
    expect(
      rows.find(
        ({ id }) => id === 'storefront:news-sitemap.xml/route.ts:options'
      )
    ).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        methods: ['OPTIONS'],
        reason: 'automatic_options_response',
      })
    );
    expect(
      rows.find(
        ({ id }) =>
          id ===
          'storefront:(customer)/account/callback/route.ts:options:slug-prefixed'
      )
    ).toEqual(
      expect.objectContaining({
        methods: ['OPTIONS'],
        routePattern: '/{storefrontIdentifier}/account/callback',
      })
    );
    expect(
      rows.find(({ id }) => id === 'storefront:(blog)/blog/sitemap.ts:options')
    ).toEqual(expect.objectContaining({ methods: ['OPTIONS'] }));
    expect(
      rows.find(({ id }) => id === 'storefront:opengraph-image.tsx:options')
    ).toEqual(expect.objectContaining({ methods: ['OPTIONS'] }));
    expect(
      rows.find(
        ({ id }) =>
          id === 'storefront:(customer)/account/callback/route.ts:options'
      )
    ).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        methods: ['OPTIONS'],
        reason: 'automatic_options_response',
      })
    );
    expect(
      rows.find(
        ({ id }) => id === 'storefront:storefront/[legacySlug]/swap/route.ts'
      )?.decision
    ).toBe('origin_dynamic');
    expect(
      rows
        .filter(({ methods }) => !methods.includes('OPTIONS'))
        .every(({ methods }) => methods.includes('GET'))
    ).toBe(true);
  });

  it('fails closed when a configured redirect entrypoint is missing', () => {
    // Arrange
    const routeSources = [...STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.keys()]
      .filter((path) => path !== 'news-sitemap.xml/route.ts')
      .map(entrypointSource);

    // Act and assert
    expect(() =>
      createStorefrontEdgeEntrypointRows(routeRoot, routeSources)
    ).toThrow(
      'redirect entrypoint no longer exists: news-sitemap.xml/route.ts'
    );
  });

  it('fails closed when a configured redirect entrypoint is not classified as a redirect', () => {
    // Arrange
    const routeSources = [
      ...STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.keys().map(
        entrypointSource
      ),
    ];
    const original = STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.get(
      'news-sitemap.xml/route.ts'
    );
    if (!original) throw new Error('expected redirect classification fixture');
    STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.set(
      'news-sitemap.xml/route.ts',
      { ...original, decision: 'edge_release' }
    );

    // Act and assert
    try {
      expect(() =>
        createStorefrontEdgeEntrypointRows(routeRoot, routeSources)
      ).toThrow(
        'redirect entrypoint has no edge_redirect classification: news-sitemap.xml/route.ts'
      );
    } finally {
      STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.set(
        'news-sitemap.xml/route.ts',
        original
      );
    }
  });

  it('rejects a newly discovered entrypoint without an explicit classification', () => {
    // Arrange
    const routeSources = [
      ...STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.keys().map(
        entrypointSource
      ),
      entrypointSource('(subscriptions)/manage/page.tsx'),
    ];

    // Act and assert
    expect(() =>
      createStorefrontEdgeEntrypointRows(routeRoot, routeSources)
    ).toThrow(
      'storefront entrypoint has no reviewed classification: (subscriptions)/manage/page.tsx'
    );
  });

  it('classifies JavaScript route handlers through their route.ts classification', () => {
    // Arrange
    const routeSources = [
      ...STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.keys()
        .filter((path) => path !== '(blog)/blog/[...catchAll]/route.ts')
        .map(entrypointSource),
      entrypointSource('(blog)/blog/[...catchAll]/route.js'),
    ];

    // Act
    const rows = createStorefrontEdgeEntrypointRows(routeRoot, routeSources);

    // Assert
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'storefront:(blog)/blog/[...catchAll]/route.js',
          routePattern: '/blog/{*catchAll}',
        }),
        expect.objectContaining({
          id: 'storefront:(blog)/blog/[...catchAll]/route.js:options',
          methods: ['OPTIONS'],
          reason: 'automatic_options_response',
        }),
      ])
    );
  });

  it('classifies route.tsx handlers through their route.ts classification', () => {
    // Arrange
    const routeSources = [
      ...STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.keys()
        .filter((path) => path !== '(blog)/blog/[...catchAll]/route.ts')
        .map(entrypointSource),
      entrypointSource('(blog)/blog/[...catchAll]/route.tsx'),
    ];

    // Act
    const rows = createStorefrontEdgeEntrypointRows(routeRoot, routeSources);

    // Assert
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'storefront:(blog)/blog/[...catchAll]/route.tsx',
          routePattern: '/blog/{*catchAll}',
        }),
        expect.objectContaining({
          id: 'storefront:(blog)/blog/[...catchAll]/route.tsx:options',
          methods: ['OPTIONS'],
          reason: 'automatic_options_response',
        }),
      ])
    );
  });

  it('fails closed for an unclassified static metadata route', () => {
    // Arrange
    const routeSources = [
      ...STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.keys().map(
        entrypointSource
      ),
      entrypointSource('icon.png'),
    ];

    // Act and assert
    expect(() =>
      createStorefrontEdgeEntrypointRows(routeRoot, routeSources)
    ).toThrow('storefront entrypoint has no reviewed classification: icon.png');
  });
});
