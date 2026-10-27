import { describe, expect, it } from 'vitest';
import { resolveEligibleCategoryHubDestinations } from './eligible-hub-destinations';

describe('eligible-hub-destinations', () => {
  describe('resolveEligibleCategoryHubDestinations', () => {
    it('counts stock-zero products when manage_stock is absent (unmanaged at destination)', () => {
      const products = [
        'iPhone 15 Pro Max',
        'iPhone 15 Pro',
        'iPhone 15',
        'iPhone 14',
        'iPhone 13',
      ].map((name) => ({
        name,
        brand: 'Apple',
        stock: 0,
        category_slug: 'smartphones',
      }));
      const result = resolveEligibleCategoryHubDestinations({
        categorySlug: 'smartphones',
        products,
      });
      expect(result.brandHubs).toHaveLength(1);
      expect(result.familyHubs).toHaveLength(1);
    });

    it('counts legacy null manage_stock products with zero stock like the destination', () => {
      const products = [
        'iPhone 15 Pro Max',
        'iPhone 15 Pro',
        'iPhone 15',
        'iPhone 14',
        'iPhone 13',
      ].map((name) => ({
        name,
        brand: 'Apple',
        stock: 0,
        manage_stock: null,
        category_slug: 'smartphones',
      }));
      const result = resolveEligibleCategoryHubDestinations({
        categorySlug: 'smartphones',
        products,
      });
      expect(result.brandHubs).toHaveLength(1);
      expect(result.familyHubs).toHaveLength(1);
    });

    it('counts child-category rows from an explicitly scoped pool', () => {
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
        manage_stock: true,
        category_slug: 'android-phones',
        category_slugs: ['android-phones'],
      }));
      const result = resolveEligibleCategoryHubDestinations({
        categorySlug: 'smartphones',
        products,
        assumeCategoryScoped: true,
      });
      expect(result.brandHubs).toHaveLength(1);
      expect(result.familyHubs).toHaveLength(1);
    });

    it('counts unmanaged-stock products with zero stock columns', () => {
      const products = [
        'iPhone 15 Pro Max',
        'iPhone 15 Pro',
        'iPhone 15',
        'iPhone 14',
        'iPhone 13',
      ].map((name) => ({
        name,
        brand: 'Apple',
        stock: 0,
        manage_stock: false,
        category_slug: 'smartphones',
      }));
      const result = resolveEligibleCategoryHubDestinations({
        categorySlug: 'smartphones',
        products,
      });
      expect(result.brandHubs).toHaveLength(1);
      expect(result.familyHubs).toHaveLength(1);
    });
    it('excludes explicitly managed products with unknown stock', () => {
      const products = [
        'iPhone 15 Pro Max',
        'iPhone 15 Pro',
        'iPhone 15',
        'iPhone 14',
        'iPhone 13',
      ].map((name) => ({
        name,
        brand: 'Apple',
        stock: null,
        manage_stock: true,
        category_slug: 'smartphones',
      }));
      const result = resolveEligibleCategoryHubDestinations({
        categorySlug: 'smartphones',
        products,
      });

      expect(result.brandHubs).toHaveLength(0);
    });
    it('counts confirmed in-stock products with stock 0, while excluding confirmed out-of-stock items and unconfirmed zero-stock items', () => {
      const inStockZeroStockProducts = [
        'iPhone 15 Pro Max',
        'iPhone 15 Pro',
        'iPhone 15',
        'iPhone 14 Pro',
        'iPhone 14',
      ].map((name) => ({
        name,
        brand: 'Apple',
        stock: 0,
        availability: 'InStock' as const,
        category_slug: 'smartphones',
      }));

      const inStockResult = resolveEligibleCategoryHubDestinations({
        categorySlug: 'smartphones',
        products: inStockZeroStockProducts,
      });

      expect(inStockResult.brandHubs).toHaveLength(1);
      expect(inStockResult.brandHubs[0]?.brand_key).toBe('apple');
      expect(inStockResult.familyHubs).toHaveLength(1);
      expect(inStockResult.familyHubs[0]?.family_key).toBe('iphone-15');

      const outOfStockProducts = inStockZeroStockProducts.map((product) => ({
        ...product,
        stock: 5,
        availability: 'OutOfStock' as const,
      }));
      const outOfStockResult = resolveEligibleCategoryHubDestinations({
        categorySlug: 'smartphones',
        products: outOfStockProducts,
      });
      expect(outOfStockResult.brandHubs).toHaveLength(0);
      expect(outOfStockResult.familyHubs).toHaveLength(0);

      const zeroStockProducts = inStockZeroStockProducts.map((product) => ({
        ...product,
        stock: 0,
        availability: undefined,
        manage_stock: true,
      }));
      const zeroStockResult = resolveEligibleCategoryHubDestinations({
        categorySlug: 'smartphones',
        products: zeroStockProducts,
      });
      expect(zeroStockResult.brandHubs).toHaveLength(0);
      expect(zeroStockResult.familyHubs).toHaveLength(0);
    });
  });
});
