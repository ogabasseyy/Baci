import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { STOREFRONT_EDGE_NEXT_REDIRECT_ROWS } from './storefront-edge-next-redirect-rows';
import { STOREFRONT_EDGE_PROXY_BLOG_QUERY_ROWS } from './storefront-edge-proxy-blog-query-rows';
import { STOREFRONT_EDGE_PROXY_BLOG_STATUS_ROWS } from './storefront-edge-proxy-blog-status-rows';
import { createStorefrontEdgeProxyClass } from './storefront-edge-proxy-class';
import { STOREFRONT_EDGE_PROXY_REWRITE_ROWS } from './storefront-edge-proxy-rewrite-rows';
import { STOREFRONT_EDGE_PROXY_TAIL_ROWS } from './storefront-edge-proxy-tail-rows';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

const proxyClass = createStorefrontEdgeProxyClass;

/** Closed directional classes mirrored from the current storefront proxy. */
export const STOREFRONT_EDGE_PROXY_ROWS: readonly InventoryRow[] = [
  ...STOREFRONT_EDGE_NEXT_REDIRECT_ROWS,
  ...STOREFRONT_EDGE_PROXY_REWRITE_ROWS,
  proxyClass(
    'proxy:no-trailing-slash',
    '/{*document}/',
    ['ANY'],
    'edge_redirect',
    'trailing_slash_canonicalization',
    {
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'trailing_slash_excluding_well_known',
      },
    }
  ),
  proxyClass(
    'proxy:blog-wordpress-probe',
    '/{*blogProbePath}',
    ['ANY'],
    'edge_terminal',
    'legacy_blog_wordpress_probe_returns_410',
    {
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'legacy_blog_wordpress_probe',
      },
    }
  ),
  proxyClass(
    'proxy:blog-spam-prefix',
    '/blog/{*spamPath}',
    ['ANY'],
    'edge_terminal',
    'legacy_blog_spam_prefix_returns_410',
    {
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'legacy_blog_spam_prefix',
      },
    }
  ),
  ...STOREFRONT_EDGE_PROXY_BLOG_QUERY_ROWS,
  proxyClass(
    'proxy:blog-category-canonical',
    '/blog/{legacyCategory}/{legacyPostSlug}',
    ['ANY'],
    'edge_redirect',
    'legacy_blog_category_permalink_redirect',
    {
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'legacy_blog_category_permalink',
      },
    }
  ),
  ...STOREFRONT_EDGE_PROXY_BLOG_STATUS_ROWS,
  proxyClass(
    'proxy:cache-safe-punctuation',
    '/{*importedPunctuationPath}',
    ['ANY'],
    'edge_redirect',
    'cache_safe_storefront_path_normalization',
    {
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'cache_safe_imported_punctuation',
      },
    }
  ),
  proxyClass(
    'proxy:legacy-analytics-conversion',
    '/analytics/conversion',
    ['POST'],
    'origin_dynamic',
    'legacy_api_rewrite_preserves_mutation',
    {
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'legacy_analytics_conversion',
      },
    }
  ),
  proxyClass(
    'proxy:legacy-klump-webhook',
    '/wc-api/klp_wc_payment_webhook',
    ['ANY'],
    'edge_terminal',
    'retired_webhook_returns_410',
    {
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'legacy_klump_webhook_normalized',
      },
    }
  ),
  proxyClass(
    'proxy:legacy-terms-alias-custom-domain',
    '/terms-and-conditions',
    ['GET', 'HEAD'],
    'edge_redirect',
    'canonical_terms_alias',
    {
      hostCondition: {
        hostKind: 'custom_domain',
        precedence: 'before_path_decision',
      },
    }
  ),
  proxyClass(
    'proxy:legacy-terms-alias-platform-subdomain',
    '/terms-and-conditions',
    ['GET', 'HEAD'],
    'edge_redirect',
    'canonical_terms_alias',
    {
      hostCondition: {
        hostKind: 'platform_subdomain',
        precedence: 'before_path_decision',
      },
    }
  ),
  proxyClass(
    'proxy:legacy-terms-of-service-custom-domain',
    '/terms-of-service',
    ['GET', 'HEAD'],
    'edge_redirect',
    'canonical_terms_alias',
    {
      hostCondition: {
        hostKind: 'custom_domain',
        precedence: 'before_path_decision',
      },
    }
  ),
  proxyClass(
    'proxy:legacy-terms-of-service-platform-subdomain',
    '/terms-of-service',
    ['GET', 'HEAD'],
    'edge_redirect',
    'canonical_terms_alias',
    {
      hostCondition: {
        hostKind: 'platform_subdomain',
        precedence: 'before_path_decision',
      },
    }
  ),
  proxyClass(
    'proxy:lowercase-document',
    '/{*mixedCaseDocument}',
    ['ANY'],
    'edge_redirect',
    'lowercase_storefront_canonicalization',
    {
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'mixed_case_path',
      },
    }
  ),
  proxyClass(
    'proxy:product-canonical',
    '/{category}/{productSlug}?{noncanonicalVariant}',
    ['GET', 'HEAD'],
    'edge_redirect',
    'canonical_product_route_or_variant',
    {
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'noncanonical_product_route_or_variant',
      },
    }
  ),
  proxyClass(
    'proxy:product-hard-missing',
    '/{category}/{productSlug}',
    ['GET', 'HEAD'],
    'edge_terminal',
    'missing_product_hard_404',
    {
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'missing_product_hard_404',
      },
    }
  ),
  proxyClass(
    'proxy:compare-hub-hard-missing',
    '/{category}/compare',
    ['GET', 'HEAD'],
    'edge_terminal',
    'empty_compare_hub_hard_404',
    {
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'empty_compare_hub_hard_404',
      },
    }
  ),
  proxyClass(
    'proxy:redundant-slug-prefix',
    '/{currentSlug}/{*path?}',
    ['GET', 'HEAD'],
    'edge_redirect',
    'custom_domain_slug_prefix_canonicalization',
    {
      hostCondition: {
        hostKind: 'custom_domain',
        precedence: 'before_path_decision',
      },
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'redundant_storefront_slug_prefix',
      },
    }
  ),
  proxyClass(
    'proxy:current-slug-api',
    '/{currentSlug}/api/{*path?}',
    ['DELETE', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
    'origin_dynamic',
    'current_slug_api_rewrite_preserves_body',
    {
      hostCondition: {
        hostKind: 'custom_domain',
        precedence: 'before_path_decision',
      },
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'current_storefront_slug_api',
      },
    }
  ),
  proxyClass(
    'proxy:retired-slug-api',
    '/{retiredSlug}/api/{*path?}',
    ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
    'origin_dynamic',
    'alias_aware_api_rewrite_preserves_body',
    {
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'retired_storefront_slug_prefix',
      },
    }
  ),
  proxyClass(
    'proxy:retired-slug-document',
    '/{retiredSlug}/{*path?}',
    ['GET', 'HEAD'],
    'edge_redirect',
    'retired_storefront_alias_redirect',
    {
      hostCondition: {
        hostKind: 'custom_domain',
        precedence: 'before_path_decision',
      },
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'retired_storefront_slug_prefix',
      },
    }
  ),
  ...STOREFRONT_EDGE_PROXY_TAIL_ROWS,
];
