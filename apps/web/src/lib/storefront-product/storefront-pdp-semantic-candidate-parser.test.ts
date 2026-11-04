import { describe, expect, it } from 'vitest';
import {
  isJsonObject,
  parseInventory,
  toProductSemanticCandidateFromJson,
} from './storefront-pdp-semantic-candidate-parser';

describe('storefront-pdp-semantic-candidate-parser', () => {
  describe('isJsonObject', () => {
    it('returns true for plain objects', () => {
      expect(isJsonObject({})).toBe(true);
      expect(isJsonObject({ a: 1 })).toBe(true);
    });

    it('returns false for null, arrays, and primitives', () => {
      expect(isJsonObject(null)).toBe(false);
      expect(isJsonObject([])).toBe(false);
      expect(isJsonObject('string')).toBe(false);
      expect(isJsonObject(123)).toBe(false);
      expect(isJsonObject(true)).toBe(false);
    });
  });

  describe('toProductSemanticCandidateFromJson', () => {
    it('parses a valid JSON candidate with all attributes', () => {
      const candidate = toProductSemanticCandidateFromJson(
        {
          slug: 'iphone-15',
          name: 'iPhone 15',
          price: 950000,
          brand: 'Apple',
          condition: 'brand_new',
          stock: 5,
          stock_quantity: 5,
          manage_stock: true,
          categories: { slug: 'phones' },
          product_key_specs: { storage: '128GB' },
        },
        'smartphones'
      );

      expect(candidate).toEqual({
        slug: 'iphone-15',
        name: 'iPhone 15',
        price: 950000,
        brand: 'Apple',
        condition: 'brand_new',
        stock: 5,
        manage_stock: true,
        category_slug: 'phones',
        product_key_specs: { storage: '128GB' },
      });
    });

    it('resolves manage_stock: false with zero stock as stock: null (unmanaged)', () => {
      const candidate = toProductSemanticCandidateFromJson(
        {
          slug: 'unmanaged-case',
          name: 'Unmanaged Case',
          price: 5000,
          stock: 0,
          stock_quantity: 0,
          manage_stock: false,
          categories: { slug: 'accessories' },
        },
        'accessories'
      );

      expect(candidate).toEqual(
        expect.objectContaining({
          slug: 'unmanaged-case',
          stock: null,
          manage_stock: false,
        })
      );
    });

    it('resolves manage_stock: null with zero stock as stock: 0 (managed default)', () => {
      const candidate = toProductSemanticCandidateFromJson(
        {
          slug: 'managed-null-case',
          name: 'Managed Null Case',
          price: 5000,
          stock: 0,
          stock_quantity: 0,
          manage_stock: null,
          categories: { slug: 'accessories' },
        },
        'accessories'
      );

      expect(candidate).toEqual(
        expect.objectContaining({
          slug: 'managed-null-case',
          stock: 0,
          manage_stock: null,
        })
      );
    });

    it('resolves manage_stock: true with zero stock as stock: 0 (tracked sold-out)', () => {
      const candidate = toProductSemanticCandidateFromJson(
        {
          slug: 'tracked-sold-out',
          name: 'Tracked Sold Out',
          price: 5000,
          stock: 0,
          stock_quantity: 0,
          manage_stock: true,
          categories: { slug: 'accessories' },
        },
        'accessories'
      );

      expect(candidate).toEqual(
        expect.objectContaining({
          slug: 'tracked-sold-out',
          stock: 0,
          manage_stock: true,
        })
      );
    });

    it('preserves omitted manage_stock as undefined with finite stock (strict fallback)', () => {
      const candidate = toProductSemanticCandidateFromJson(
        {
          slug: 'omitted-manage-stock',
          name: 'Omitted Manage Stock',
          price: 5000,
          stock: 0,
          stock_quantity: 0,
          categories: { slug: 'accessories' },
        },
        'accessories'
      );

      expect(candidate).toEqual(
        expect.objectContaining({
          slug: 'omitted-manage-stock',
          stock: 0,
          manage_stock: undefined,
        })
      );
    });

    it.each([
      ['number 1', 1],
      ['number 0', 0],
      ['string true', 'true'],
      ['string false', 'false'],
      ['empty string', ''],
      ['array', []],
      ['object', {}],
    ])('rejects malformed present manage_stock value (%s) by returning null', (_label, malformedValue) => {
      const candidate = toProductSemanticCandidateFromJson(
        {
          slug: 'test-product',
          name: 'Test Product',
          price: 10000,
          manage_stock: malformedValue,
        },
        'smartphones'
      );

      expect(candidate).toBeNull();
    });

    it('parses has_condition_offers when present', () => {
      const candidate = toProductSemanticCandidateFromJson(
        {
          slug: 'has-condition-offers',
          name: 'Has Condition Offers',
          price: 5000,
          has_condition_offers: true,
        },
        'accessories'
      );
      expect(candidate?.has_condition_offers).toBe(true);
    });

    it.each([
      ['number 1', 1],
      ['string true', 'true'],
      ['object', {}],
    ])('rejects malformed present has_condition_offers value (%s) by returning null', (_label, malformedValue) => {
      const candidate = toProductSemanticCandidateFromJson(
        {
          slug: 'test-product',
          name: 'Test Product',
          price: 10000,
          has_condition_offers: malformedValue,
        },
        'smartphones'
      );

      expect(candidate).toBeNull();
    });

    it('returns null when price is invalid', () => {
      expect(
        toProductSemanticCandidateFromJson(
          { slug: 'p1', name: 'Product 1', price: 'invalid' },
          'cat'
        )
      ).toBeNull();
    });

    it('returns null when stock is invalid type', () => {
      expect(
        toProductSemanticCandidateFromJson(
          { slug: 'p1', name: 'Product 1', price: 100, stock: 'ten' },
          'cat'
        )
      ).toBeNull();
    });

    it('returns null when value is not a JSON object', () => {
      expect(toProductSemanticCandidateFromJson('string', 'cat')).toBeNull();
      expect(toProductSemanticCandidateFromJson(null, 'cat')).toBeNull();
      expect(toProductSemanticCandidateFromJson(123, 'cat')).toBeNull();
    });
  });

  describe('parseInventory', () => {
    it('returns null when value is not an array', () => {
      expect(parseInventory(null, 'cat')).toBeNull();
      expect(parseInventory({}, 'cat')).toBeNull();
    });

    it('returns null if any row in array fails validation', () => {
      const result = parseInventory(
        [
          { slug: 'valid-1', name: 'Valid 1', price: 100 },
          { slug: 'invalid-2', name: 'Invalid 2', price: 'not-a-number' },
        ],
        'cat'
      );
      expect(result).toBeNull();
    });

    it('merges candidates by slug when all rows are valid', () => {
      const result = parseInventory(
        [
          {
            slug: 'phone-1',
            name: 'Phone 1',
            price: 100,
            categories: { slug: 'electronics' },
          },
          {
            slug: 'phone-1',
            name: 'Phone 1',
            price: 100,
            categories: { slug: 'gadgets' },
          },
        ],
        'default-cat'
      );

      expect(result).toHaveLength(1);
      expect(result?.[0]?.slug).toBe('phone-1');
      expect(result?.[0]?.category_slug).toBe('electronics');
    });
  });
});
