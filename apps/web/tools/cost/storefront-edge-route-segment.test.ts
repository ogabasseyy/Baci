import { describe, expect, it } from 'vitest';
import { normalizeStorefrontEdgeRouteSegment } from './storefront-edge-route-segment';

describe('normalizeStorefrontEdgeRouteSegment', () => {
  it.each([
    ['[productSlug]', '{productSlug}'],
    ['[...path]', '{*path}'],
    ['[[...path]]', '{*path?}'],
    ['products', 'products'],
  ])('maps %s to %s', (segment, expected) => {
    // Act and assert
    expect(normalizeStorefrontEdgeRouteSegment(segment)).toBe(expected);
  });
});
