import { describe, expect, it } from 'vitest';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { buildCategoryHubBrandCards } from '@/lib/storefront-category/category-hub-brand-cards';
import { countBrandsByActiveProduct } from '@/lib/storefront-category/category-hub-brand-utils';
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
    product_key_specs:
      brand === 'Apple'
        ? { chipset: 'A19 Pro', ram_gb: 8, storage_gb: 256 }
        : { chipset: 'Snapdragon 8 Elite', ram_gb: 12, storage_gb: 512 },
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
    expect(cards).toHaveLength(9);
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
    expect(cards).toHaveLength(9);
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

  it('honors explicitly supplied empty brand authority entries without falling back to unverified product eligibility', () => {
    const products = Array.from({ length: 5 }, (_, i) => ({
      slug: `ipad-${i}`,
      brand: 'Apple',
      name: `iPad ${i}`,
      price: 200_000,
      category_slug: 'tablets',
    }));
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'tablets',
      storeUrl: 'https://ogabassey.com',
      products,
      brandAuthorityEntries: [],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.href).toBe('https://ogabassey.com/tablets/ipad-0');
    expect(cards[0]?.title).toBe('Apple');
  });

  it('excludes non-brand placeholders (gaming, generic, unbranded, other) from countBrandsByActiveProduct and brandCards', () => {
    const products = [
      buildProduct('game-1', 'Gaming', 100),
      buildProduct('gen-1', 'generic', 100),
      buildProduct('unbr-1', 'unbranded', 100),
      buildProduct('oth-1', 'other', 100),
      buildProduct('na-1', 'N/A', 100),
      buildProduct('na-2', 'NA', 100),
      buildProduct('unk-1', 'Unknown', 100),
      buildProduct('nobr-1', 'No-Brand', 100),
      buildProduct('unbr-prod-1', 'Unbranded Product', 100),
      buildProduct('oth-brand-1', 'Other Brand', 100),
      buildProduct('tecno-1', 'Tecno', 200),
      buildProduct('apple-1', 'Apple', 300),
    ];
    const brandCounts = countBrandsByActiveProduct(products);
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://ogabassey.com',
      products,
    });
    expect(brandCounts).toEqual([
      { key: 'apple', label: 'Apple', count: 1 },
      { key: 'tecno', label: 'Tecno', count: 1 },
    ]);
    expect(cards.map((card) => card.title)).toEqual(['Apple', 'Tecno']);
    expect(
      cards.some((card) =>
        /gaming|generic|unbranded|other|na|unknown|no-brand/i.test(card.title)
      )
    ).toBe(false);
  });

  it('resolves representative product card for fallback brands with leading/trailing whitespace via normalized brand key matching', () => {
    const products = [buildProduct('konami-1', ' Konami ', 250)];
    const brandCounts = countBrandsByActiveProduct(products);
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://ogabassey.com',
      products,
    });
    expect(brandCounts).toEqual([{ key: 'konami', label: 'Konami', count: 1 }]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.title).toBe('Konami');
    expect(cards[0]?.href).toBe('https://ogabassey.com/smartphones/konami-1');
  });

  it('does not drop or displace fallback brands with all zero-price products', () => {
    const products = [
      buildProduct('free-1', 'FreeBrand', 0),
      buildProduct('free-2', 'FreeBrand', 0),
      buildProduct('brand-b-1', 'BrandB', 100),
      buildProduct('brand-c-1', 'BrandC', 100),
      buildProduct('brand-d-1', 'BrandD', 100),
    ];
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://ogabassey.com',
      products,
    });
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.title)).toEqual([
      'FreeBrand',
      'BrandB',
      'BrandC',
    ]);
    const freeCard = cards.find((card) => card.title === 'FreeBrand');
    expect(freeCard?.href).toBe('https://ogabassey.com/smartphones/free-1');
  });

  it('does not generate a secondary compare link to placeholder brands', () => {
    const products = [
      ...Array.from({ length: 3 }, (_, index) =>
        buildProduct(`apple-${index}`, 'Apple', 100 + index)
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        buildProduct(`gaming-${index}`, 'Gaming', 200 + index)
      ),
    ];
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://ogabassey.com',
      products,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.title).toBe('Apple');
    expect(cards[0]?.secondaryHref).toBeUndefined();
  });
});
