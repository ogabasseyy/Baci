import { describe, expect, it } from 'vitest';
import { buildProductSupportLinks } from './build-commercial-support-links';

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
});
