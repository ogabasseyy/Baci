import { describe, expect, it } from 'vitest';
import { buildCanonicalProductCompareSlug } from '@/lib/storefront-compare/compare-slugs';
import { verifyPriceBandLinkAgainstDestination } from './verify-price-band-link-against-destination';

const _links = [
  {
    href: 'https://store.test/smartphones/compare/apple-0-vs-samsung-0',
    label: 'A vs B',
  },
  {
    href: 'https://store.test/smartphones/best-under/under-500k',
    label: 'Best Smartphones Under ₦500,000',
  },
];

function _product(id: string, brand: string, price: number) {
  return {
    slug: id,
    name: id,
    brand,
    price,
    category_slug: 'smartphones',
    product_key_specs: {
      chipset: brand,
      ram_gb: brand === 'Samsung' ? 12 : 8,
      storage_gb: brand === 'Samsung' ? 256 : 128,
    },
  };
}

describe('verifyPriceBandLinkAgainstDestination encoded slugs', () => {
  it('keeps an indexable compare link whose product slug contains -vs-', () => {
    const pool = [
      {
        slug: 'galaxy-vs-ultra',
        name: 'Galaxy VS Ultra',
        brand: 'Samsung',
        price: 500_000,
        category_slug: 'smartphones',
        product_key_specs: { chipset: 'S', ram_gb: 12, storage_gb: 256 },
      },
      {
        slug: 'iphone-0',
        name: 'iPhone 0',
        brand: 'Apple',
        price: 520_000,
        category_slug: 'smartphones',
        product_key_specs: { chipset: 'A', ram_gb: 8, storage_gb: 128 },
      },
    ];
    const encodedPool = [
      ...pool,
      ...Array.from({ length: 2 }, (_, i) => ({
        slug: `iphone-extra-${i}`,
        name: `iPhone Extra ${i}`,
        brand: 'Apple',
        price: 530_000,
        category_slug: 'smartphones',
        product_key_specs: { chipset: 'A', ram_gb: 8, storage_gb: 128 },
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        slug: `galaxy-extra-${i}`,
        name: `Galaxy Extra ${i}`,
        brand: 'Samsung',
        price: 510_000,
        category_slug: 'smartphones',
        product_key_specs: { chipset: 'S', ram_gb: 12, storage_gb: 256 },
      })),
    ];
    void encodedPool;
    const slug = buildCanonicalProductCompareSlug(
      'galaxy-vs-ultra',
      'iphone-0'
    );
    const result = verifyPriceBandLinkAgainstDestination({
      categorySlug: 'smartphones',
      links: [
        {
          href: `https://store.test/smartphones/compare/${slug}`,
          label: 'Galaxy VS Ultra vs iPhone 0',
        },
      ],
      compareProducts: encodedPool,
    });
    expect(result).toHaveLength(1);
  });
});
