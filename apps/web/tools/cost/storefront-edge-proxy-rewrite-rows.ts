import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { createStorefrontEdgeProxyClass } from './storefront-edge-proxy-class';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

const proxyClass = createStorefrontEdgeProxyClass;

/** Proxy rewrites that must run before storefront route classification. */
export const STOREFRONT_EDGE_PROXY_REWRITE_ROWS: readonly InventoryRow[] = [
  proxyClass(
    'proxy:auth-confirm',
    '/auth/confirm',
    ['GET', 'HEAD', 'OPTIONS'],
    'origin_dynamic',
    'custom_domain_auth_confirmation',
    {
      hostCondition: {
        hostKind: 'custom_domain',
        precedence: 'before_path_decision',
      },
      sourcePath: 'apps/web/src/app/auth/confirm/route.ts',
    }
  ),
  proxyClass(
    'proxy:root-domain-retired-slug-markdown',
    '/{retiredSlug}/{*storefrontMarkdownPath}.md',
    ['GET', 'HEAD'],
    'edge_redirect',
    'retired_storefront_alias_redirect',
    {
      hostCondition: {
        hostKind: 'platform_root_domain',
        precedence: 'before_path_decision',
      },
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'retired_storefront_slug_prefix',
      },
    }
  ),
  proxyClass(
    'proxy:markdown-mirror',
    '/{*storefrontMarkdownPath}.md',
    ['GET', 'HEAD', 'OPTIONS'],
    'origin_dynamic',
    'storefront_markdown_api_rewrite'
  ),
  proxyClass(
    'proxy:api-prefix-passthrough',
    '/{*apiPrefixPath?}',
    ['ANY'],
    'origin_dynamic',
    'proxy_api_prefix_passthrough',
    {
      hostCondition: {
        hostKind: 'platform_subdomain',
        precedence: 'before_path_decision',
      },
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'api_prefix_passthrough',
      },
    }
  ),
];
