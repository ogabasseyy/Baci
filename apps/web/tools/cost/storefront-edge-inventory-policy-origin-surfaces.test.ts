import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_INVENTORY_POLICY } from './storefront-edge-inventory-policy';

describe('STOREFRONT_EDGE_INVENTORY_POLICY origin surfaces', () => {
  it('keeps storefront actions, query variants, ads, and auth on the origin', () => {
    // Arrange
    const rows = STOREFRONT_EDGE_INVENTORY_POLICY.extraRows;
    const byId = new Map(rows.map((row) => [row.id, row]));
    const queryRows = rows.filter((row) =>
      row.id.startsWith('request-override:query-dependent')
    );

    // Act and assert
    expect(byId.get('server-action:repair-booking')).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        methods: ['POST'],
        routePattern: '/repair',
        sourcePath: 'apps/web/src/app/actions/repair.ts',
      })
    );
    expect(
      byId.get('server-action:blog-post-view-count-slug-prefixed')
    ).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        methods: ['POST'],
        routePattern: '/{storefrontIdentifier}/blog/{postSlug}',
      })
    );
    expect(
      rows
        .filter((row) =>
          row.id.startsWith('request-override:blog-post-accept-language')
        )
        .map((row) => row.routePattern)
    ).toEqual(['/blog/{postSlug}', '/{storefrontIdentifier}/blog/{postSlug}']);
    expect(queryRows.map((row) => row.routePattern)).toEqual(
      expect.arrayContaining([
        '/blog',
        '/blog/author/{authorSlug}',
        '/blog/category/{categorySlug}',
        '/compare',
        '/{category}',
        '/{category}/compare',
        '/products',
        '/products/{productSlug}',
        '/{category}/{productSlug}',
      ])
    );
    expect(queryRows).toHaveLength(18);
    expect(
      queryRows.find(
        (row) => row.id === 'request-override:query-dependent-blog-root'
      )?.requestCondition?.anyQueryKeyPresent
    ).toContain('category');
    expect(byId.get('request-override:storefront-auth-session')).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        requestCondition: expect.objectContaining({
          anyOf: expect.arrayContaining([
            { cookiePredicate: 'supabase_auth_session_hint' },
            { anyHeaderMatch: [{ name: 'authorization' }] },
            { anyHeaderMatch: [{ name: 'x-supabase-auth-token' }] },
          ]),
          matchedStorefrontEntrypointDecision: 'edge_release',
          precedence: 'after_entrypoint_resolution_before_decision',
        }),
      })
    );
    const productQueryRows = queryRows.filter(({ id }) =>
      id.includes('product-category')
    );
    const listingQueryRows = queryRows.filter(
      ({ id }) =>
        !id.includes('product-category') &&
        id !== 'request-override:query-dependent-compare-root' &&
        id !== 'request-override:query-dependent-compare-root-slug-prefixed' &&
        id !== 'request-override:query-dependent-category-compare' &&
        id !== 'request-override:query-dependent-category-compare-slug-prefixed'
    );
    expect(productQueryRows).toHaveLength(4);
    expect(
      productQueryRows.every(
        (row) =>
          row.decision === 'origin_dynamic' &&
          row.requestCondition?.anyQueryPresent === true &&
          row.requestCondition.anyQueryKeyPresent === undefined &&
          row.requestCondition.matchedStorefrontEntrypointId?.startsWith(
            `storefront:${row.sourcePath?.replace(
              'apps/web/src/app/(storefront)/[slug]/',
              ''
            )}`
          ) &&
          row.requestCondition.precedence ===
            'after_entrypoint_resolution_before_decision'
      )
    ).toBe(true);
    expect(
      listingQueryRows.every(
        (row) =>
          row.decision === 'origin_dynamic' &&
          row.requestCondition?.anyQueryKeyPresent?.includes('page') &&
          row.requestCondition.matchedStorefrontEntrypointId ===
            `storefront:${row.sourcePath?.replace(
              'apps/web/src/app/(storefront)/[slug]/',
              ''
            )}${row.id.endsWith('-slug-prefixed') ? ':slug-prefixed' : ''}` &&
          row.requestCondition.precedence ===
            'after_entrypoint_resolution_before_decision'
      )
    ).toBe(true);
    expect(byId.get('request-override:query-dependent-compare-root')).toEqual(
      expect.objectContaining({
        requestCondition: expect.objectContaining({
          anyQueryPresent: true,
          anyQueryPresentExcept: ['__baci_metadata_cache_bucket'],
        }),
      })
    );
    expect(byId.get('machine:ads')).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        methods: ['GET', 'HEAD', 'OPTIONS'],
        routePattern: '/ads.txt',
        sourcePath: 'apps/web/src/app/ads.txt/route.ts',
      })
    );
    expect(byId.get('proxy:auth-confirm')).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        methods: ['GET', 'HEAD', 'OPTIONS'],
        routePattern: '/auth/confirm',
        sourcePath: 'apps/web/src/app/auth/confirm/route.ts',
      })
    );
    expect(STOREFRONT_EDGE_INVENTORY_POLICY.routingInputPaths).toEqual(
      expect.arrayContaining([
        'apps/web/src/app/actions/repair.ts',
        'apps/web/src/components/storefront/RepairBookingWizard.tsx',
        'apps/web/src/app/ads.txt/route.ts',
        'apps/web/src/app/auth/confirm/route.ts',
        'apps/web/src/lib/storefront-internal-preflight.ts',
        'apps/web/src/lib/storefront-preflight-rpc.ts',
        'apps/web/src/lib/storefront-slug-safety.ts',
        'apps/web/next.config.ts',
      ])
    );
    expect(STOREFRONT_EDGE_INVENTORY_POLICY.routingInputPaths).not.toContain(
      'next.config.ts'
    );
  });
});
