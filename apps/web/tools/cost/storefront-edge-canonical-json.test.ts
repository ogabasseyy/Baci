import { describe, expect, it } from 'vitest';
import { canonicalizeStorefrontEdgeInventoryValue } from './storefront-edge-canonical-json';

describe('canonicalizeStorefrontEdgeInventoryValue', () => {
  it('sorts object keys recursively and omits undefined properties', () => {
    // Arrange
    const value = {
      z: [{ b: 2, a: 1 }],
      ignored: undefined,
      a: 'first',
    };

    // Act
    const result = canonicalizeStorefrontEdgeInventoryValue(value);

    // Assert
    expect(result).toBe('{"a":"first","z":[{"a":1,"b":2}]}');
  });

  it('uses locale-independent UTF-16 key order', () => {
    // Arrange
    const value = { ä: 1, z: 2 };

    // Act
    const result = canonicalizeStorefrontEdgeInventoryValue(value);

    // Assert
    expect(result).toBe('{"z":2,"ä":1}');
  });

  it('rejects values that JSON cannot serialize', () => {
    // Arrange
    const value = Symbol('not-json-serializable');

    // Act and assert
    expect(() => canonicalizeStorefrontEdgeInventoryValue(value)).toThrow(
      'inventory value is not JSON serializable'
    );
  });
});
