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
  });
});
