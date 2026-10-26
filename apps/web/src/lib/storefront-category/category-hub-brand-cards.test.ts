import { describe, expect, it } from 'vitest';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { buildCategoryHubBrandCards } from '@/lib/storefront-category/category-hub-brand-cards';
import type { CategoryHubProduct } from '@/lib/storefront-category/category-hub-types';

function buildProduct(
  slug: string,
  brand: string,
  price: number
): CategoryHubProduct {
  return {
    slug,
    brand,
    name: `${brand} ${slug}`,
    price,
    category_slug: 'smartphones',
  };
}

describe('buildCategoryHubBrandCards', () => {
  it('keeps every eligible authority hub reachable when more than five qualify', () => {
    // Arrange
    const brandAuthorityEntries = brandAuthorityTaxonomy
      .getEntries('smartphones')
      .map((entry) => ({ ...entry, productCount: 5 }));

    // Act
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://ogabassey.com',
      products: [],
      brandAuthorityEntries,
    });

    // Assert
    expect(cards).toHaveLength(8);
    expect(cards.map((card) => card.href)).toEqual(
      expect.arrayContaining([
        'https://ogabassey.com/smartphones/brands/apple',
        'https://ogabassey.com/smartphones/brands/xiaomi',
        'https://ogabassey.com/smartphones/brands/oppo',
      ])
    );
  });

  it('keeps every product-derived authority hub reachable when more than five qualify', () => {
    // Arrange
    const products = brandAuthorityTaxonomy
      .getEntries('smartphones')
      .flatMap((entry) =>
        Array.from({ length: entry.minimumProducts }, (_, index) =>
          buildProduct(
            `${entry.brandKey}-${index}`,
            entry.brandQueryValue,
            100 + index
          )
        )
      );

    // Act
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://ogabassey.com',
      products,
    });

    // Assert
    expect(cards).toHaveLength(8);
    expect(cards.map((card) => card.href)).toEqual(
      expect.arrayContaining([
        'https://ogabassey.com/smartphones/brands/apple',
        'https://ogabassey.com/smartphones/brands/xiaomi',
        'https://ogabassey.com/smartphones/brands/oppo',
      ])
    );
  });

  it('does not add a duplicate Redmi fallback beside the Xiaomi authority hub', () => {
    // Arrange
    const products = [
      ...Array.from({ length: 5 }, (_, index) =>
        buildProduct(`xiaomi-${index}`, 'Xiaomi', 100 + index)
      ),
      buildProduct('redmi-1', 'Redmi', 200),
    ];

    // Act
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://ogabassey.com',
      products,
    });

    // Assert
    expect(cards.map((card) => card.title)).toEqual(['Xiaomi and Redmi']);
  });

  it('falls back to the three leading product brands without authority entries', () => {
    // Arrange
    const products = [
      buildProduct('tecno-1', 'Tecno', 100),
      buildProduct('tecno-2', 'Tecno', 200),
      buildProduct('apple-1', 'Apple', 300),
      buildProduct('samsung-1', 'Samsung', 400),
      buildProduct('oppo-1', 'Oppo', 500),
    ];

    // Act
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://ogabassey.com',
      products,
    });

    // Assert
    expect(cards.map((card) => card.title)).toEqual(['Tecno', 'Apple', 'Oppo']);
  });

  it('adds the canonical comparison link to both compared brand cards', () => {
    // Arrange
    const products = [
      ...Array.from({ length: 3 }, (_, index) =>
        buildProduct(`apple-${index}`, 'Apple', 100 + index)
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        buildProduct(`samsung-${index}`, 'Samsung', 200 + index)
      ),
    ];

    // Act
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://ogabassey.com',
      products,
    });

    // Assert
    expect(cards).toHaveLength(2);
    expect(
      cards.every((card) => card.secondaryHref?.endsWith('apple-vs-samsung'))
    ).toBe(true);
  });

  it('uses singular and plural product-count labels', () => {
    // Arrange
    const entries = brandAuthorityTaxonomy
      .getEntries('smartphones')
      .slice(0, 2);
    const brandAuthorityEntries = [
      { ...entries[0], productCount: 1 },
      { ...entries[1], productCount: 2 },
    ];

    // Act
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://ogabassey.com',
      products: [],
      brandAuthorityEntries,
    });

    // Assert
    expect(cards.map((card) => card.description)).toEqual([
      '1 active product in this category.',
      '2 active products in this category.',
    ]);
  });

  it('returns no brand cards for an unsupported category', () => {
    // Arrange
    const products = [buildProduct('phone-1', 'Tecno', 100)];

    // Act
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'unsupported',
      storeUrl: 'https://ogabassey.com',
      products,
    });

    // Assert
    expect(cards).toEqual([]);
  });
});
