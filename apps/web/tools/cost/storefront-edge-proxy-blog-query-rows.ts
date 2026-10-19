import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { createStorefrontEdgeProxyClass } from './storefront-edge-proxy-class';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

/** Blog query canonicalization classes, including slug-prefixed storefronts. */
export const STOREFRONT_EDGE_PROXY_BLOG_QUERY_ROWS: readonly InventoryRow[] = [
  createStorefrontEdgeProxyClass(
    'proxy:blog-query-canonical',
    '/blog/{*path?}?{legacyThumbnailQuery}',
    ['GET', 'HEAD'],
    'edge_redirect',
    'canonical_blog_query_normalization',
    {
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'legacy_blog_thumbnail_query',
      },
    }
  ),
  createStorefrontEdgeProxyClass(
    'proxy:slug-blog-query-canonical',
    '/{storefrontIdentifier}/blog/{*path?}?{legacyThumbnailQuery}',
    ['GET', 'HEAD'],
    'edge_redirect',
    'canonical_blog_query_normalization',
    {
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'legacy_blog_thumbnail_query',
      },
    }
  ),
];
