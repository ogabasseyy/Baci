import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

const STOREFRONT_ROUTE_SOURCE_PREFIX = 'apps/web/src/app/(storefront)/[slug]/';

const QUERY_DEPENDENT_ENTRYPOINTS = [
  {
    id: 'blog-root',
    routePattern: '/blog',
    sourcePath: 'apps/web/src/app/(storefront)/[slug]/(blog)/blog/page.tsx',
  },
  {
    id: 'blog-author',
    routePattern: '/blog/author/{authorSlug}',
    sourcePath:
      'apps/web/src/app/(storefront)/[slug]/(blog)/blog/author/[authorSlug]/page.tsx',
  },
  {
    id: 'blog-category',
    routePattern: '/blog/category/{categorySlug}',
    sourcePath:
      'apps/web/src/app/(storefront)/[slug]/(blog)/blog/category/[categorySlug]/page.tsx',
  },
  {
    id: 'compare-root',
    routePattern: '/compare',
    sourcePath:
      'apps/web/src/app/(storefront)/[slug]/(catalog)/(listing)/compare/page.tsx',
  },
  {
    id: 'category-root',
    routePattern: '/{category}',
    sourcePath:
      'apps/web/src/app/(storefront)/[slug]/(catalog)/(listing)/[category]/page.tsx',
  },
  {
    id: 'category-compare',
    routePattern: '/{category}/compare',
    sourcePath:
      'apps/web/src/app/(storefront)/[slug]/(catalog)/(listing)/[category]/compare/page.tsx',
  },
  {
    id: 'products-root',
    routePattern: '/products',
    sourcePath:
      'apps/web/src/app/(storefront)/[slug]/(catalog)/(listing)/products/page.tsx',
  },
  {
    id: 'product-categoryless',
    routePattern: '/products/{productSlug}',
    sourcePath:
      'apps/web/src/app/(storefront)/[slug]/(catalog)/(pdp)/products/[productSlug]/page.tsx',
  },
  {
    id: 'product-category',
    routePattern: '/{category}/{productSlug}',
    sourcePath:
      'apps/web/src/app/(storefront)/[slug]/(catalog)/(pdp)/[category]/[productSlug]/page.tsx',
  },
] as const;

const FILTER_QUERY_KEYS = [
  'brand',
  'brands',
  'color',
  'colors',
  'condition',
  'category',
  'displaySize',
  'displayType',
  'maxPrice',
  'minPrice',
  'page',
  'q',
  'query',
  'ram',
  'search',
  'simType',
  'storage',
  'variantId',
  'variant_id',
] as const;

/** Origin-only query variants for reviewed storefront listing and PDP routes. */
export const STOREFRONT_EDGE_QUERY_DEPENDENT_ROWS: readonly InventoryRow[] =
  QUERY_DEPENDENT_ENTRYPOINTS.flatMap(({ id, routePattern, sourcePath }) => {
    if (!sourcePath.startsWith(STOREFRONT_ROUTE_SOURCE_PREFIX))
      throw new Error(
        `query-dependent entrypoint is outside the storefront route root: ${sourcePath}`
      );
    const isCompareHub = id === 'compare-root' || id === 'category-compare';
    const isPdp = id === 'product-categoryless' || id === 'product-category';
    return [false, true].map((slugPrefixed) => ({
      decision: 'origin_dynamic' as const,
      id: `request-override:query-dependent-${id}${slugPrefixed ? '-slug-prefixed' : ''}`,
      methods: ['GET', 'HEAD'] as const,
      reason: 'query_dependent_storefront_render',
      requestCondition: {
        ...(isCompareHub
          ? {
              anyQueryPresent: true as const,
              anyQueryPresentExcept: ['__baci_metadata_cache_bucket'],
            }
          : isPdp
            ? {
                anyQueryPresent: true as const,
                anyQueryPresentExcept: ['__baci_metadata_cache_bucket'],
              }
            : { anyQueryKeyPresent: FILTER_QUERY_KEYS }),
        matchedStorefrontEntrypointId: `storefront:${sourcePath.slice(
          STOREFRONT_ROUTE_SOURCE_PREFIX.length
        )}${slugPrefixed ? ':slug-prefixed' : ''}`,
        precedence: 'after_entrypoint_resolution_before_decision' as const,
      },
      routePattern: slugPrefixed
        ? `/{storefrontIdentifier}${routePattern}`
        : routePattern,
      sourceKind: 'request_override' as const,
      sourcePath,
    }));
  });
