import { describe, expect, it } from 'vitest';
import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

describe('StorefrontEdgeInventory row conditions', () => {
  it('accepts destination-aware automatic subresources', () => {
    // Arrange
    const row = {
      decision: 'origin_dynamic',
      destinationCondition: {
        hostKind: 'configured_supabase_origin',
        precedence: 'before_path_decision',
      },
      id: 'automatic-subresource:supabase-page-configs',
      methods: ['GET'],
      reason: 'browser_supabase_query_requires_external_origin',
      routePattern: '/rest/v1/page_configs',
      sourceKind: 'automatic_subresource',
      sourcePath: 'apps/web/src/components/storefront/puck-storefront.tsx',
    } as const satisfies InventoryRow;

    // Act and assert
    expect(row.destinationCondition.hostKind).toBe(
      'configured_supabase_origin'
    );
  });

  it('accepts reviewed header, entrypoint-decision, and path predicates', () => {
    // Arrange
    const row = {
      decision: 'origin_dynamic',
      id: 'request-override:router-data',
      methods: ['GET'],
      pathCondition: {
        firstSegmentIn: ['login'],
        precedence: 'before_path_decision',
        predicate: 'first_segment_allowlist',
      },
      reason: 'next_router_data_requires_origin',
      requestCondition: {
        anyHeaderMatch: [{ name: 'rsc', value: '1' }],
        matchedStorefrontEntrypointDecision: 'edge_release',
        precedence: 'after_entrypoint_resolution_before_decision',
      },
      routePattern: '/{*storefrontPath?}',
      sourceKind: 'request_override',
    } as const satisfies InventoryRow;

    // Act and assert
    expect(row.requestCondition.anyHeaderMatch[0]).toEqual({
      name: 'rsc',
      value: '1',
    });
  });

  it('rejects unsupported condition values at compile time', () => {
    // Arrange
    const invalidRow: InventoryRow = {
      decision: 'origin_dynamic',
      id: 'invalid:conditions',
      methods: [
        // @ts-expect-error unsupported method tokens must not compile
        'ANYY',
      ],
      pathCondition: {
        precedence: 'before_path_decision',
        // @ts-expect-error unsupported path predicates must not compile
        predicate: 'always_redirect',
      },
      reason: 'invalid_fixture',
      requestCondition: {
        anyHeaderMatch: [
          {
            name: 'rsc',
            // @ts-expect-error header match values must be strings
            value: 1,
          },
        ],
        // @ts-expect-error only reviewed entrypoint decisions are allowed
        matchedStorefrontEntrypointDecision: 'origin_dynamic',
        precedence: 'after_entrypoint_resolution_before_decision',
      },
      routePattern: '/',
      sourceKind: 'request_override',
    };

    // Act and assert
    expect(invalidRow.id).toBe('invalid:conditions');
  });
});
