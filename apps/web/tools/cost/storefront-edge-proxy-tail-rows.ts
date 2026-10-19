import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { createStorefrontEdgeProxyClass } from './storefront-edge-proxy-class';
import { STOREFRONT_EDGE_PROXY_HOST_ROWS } from './storefront-edge-proxy-host-rows';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

const sitemapOptions = (
  id: string,
  routePattern: string,
  options: Parameters<typeof createStorefrontEdgeProxyClass>[5]
): InventoryRow =>
  createStorefrontEdgeProxyClass(
    id,
    routePattern,
    ['OPTIONS'],
    'origin_dynamic',
    'automatic_options_response',
    options
  );

/** Terminal and host-conditioned proxy classes after explicit rewrites. */
export const STOREFRONT_EDGE_PROXY_TAIL_ROWS: readonly InventoryRow[] = [
  ...STOREFRONT_EDGE_PROXY_HOST_ROWS,
  createStorefrontEdgeProxyClass(
    'proxy:platform-root-blog-sitemap',
    '/blog/sitemap.xml',
    ['GET', 'HEAD'],
    'origin_dynamic',
    'platform_root_blog_sitemap_rewrite',
    {
      hostCondition: {
        hostKind: 'platform_root_domain',
        precedence: 'before_path_decision',
      },
      sourcePath: 'apps/web/next.config.ts',
    }
  ),
  sitemapOptions(
    'proxy:platform-root-blog-sitemap-options',
    '/blog/sitemap.xml',
    {
      hostCondition: {
        hostKind: 'platform_root_domain',
        precedence: 'before_path_decision',
      },
      sourcePath: 'apps/web/next.config.ts',
    }
  ),
  createStorefrontEdgeProxyClass(
    'proxy:platform-root-slug-sitemap',
    '/{storefrontIdentifier}/sitemap.xml',
    ['GET', 'HEAD'],
    'edge_release',
    'storefront_root_sitemap_rewrite',
    {
      hostCondition: {
        hostKind: 'platform_root_domain',
        precedence: 'before_path_decision',
      },
      sourcePath: 'apps/web/src/app/sitemap.ts',
    }
  ),
  sitemapOptions(
    'proxy:platform-root-slug-sitemap-options',
    '/{storefrontIdentifier}/sitemap.xml',
    {
      hostCondition: {
        hostKind: 'platform_root_domain',
        precedence: 'before_path_decision',
      },
      sourcePath: 'apps/web/src/app/sitemap.ts',
    }
  ),
  createStorefrontEdgeProxyClass(
    'proxy:root-sitemap',
    '/sitemap.xml',
    ['GET', 'HEAD'],
    'origin_dynamic',
    'storefront_root_sitemap_requires_origin',
    {
      hostCondition: {
        hostKind: 'custom_domain',
        precedence: 'before_path_decision',
      },
      sourcePath: 'apps/web/src/app/sitemap.ts',
    }
  ),
  sitemapOptions('proxy:root-sitemap-options', '/sitemap.xml', {
    hostCondition: {
      hostKind: 'custom_domain',
      precedence: 'before_path_decision',
    },
    sourcePath: 'apps/web/src/app/sitemap.ts',
  }),
  createStorefrontEdgeProxyClass(
    'proxy:subdomain-sitemap',
    '/sitemap.xml',
    ['GET', 'HEAD'],
    'origin_dynamic',
    'storefront_root_sitemap_requires_origin',
    {
      hostCondition: {
        hostKind: 'platform_subdomain',
        precedence: 'before_path_decision',
      },
      sourcePath: 'apps/web/src/app/sitemap.ts',
    }
  ),
  sitemapOptions('proxy:subdomain-sitemap-options', '/sitemap.xml', {
    hostCondition: {
      hostKind: 'platform_subdomain',
      precedence: 'before_path_decision',
    },
    sourcePath: 'apps/web/src/app/sitemap.ts',
  }),
  createStorefrontEdgeProxyClass(
    'proxy:platform-root-sitemap',
    '/sitemap.xml',
    ['GET', 'HEAD'],
    'origin_dynamic',
    'platform_root_sitemap_dynamic',
    {
      hostCondition: {
        hostKind: 'platform_root_domain',
        precedence: 'before_path_decision',
      },
      sourcePath: 'apps/web/src/app/sitemap.ts',
    }
  ),
  sitemapOptions('proxy:platform-root-sitemap-options', '/sitemap.xml', {
    hostCondition: {
      hostKind: 'platform_root_domain',
      precedence: 'before_path_decision',
    },
    sourcePath: 'apps/web/src/app/sitemap.ts',
  }),
  createStorefrontEdgeProxyClass(
    'proxy:mcp-sse-rewrite',
    '/mcp/sse',
    ['ANY'],
    'origin_dynamic',
    'mcp_server_rewrite',
    { sourcePath: 'apps/web/next.config.ts' }
  ),
  createStorefrontEdgeProxyClass(
    'proxy:mcp-messages-rewrite',
    '/mcp/messages',
    ['ANY'],
    'origin_dynamic',
    'mcp_server_rewrite',
    { sourcePath: 'apps/web/next.config.ts' }
  ),
  createStorefrontEdgeProxyClass(
    'proxy:unknown-document',
    '/{*unlistedDocument}',
    ['GET', 'HEAD'],
    'edge_terminal',
    'closed_storefront_document_inventory_default'
  ),
  createStorefrontEdgeProxyClass(
    'proxy:unsafe-document',
    '/{*unsafeDocument}',
    ['GET', 'HEAD'],
    'edge_terminal',
    'unsafe_or_ambiguous_storefront_path',
    {
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'unsafe_or_ambiguous_path',
      },
    }
  ),
  createStorefrontEdgeProxyClass(
    'proxy:unsupported-method',
    '/{*path?}',
    ['ANY'],
    'edge_terminal',
    'closed_method_inventory_default'
  ),
];
