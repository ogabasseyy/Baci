import { describe, expect, it } from 'vitest';
import { resolveEligibleCategoryHubDestinations } from './eligible-hub-destinations';

describe('eligible-hub-destinations', () => {
  describe('resolveEligibleCategoryHubDestinations', () => {
    it('normalizes a cased or spaced category slug input', () => {
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
        category_slug: 'smartphones',
      }));
      const result = resolveEligibleCategoryHubDestinations({
        storeUrl: 'https://store.test',
        categorySlug: 'Smartphones',
        products,
      });
      expect(result.brandHubs[0]?.href).toBe(
        'https://store.test/smartphones/brands/apple'
      );
    });

    it('counts legacy category-text-only products toward hub eligibility', () => {
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
        category: 'Smartphones',
      }));
      const result = resolveEligibleCategoryHubDestinations({
        storeUrl: 'https://store.test',
        categorySlug: 'smartphones',
        products,
      });
      expect(result.brandHubs[0]?.href).toBe(
        'https://store.test/smartphones/brands/apple'
      );
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
