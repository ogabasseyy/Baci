import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_SUPABASE_SUBRESOURCE_ROWS } from './storefront-edge-supabase-subresource-rows';

describe('STOREFRONT_EDGE_SUPABASE_SUBRESOURCE_ROWS', () => {
  it('binds current storefront browser queries to the configured Supabase origin', () => {
    // Arrange and act
    const byId = new Map(
      STOREFRONT_EDGE_SUPABASE_SUBRESOURCE_ROWS.map((row) => [row.id, row])
    );

    // Assert
    expect(byId.get('automatic-subresource:supabase-page-configs')).toEqual(
      expect.objectContaining({
        destinationCondition: {
          hostKind: 'configured_supabase_origin',
          precedence: 'before_path_decision',
        },
        methods: ['GET', 'OPTIONS'],
        routePattern: '/rest/v1/page_configs',
        sourcePath: 'apps/web/src/components/storefront/puck-storefront.tsx',
      })
    );
    expect(
      byId.get('automatic-subresource:supabase-match-blog-to-product')
    ).toEqual(
      expect.objectContaining({
        methods: ['POST', 'OPTIONS'],
        routePattern: '/rest/v1/rpc/match_blog_to_product',
        sourcePath:
          'apps/web/src/components/storefront/ogabassey/components/BlogSnippet.tsx',
      })
    );
    expect(byId.get('automatic-subresource:supabase-cart-products')).toEqual(
      expect.objectContaining({
        methods: ['GET', 'OPTIONS'],
        routePattern: '/rest/v1/products',
        sourcePath:
          'apps/web/src/components/storefront/ogabassey/pages/cart-page-wrapper.tsx',
      })
    );
    expect(byId.get('automatic-subresource:supabase-auth-signup')).toEqual(
      expect.objectContaining({
        methods: ['POST', 'OPTIONS'],
        routePattern: '/auth/v1/signup',
      })
    );
    expect(
      byId.get('automatic-subresource:supabase-auth-password-token')
    ).toEqual(
      expect.objectContaining({
        methods: ['POST', 'OPTIONS'],
        routePattern: '/auth/v1/token',
      })
    );
  });
});
