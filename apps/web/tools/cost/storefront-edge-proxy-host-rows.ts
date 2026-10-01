import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { createStorefrontEdgeProxyClass } from './storefront-edge-proxy-class';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

const proxyClass = createStorefrontEdgeProxyClass;

/** Host-conditioned proxy classes that must precede storefront resolution. */
export const STOREFRONT_EDGE_PROXY_HOST_ROWS: readonly InventoryRow[] = [
  proxyClass(
    'proxy:legacy-blog-host',
    '/{*path?}',
    ['ANY'],
    'edge_redirect',
    'legacy_blog_hostname_redirect',
    {
      hostCondition: {
        hostKind: 'custom_domain',
        hostnameIn: ['blog.ogabassey.com'],
        precedence: 'before_path_decision',
      },
    }
  ),
  proxyClass(
    'proxy:platform-admin',
    '/admin/{*path?}',
    ['ANY'],
    'origin_dynamic',
    'platform_subdomain_admin_requires_auth',
    {
      hostCondition: {
        hostKind: 'platform_subdomain',
        precedence: 'before_path_decision',
      },
      pathCondition: {
        firstSegmentIn: ['admin'],
        precedence: 'before_path_decision',
        predicate: 'first_segment_allowlist',
      },
    }
  ),
  proxyClass(
    'proxy:platform-route-subdomain',
    '/{platformRoutePrefix}/{*path?}',
    ['ANY'],
    'edge_redirect',
    'platform_route_subdomain_redirect',
    {
      hostCondition: {
        hostKind: 'platform_subdomain',
        precedence: 'before_path_decision',
      },
      pathCondition: {
        firstSegmentIn: [
          'auth',
          'baci-relay',
          'builder',
          'dashboard',
          'forgot-password',
          'login',
          'onboarding',
          'reset-password',
          'signup',
          'staff',
          'update-password',
          'verify',
        ],
        precedence: 'before_path_decision',
        predicate: 'first_segment_allowlist',
      },
    }
  ),
  proxyClass(
    'proxy:platform-route-root',
    '/{platformRoutePrefix}/{*path?}',
    ['ANY'],
    'origin_dynamic',
    'platform_root_application_route_preserved',
    {
      hostCondition: {
        hostKind: 'platform_root_domain',
        precedence: 'before_path_decision',
      },
      pathCondition: {
        firstSegmentIn: [
          'admin',
          'auth',
          'builder',
          'dashboard',
          'forgot-password',
          'login',
          'onboarding',
          'reset-password',
          'signup',
          'staff',
          'update-password',
          'verify',
        ],
        precedence: 'before_path_decision',
        predicate: 'first_segment_allowlist',
      },
    }
  ),
  proxyClass(
    'proxy:retired-host-platform-route',
    '/{platformRoutePrefix}/{*path?}',
    ['ANY'],
    'edge_redirect',
    'retired_subdomain_platform_route_redirect',
    {
      hostCondition: {
        hostKind: 'retired_platform_subdomain_alias',
        precedence: 'before_path_decision',
      },
      pathCondition: {
        firstSegmentIn: [
          'auth',
          'baci-relay',
          'builder',
          'dashboard',
          'forgot-password',
          'login',
          'onboarding',
          'reset-password',
          'signup',
          'staff',
          'update-password',
          'verify',
        ],
        precedence: 'before_path_decision',
        predicate: 'first_segment_allowlist',
      },
    }
  ),
  proxyClass(
    'proxy:retired-slug-host',
    '/{*storefrontPath?}',
    ['GET', 'HEAD'],
    'edge_redirect',
    'retired_storefront_alias_redirect',
    {
      hostCondition: {
        hostKind: 'retired_platform_subdomain_alias',
        precedence: 'before_path_decision',
      },
      pathCondition: {
        firstSegmentNotIn: ['api'],
        precedence: 'before_path_decision',
        predicate: 'retired_alias_storefront_path',
      },
    }
  ),
  proxyClass(
    'proxy:custom-domain-platform-route',
    '/{platformRoutePrefix}/{*path?}',
    ['ANY'],
    'origin_dynamic',
    'custom_domain_platform_route_preserved',
    {
      hostCondition: {
        hostKind: 'custom_domain',
        precedence: 'before_path_decision',
      },
      pathCondition: {
        firstSegmentIn: [
          'admin',
          'builder',
          'dashboard',
          'login',
          'reset-password',
        ],
        precedence: 'before_path_decision',
        predicate: 'first_segment_allowlist',
      },
    }
  ),
  proxyClass(
    'proxy:subdomain-custom-domain',
    '/{*storefrontPath?}',
    ['GET', 'HEAD'],
    'edge_redirect',
    'canonical_custom_domain_redirect',
    {
      hostCondition: {
        hostKind: 'platform_subdomain',
        precedence: 'before_path_decision',
        requiresActiveCanonicalCustomDomain: true,
      },
      pathCondition: {
        firstSegmentNotIn: ['api'],
        precedence: 'before_path_decision',
        predicate: 'canonical_custom_domain_redirect_non_api',
      },
    }
  ),
  proxyClass(
    'proxy:root-domain-current-slug',
    '/{currentSlug}/{*path?}',
    ['ANY'],
    'edge_redirect',
    'current_storefront_custom_domain_redirect',
    {
      hostCondition: {
        hostKind: 'platform_root_domain',
        precedence: 'before_path_decision',
        requiresActiveCanonicalCustomDomain: true,
      },
      pathCondition: {
        precedence: 'before_path_decision',
        predicate: 'current_storefront_custom_domain_redirect',
      },
    }
  ),
  proxyClass(
    'proxy:root-domain-retired-slug',
    '/{retiredSlug}/{*path?}',
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
];
