import { describe, expect, it } from 'vitest';
import {
  buildCategorySupportLinks,
  buildProductSupportLinks,
} from './build-commercial-support-links';

describe('buildProductSupportLinks canonical brand aliases', () => {
  it('never emits a same-canonical-brand compare for mixed Apple/MacBook laptops', () => {
    const products = [
      ...['MacBook Air M4', 'MacBook Air M3', 'MacBook Pro M4'].map(
        (name, index) => ({
          slug: `macbook-${index}`,
          name,
          brand: 'MacBook',
          price: 1_500_000 - index * 10_000,
          category_slug: 'laptops',
          product_key_specs: { ram_gb: 16, storage_gb: 512 },
        })
      ),
      ...[
        'Apple MacBook Air M2',
        'Apple MacBook Pro M3',
        'Apple MacBook Air M1',
      ].map((name, index) => ({
        slug: `apple-${index}`,
        name,
        brand: 'Apple',
        price: 1_400_000 - index * 10_000,
        category_slug: 'laptops',
        product_key_specs: { ram_gb: 8, storage_gb: 256 },
      })),
    ];
    const links = buildProductSupportLinks({
      storeUrl: 'https://ogabassey.com',
      categorySlug: 'laptops',
      currentProductSlug: 'macbook-0',
      currentProductPrice: 1_500_000,
      products,
    });
    expect(links.some((link) => link.href.includes('apple-vs-macbook'))).toBe(
      false
    );
    expect(links.some((link) => link.href.includes('macbook-vs-apple'))).toBe(
      false
    );
  });

  it('emits the candidate canonical slug for gaming alias brands', () => {
    const products = [
      ...[0, 1, 2].map((i) => ({
        slug: `sony-${i}`,
        name: `Sony Console ${i}`,
        brand: 'Sony',
        price: 500_000,
        category_slug: 'gaming',
        product_key_specs: { storage_gb: 825, ram_gb: 16, chipset: 'A' },
      })),
      ...[0, 1, 2].map((i) => ({
        slug: `ms-${i}`,
        name: `Microsoft Console ${i}`,
        brand: 'Microsoft',
        price: 450_000,
        category_slug: 'gaming',
        product_key_specs: { storage_gb: 512, ram_gb: 12, chipset: 'B' },
      })),
    ];
    const links = buildCategorySupportLinks({
      storeUrl: 'https://ogabassey.com',
      categorySlug: 'gaming',
      categoryName: 'Gaming',
      products,
    });
    expect(links.map((link) => link.href)).toContain(
      'https://ogabassey.com/gaming/compare/playstation-vs-xbox'
    );
    expect(links.some((link) => link.href.includes('microsoft-vs-sony'))).toBe(
      false
    );
  });
});
