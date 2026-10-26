import { describe, expect, it } from 'vitest';
import { resolveEligibleCategoryHubDestinations } from './eligible-hub-destinations';

describe('eligible-hub-destinations', () => {
  describe('resolveEligibleCategoryHubDestinations', () => {
    it('resolves both brand and family hubs when parent brand meets 5-product minimum and family meets 3-product minimum', () => {
      const products = [
        { name: 'iPhone 15 Pro Max', brand: 'Apple', stock: 10 },
        { name: 'iPhone 15 Pro', brand: 'Apple', stock: 5 },
        { name: 'iPhone 15', brand: 'Apple', stock: 3 },
        { name: 'iPhone 14', brand: 'Apple', stock: 2 },
        { name: 'iPhone 13', brand: 'Apple', stock: 1 },
      ];

      const result = resolveEligibleCategoryHubDestinations({
        storeUrl: 'https://ogabassey.com',
        categorySlug: 'smartphones',
        products,
      });

      expect(result.brandHubs).toHaveLength(1);
      expect(result.brandHubs[0]?.href).toBe(
        'https://ogabassey.com/smartphones/brands/apple'
      );
      expect(result.brandHubs[0]?.brand_key).toBe('apple');

      expect(result.familyHubs).toHaveLength(1);
      expect(result.familyHubs[0]?.href).toBe(
        'https://ogabassey.com/smartphones/brands/apple/families/iphone-15'
      );
      expect(result.familyHubs[0]?.family_key).toBe('iphone-15');
    });

    it('enforces parent-brand gating: excludes family hub even if family meets minimum when parent brand has < 5 products', () => {
      // 4 iPhone 15 products - family threshold (3) is met, but parent brand Apple threshold (5) is NOT met
      const products = [
        { name: 'iPhone 15 Pro Max', brand: 'Apple', stock: 10 },
        { name: 'iPhone 15 Pro', brand: 'Apple', stock: 5 },
        { name: 'iPhone 15 Plus', brand: 'Apple', stock: 3 },
        { name: 'iPhone 15', brand: 'Apple', stock: 1 },
      ];

      const result = resolveEligibleCategoryHubDestinations({
        storeUrl: 'https://ogabassey.com',
        categorySlug: 'smartphones',
        products,
      });

      // Apple brand hub not eligible (4 < 5)
      expect(result.brandHubs).toHaveLength(0);
      // Gated by parent brand: family hub must NOT be included!
      expect(result.familyHubs).toHaveLength(0);
    });

    it('excludes model family hub when parent brand is eligible but family has < 3 products', () => {
      // 5 Apple products (meets 5 threshold), but only 2 iPhone 15 products (threshold is 3)
      const products = [
        { name: 'iPhone 15 Pro Max', brand: 'Apple', stock: 10 },
        { name: 'iPhone 15', brand: 'Apple', stock: 5 },
        { name: 'iPhone 14 Pro', brand: 'Apple', stock: 4 },
        { name: 'iPhone 13', brand: 'Apple', stock: 2 },
        { name: 'iPhone 12', brand: 'Apple', stock: 2 },
      ];

      const result = resolveEligibleCategoryHubDestinations({
        storeUrl: 'https://ogabassey.com',
        categorySlug: 'smartphones',
        products,
      });

      expect(result.brandHubs).toHaveLength(1);
      expect(result.brandHubs[0]?.brand_key).toBe('apple');
      // iPhone 15 only has 2 products in stock (needs 3), so familyHubs is empty
      expect(result.familyHubs).toHaveLength(0);
    });

    it('filters out products that are out of stock (stock: 0)', () => {
      // 5 Apple products listed, but 2 are out of stock (stock: 0)
      const products = [
        { name: 'iPhone 15 Pro Max', brand: 'Apple', stock: 10 },
        { name: 'iPhone 15 Pro', brand: 'Apple', stock: 0 },
        { name: 'iPhone 15', brand: 'Apple', stock: 0 },
        { name: 'iPhone 14', brand: 'Apple', stock: 5 },
        { name: 'iPhone 13', brand: 'Apple', stock: 2 },
      ];

      const result = resolveEligibleCategoryHubDestinations({
        storeUrl: 'https://ogabassey.com',
        categorySlug: 'smartphones',
        products,
      });

      // In-stock products = 3, so Apple is not eligible (< 5)
      expect(result.brandHubs).toHaveLength(0);
      expect(result.familyHubs).toHaveLength(0);
    });

    it('treats stock: null as available in stock', () => {
      const products = [
        { name: 'iPhone 15 Pro Max', brand: 'Apple', stock: null },
        { name: 'iPhone 15 Pro', brand: 'Apple', stock: null },
        { name: 'iPhone 15', brand: 'Apple', stock: null },
        { name: 'iPhone 14', brand: 'Apple', stock: null },
        { name: 'iPhone 13', brand: 'Apple', stock: null },
      ];

      const result = resolveEligibleCategoryHubDestinations({
        categorySlug: 'smartphones',
        products,
      });

      expect(result.brandHubs).toHaveLength(1);
      expect(result.brandHubs[0]?.href).toBe('/smartphones/brands/apple');
      expect(result.familyHubs).toHaveLength(1);
      expect(result.familyHubs[0]?.href).toBe(
        '/smartphones/brands/apple/families/iphone-15'
      );
    });

    it('matches hub eligibility strictly to requested category scope, ignoring other/child category products', () => {
      // 2 iPhones under 'smartphones' and 3 Apple laptops under 'laptops'
      const mixedCategoryProducts = [
        {
          name: 'iPhone 15 Pro Max',
          brand: 'Apple',
          category_slug: 'smartphones',
          stock: 5,
        },
        {
          name: 'iPhone 15 Pro',
          brand: 'Apple',
          category_slug: 'smartphones',
          stock: 3,
        },
        {
          name: 'MacBook Pro 14',
          brand: 'Apple',
          category_slug: 'laptops',
          stock: 4,
        },
        {
          name: 'MacBook Air 13',
          brand: 'Apple',
          category_slug: 'laptops',
          stock: 2,
        },
        {
          name: 'MacBook Air 15',
          brand: 'Apple',
          category_slug: 'laptops',
          stock: 1,
        },
      ];

      // When resolving for 'smartphones', laptops products must NOT count toward Apple's 5-product minimum
      const smartphoneResult = resolveEligibleCategoryHubDestinations({
        categorySlug: 'smartphones',
        products: mixedCategoryProducts,
      });
      expect(smartphoneResult.brandHubs).toHaveLength(0);
      expect(smartphoneResult.familyHubs).toHaveLength(0);

      // When resolving for 'laptops', only laptops count (3 MacBooks -> Apple laptops has 5-product minimum so not eligible)
      const laptopResult = resolveEligibleCategoryHubDestinations({
        categorySlug: 'laptops',
        products: mixedCategoryProducts,
      });
      expect(laptopResult.brandHubs).toHaveLength(0);
    });

    it('counts products whose joined category memberships include the category', () => {
      const products = [
        'iPhone 15 Pro Max',
        'iPhone 15 Pro',
        'iPhone 15',
        'iPhone 14',
        'iPhone 13',
      ].map((name) => ({
        name,
        brand: 'Apple',
        stock: 5,
        category_slug: 'phones',
        category_slugs: ['phones', 'smartphones'],
      }));
      const result = resolveEligibleCategoryHubDestinations({
        categorySlug: 'smartphones',
        products,
      });
      expect(result.brandHubs).toHaveLength(1);
      expect(result.familyHubs).toHaveLength(1);
    });

    it('excludes variant rows the destination inventory would not count', () => {
      const products = [
        { name: 'iPhone 15 Pro Max', brand: 'Apple', stock: 10 },
        { name: 'iPhone 15 Pro', brand: 'Apple', stock: 5 },
        { name: 'iPhone 15', brand: 'Apple', stock: 3 },
        {
          name: 'iPhone 15 128GB Black',
          brand: 'Apple',
          stock: 2,
          parent_product_id: 'iphone-15-id',
        },
        {
          name: 'iPhone 15 256GB Blue',
          brand: 'Apple',
          stock: 2,
          parent_product_id: 'iphone-15-id',
        },
      ];

      const result = resolveEligibleCategoryHubDestinations({
        categorySlug: 'smartphones',
        products,
      });

      // Only 3 standalone rows count, below both brand (5) and family (3+brand gate) minimums
      expect(result.brandHubs).toHaveLength(0);
      expect(result.familyHubs).toHaveLength(0);
    });
  });
});
