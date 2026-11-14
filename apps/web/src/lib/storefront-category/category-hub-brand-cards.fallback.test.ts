import { describe, expect, it } from 'vitest';
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
    product_key_specs: {
      chipset: 'Snapdragon 8 Elite',
      ram_gb: 12,
      storage_gb: 512,
    },
  };
}

describe('buildCategoryHubBrandCards fallback and placeholder handling', () => {
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

  it('prefers positive-price products over zero-price products for brand card fallback representatives', () => {
    const products = [
      buildProduct('free-1', 'FreeBrand', 0),
      buildProduct('free-paid', 'FreeBrand', 120),
      buildProduct('brand-b-1', 'BrandB', 100),
      buildProduct('brand-c-1', 'BrandC', 100),
    ];

    const cards = buildCategoryHubBrandCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://ogabassey.com',
      products,
    });

    expect(cards.map((card) => card.title)).toEqual([
      'FreeBrand',
      'BrandB',
      'BrandC',
    ]);
    expect(cards[0]?.href).toBe('https://ogabassey.com/smartphones/free-paid');
  });

  it('excludes out-of-stock products from brand card fallback representatives and selects in-stock alternative', () => {
    const products = [
      {
        ...buildProduct('sony-oos', 'Sony', 50),
        manage_stock: true,
        stock: 0,
        has_condition_offers: false,
      },
      {
        ...buildProduct('sony-in-stock', 'Sony', 150),
        manage_stock: true,
        stock: 5,
        has_condition_offers: false,
      },
    ];

    const cards = buildCategoryHubBrandCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://ogabassey.com',
      products,
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]?.title).toBe('Sony');
    expect(cards[0]?.href).toBe(
      'https://ogabassey.com/smartphones/sony-in-stock'
    );
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
});
