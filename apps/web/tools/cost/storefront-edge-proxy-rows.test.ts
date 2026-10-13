import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_PROXY_ROWS } from './storefront-edge-proxy-rows';

describe('STOREFRONT_EDGE_PROXY_ROWS', () => {
  it('pins mutation rewrites and retired endpoints to their safe outcomes', () => {
    // Arrange
    const byId = new Map(
      STOREFRONT_EDGE_PROXY_ROWS.map((row) => [row.id, row])
    );

    // Act and assert
    expect(byId.get('proxy:legacy-analytics-conversion')).toEqual(
      expect.objectContaining({ decision: 'origin_dynamic', methods: ['POST'] })
    );
    expect(byId.get('proxy:legacy-klump-webhook')).toEqual(
      expect.objectContaining({ decision: 'edge_terminal', methods: ['ANY'] })
    );
    expect(byId.get('proxy:legacy-terms-alias-custom-domain')?.decision).toBe(
      'edge_redirect'
    );
    expect(
      byId.get('proxy:legacy-terms-alias-custom-domain')?.routePattern
    ).toBe('/terms-and-conditions');
    expect(
      byId.get('proxy:legacy-terms-alias-platform-subdomain')?.hostCondition
        ?.hostKind
    ).toBe('platform_subdomain');
    expect(
      byId.get('proxy:legacy-terms-of-service-custom-domain')?.routePattern
    ).toBe('/terms-of-service');
    expect(byId.get('proxy:root-sitemap')?.decision).toBe('origin_dynamic');
  });

  it('contains explicit unknown-path and unsupported-method terminal classes', () => {
    // Arrange and act
    const terminals = STOREFRONT_EDGE_PROXY_ROWS.filter(
      (row) => row.decision === 'edge_terminal'
    ).map((row) => row.id);

    // Assert
    expect(terminals).toEqual(
      expect.arrayContaining([
        'proxy:unknown-document',
        'proxy:unsafe-document',
        'proxy:unsupported-method',
      ])
    );
  });

  it('preserves Markdown mirrors and custom-domain auth confirmation', () => {
    // Arrange
    const byId = new Map(
      STOREFRONT_EDGE_PROXY_ROWS.map((row) => [row.id, row])
    );

    // Act and assert
    expect(byId.get('proxy:markdown-mirror')).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        methods: ['GET', 'HEAD', 'OPTIONS'],
        routePattern: '/{*storefrontMarkdownPath}.md',
      })
    );
    expect(byId.get('proxy:root-domain-retired-slug-markdown')).toEqual(
      expect.objectContaining({
        decision: 'edge_redirect',
        methods: ['GET', 'HEAD'],
        hostCondition: expect.objectContaining({
          hostKind: 'platform_root_domain',
          precedence: 'before_path_decision',
        }),
      })
    );
    expect(byId.get('proxy:auth-confirm')).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        methods: ['GET', 'HEAD', 'OPTIONS'],
        routePattern: '/auth/confirm',
        hostCondition: {
          hostKind: 'custom_domain',
          precedence: 'before_path_decision',
        },
      })
    );
    expect(byId.get('proxy:legacy-analytics-conversion')).toEqual(
      expect.objectContaining({
        pathCondition: {
          precedence: 'before_path_decision',
          predicate: 'legacy_analytics_conversion',
        },
      })
    );
    expect(byId.get('proxy:current-slug-api')).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        routePattern: '/{currentSlug}/api/{*path?}',
        methods: ['DELETE', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
        hostCondition: {
          hostKind: 'custom_domain',
          precedence: 'before_path_decision',
        },
        pathCondition: {
          precedence: 'before_path_decision',
          predicate: 'current_storefront_slug_api',
        },
      })
    );
    expect(byId.get('proxy:redundant-slug-prefix')).toEqual(
      expect.objectContaining({
        hostCondition: {
          hostKind: 'custom_domain',
          precedence: 'before_path_decision',
        },
      })
    );
    expect(byId.get('proxy:retired-slug-document')?.routePattern).toBe(
      '/{retiredSlug}/{*path?}'
    );
    expect(byId.get('proxy:unsupported-method')?.routePattern).toBe(
      '/{*path?}'
    );
  });

  it('applies the canonical-domain redirect only to eligible platform subdomains', () => {
    // Arrange
    const row = STOREFRONT_EDGE_PROXY_ROWS.find(
      ({ id }) => id === 'proxy:subdomain-custom-domain'
    );

    // Act and assert
    expect(row).toEqual(
      expect.objectContaining({
        hostCondition: {
          hostKind: 'platform_subdomain',
          requiresActiveCanonicalCustomDomain: true,
          precedence: 'before_path_decision',
        },
      })
    );
  });

  it('binds ambiguous canonicalization catch-alls to explicit path predicates', () => {
    // Arrange
    const expectedPredicates = {
      'proxy:blog-query-canonical': 'legacy_blog_thumbnail_query',
      'proxy:slug-blog-query-canonical': 'legacy_blog_thumbnail_query',
      'proxy:blog-category-canonical': 'legacy_blog_category_permalink',
      'proxy:blog-wordpress-probe': 'legacy_blog_wordpress_probe',
      'proxy:blog-spam-prefix': 'legacy_blog_spam_prefix',
      'proxy:blog-post-status-redirect': 'blog_post_status_redirect',
      'proxy:blog-post-status-missing': 'blog_post_status_missing',
      'proxy:blog-listing-status-redirect': 'blog_listing_status_redirect',
      'proxy:blog-listing-status-missing': 'blog_listing_status_missing',
      'proxy:cache-safe-punctuation': 'cache_safe_imported_punctuation',
      'proxy:lowercase-document': 'mixed_case_path',
      'proxy:no-trailing-slash': 'trailing_slash_excluding_well_known',
      'proxy:product-canonical': 'noncanonical_product_route_or_variant',
      'proxy:redundant-slug-prefix': 'redundant_storefront_slug_prefix',
      'proxy:current-slug-api': 'current_storefront_slug_api',
      'proxy:legacy-analytics-conversion': 'legacy_analytics_conversion',
      'proxy:retired-slug-api': 'retired_storefront_slug_prefix',
      'proxy:retired-slug-document': 'retired_storefront_slug_prefix',
      'proxy:unsafe-document': 'unsafe_or_ambiguous_path',
      'proxy:product-hard-missing': 'missing_product_hard_404',
      'proxy:compare-hub-hard-missing': 'empty_compare_hub_hard_404',
      'proxy:api-prefix-passthrough': 'api_prefix_passthrough',
    } as const;
    const byId = new Map(
      STOREFRONT_EDGE_PROXY_ROWS.map((row) => [row.id, row])
    );

    // Act and assert
    for (const [id, predicate] of Object.entries(expectedPredicates)) {
      expect(byId.get(id)?.pathCondition?.precedence, id).toBe(
        'before_path_decision'
      );
      expect(byId.get(id)?.pathCondition?.predicate, id).toBe(predicate);
    }
  });

  it('redirects the reviewed platform prefixes only on platform subdomains', () => {
    // Arrange
    const row = STOREFRONT_EDGE_PROXY_ROWS.find(
      ({ id }) => id === 'proxy:platform-route-subdomain'
    );

    // Act and assert
    expect(row).toEqual(
      expect.objectContaining({
        decision: 'edge_redirect',
        methods: ['ANY'],
        hostCondition: {
          hostKind: 'platform_subdomain',
          precedence: 'before_path_decision',
        },
        pathCondition: expect.objectContaining({
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
        }),
      })
    );
  });

  it('redirects retired subdomain aliases before storefront path decisions', () => {
    // Arrange
    const row = STOREFRONT_EDGE_PROXY_ROWS.find(
      ({ id }) => id === 'proxy:retired-slug-host'
    );

    // Act and assert
    expect(row).toEqual(
      expect.objectContaining({
        decision: 'edge_redirect',
        hostCondition: {
          hostKind: 'retired_platform_subdomain_alias',
          precedence: 'before_path_decision',
        },
        pathCondition: expect.objectContaining({
          precedence: 'before_path_decision',
          predicate: 'retired_alias_storefront_path',
        }),
        routePattern: '/{*storefrontPath?}',
      })
    );
  });

  it('keeps protected platform prefixes dynamic on registered custom domains', () => {
    // Arrange
    const row = STOREFRONT_EDGE_PROXY_ROWS.find(
      ({ id }) => id === 'proxy:custom-domain-platform-route'
    );

    // Act and assert
    expect(row).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        methods: ['ANY'],
        hostCondition: {
          hostKind: 'custom_domain',
          precedence: 'before_path_decision',
        },
      })
    );
  });

  it('models trailing-slash redirects for every method the proxy preserves', () => {
    // Arrange
    const row = STOREFRONT_EDGE_PROXY_ROWS.find(
      ({ id }) => id === 'proxy:no-trailing-slash'
    );

    // Act and assert
    expect(row?.methods).toEqual(['ANY']);
  });
});
