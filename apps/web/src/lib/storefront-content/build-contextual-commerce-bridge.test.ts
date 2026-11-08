import { describe, expect, it } from 'vitest';
import {
  buildClusterFeaturedProducts,
  type ClusterFeaturedInventoryProduct,
} from './build-cluster-featured-products';
import { buildClusterContextSummary } from './build-contextual-commerce-bridge';
import { buildInformationalClusterModel } from './build-informational-cluster-model';
import {
  smartphoneCategoryData,
  smartphoneGuidePost,
} from './build-informational-cluster-model.test-fixtures';

describe('build-contextual-commerce-bridge', () => {
  describe('buildClusterContextSummary', () => {
    it('mentions comparing brands, verified prices, condition options, and specs when at least two brands are present', () => {
      const summary = buildClusterContextSummary({
        categoryName: 'Smartphones',
        kind: 'buyer-guide',
        brands: ['apple', 'samsung'],
      });

      expect(summary).toBe(
        'Compare Apple and Samsung verified prices, condition options, and specs in smartphones.'
      );
    });

    it('formats multiple brands with commas and oxford and', () => {
      const summary = buildClusterContextSummary({
        categoryName: 'Smartphones',
        kind: 'best-in-nigeria',
        brands: ['apple', 'samsung', 'google'],
      });

      expect(summary).toBe(
        'Compare Apple, Samsung, and Google verified prices, condition options, and specs in smartphones.'
      );
    });

    it('deduplicates identical brands ignoring case', () => {
      const summary = buildClusterContextSummary({
        categoryName: 'Smartphones',
        kind: 'buyer-guide',
        brands: ['apple', 'Apple', 'samsung'],
      });

      expect(summary).toBe(
        'Compare Apple and Samsung verified prices, condition options, and specs in smartphones.'
      );
    });

    it('tailors single-brand summary and falls back to category-wide summary when no brands are present', () => {
      const singleBrandSummary = buildClusterContextSummary({
        categoryName: 'Smartphones',
        kind: 'buyer-guide',
        brands: ['apple'],
      });
      const emptyBrandSummary = buildClusterContextSummary({
        categoryName: 'Smartphones',
        kind: 'decision-support',
        brands: [],
      });
      const troubleshootingSummary = buildClusterContextSummary({
        categoryName: 'Laptops',
        kind: 'troubleshooting',
        brands: [],
      });

      expect(singleBrandSummary).toBe(
        'Compare Apple verified prices, condition grading, and key specs in smartphones.'
      );
      expect(emptyBrandSummary).toBe(
        'Compare verified prices, condition grading, and key specs across smartphones.'
      );
      expect(troubleshootingSummary).toBe(
        'Need a replacement or upgrade? Compare verified prices, condition grading, and key specs across laptops.'
      );
    });

    it('handles null kind and lowercases category name properly', () => {
      const summary = buildClusterContextSummary({
        categoryName: 'Laptops',
        kind: null,
        brands: [],
      });

      expect(summary).toBe(
        'Compare verified prices, condition grading, and key specs across laptops.'
      );
    });
  });

  describe('integration with buildClusterFeaturedProducts and buildInformationalClusterModel', () => {
    it('formats featured product descriptions with condition and verified key specs', () => {
      const products: ClusterFeaturedInventoryProduct[] = [
        {
          slug: 'iphone-15-pro',
          name: 'iPhone 15 Pro',
          brand: 'Apple',
          price: 950_000,
          category_slug: 'smartphones',
          condition: 'refurbished',
          product_key_specs: {
            ram_gb: 8,
            storage_gb: 256,
            battery_mah: 3274,
          },
          stock: 3,
        },
        {
          slug: 'pixel-8a',
          name: 'Pixel 8a',
          brand: 'Google',
          price: 450_000,
          category_slug: 'smartphones',
          condition: 'new',
          product_key_specs: {
            ram_gb: 8,
            battery_mah: 4492,
          },
          stock: 2,
        },
        {
          slug: 'galaxy-a15',
          name: 'Galaxy A15',
          brand: null,
          price: 180_000,
          category_slug: 'smartphones',
          stock: 5,
        },
      ];

      const appleFeatured = buildClusterFeaturedProducts(
        'https://ogabassey.com',
        'smartphones',
        ['apple'],
        products,
        'NG',
        'iPhone 15 Pro Price in Nigeria'
      );
      expect(appleFeatured[0]?.description).toBe(
        'Apple • Refurbished • ₦950,000 • 8GB RAM, 256GB storage'
      );

      const googleFeatured = buildClusterFeaturedProducts(
        'https://ogabassey.com',
        'smartphones',
        ['google'],
        products,
        'NG',
        'Pixel 8a Price in Nigeria'
      );
      expect(googleFeatured[0]?.description).toBe(
        'Google • New • ₦450,000 • 8GB RAM, 4492mAh battery'
      );

      const fallbackFeatured = buildClusterFeaturedProducts(
        'https://ogabassey.com',
        'smartphones',
        [],
        products.slice(2),
        'NG'
      );
      expect(fallbackFeatured[0]?.description).toBe(
        'Storefront pick • ₦180,000'
      );
    });

    it('populates contextSummary and annotated commerceLinks in buildInformationalClusterModel', async () => {
      const model = await buildInformationalClusterModel({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        storeUrl: 'https://ogabassey.com',
        post: smartphoneGuidePost,
        categoryDataOverride: smartphoneCategoryData,
      });

      expect(model?.contextSummary).toBe(
        'Compare Apple and Samsung verified prices, condition options, and specs in smartphones.'
      );
      const compareLink = model?.commerceLinks.find((link) =>
        link.href.includes('/compare/')
      );
      expect(compareLink?.description).toBe(
        'Review side-by-side specifications, price difference, and buying fit.'
      );
    });
  });
});
