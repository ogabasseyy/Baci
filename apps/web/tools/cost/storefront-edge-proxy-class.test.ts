import { describe, expect, it } from 'vitest';
import { createStorefrontEdgeProxyClass } from './storefront-edge-proxy-class';

describe('createStorefrontEdgeProxyClass', () => {
  it('omits optional fields that were not supplied', () => {
    // Arrange, Act
    const row = createStorefrontEdgeProxyClass(
      'proxy:test',
      '/test',
      ['GET'],
      'edge_release',
      'test_reason'
    );

    // Assert
    expect(row).toEqual({
      decision: 'edge_release',
      id: 'proxy:test',
      methods: ['GET'],
      reason: 'test_reason',
      routePattern: '/test',
      sourceKind: 'proxy_path_class',
    });
  });
});
