import { describe, expect, it } from 'vitest';
import { canonicalizeDiscoveryProductType } from './canonical-discovery-product-type';

describe('canonicalizeDiscoveryProductType', () => {
  it.each([
    ['Smartphones', 'phone'],
    ['smartphone', 'phone'],
    ['Phones', 'phone'],
    ['Laptops', 'laptop'],
    ['Tablets', 'tablet'],
    ['Security Camera', 'security_camera'],
  ])('canonicalizes %s to %s', (input, expected) => {
    expect(canonicalizeDiscoveryProductType(input)).toBe(expected);
  });
});
