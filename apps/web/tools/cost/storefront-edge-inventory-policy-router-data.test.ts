import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_INVENTORY_POLICY } from './storefront-edge-inventory-policy';

describe('storefront edge router data policy', () => {
  it('keeps App Router data requests for released entrypoints on the origin', () => {
    // Arrange
    const row = STOREFRONT_EDGE_INVENTORY_POLICY.extraRows.find(
      ({ id }) => id === 'request-override:router-data'
    );

    // Act and assert
    expect(row).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        methods: ['GET', 'HEAD'],
        requestCondition: {
          anyHeaderMatch: [
            { name: 'rsc', value: '1' },
            { name: 'next-router-prefetch' },
            { name: 'next-router-state-tree' },
          ],
          matchedStorefrontEntrypointDecision: 'edge_release',
          precedence: 'after_entrypoint_resolution_before_decision',
        },
      })
    );
  });
});
