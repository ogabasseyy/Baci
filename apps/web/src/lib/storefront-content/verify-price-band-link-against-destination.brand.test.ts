import { describe, expect, it } from 'vitest';
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

describe('verifyPriceBandLinkAgainstDestination brand-compare links', () => {
  const pool = [
    ...Array.from({ length: 3 }, (_, i) => ({
      slug: `iphone-${i}`,
      name: `iPhone ${i}`,
      brand: 'Apple',
      price: 500_000,
      category_slug: 'smartphones',
      product_key_specs: { chipset: 'A', ram_gb: 8, storage_gb: 128 },
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      slug: `galaxy-${i}`,
      name: `Galaxy ${i}`,
      brand: 'Samsung',
      price: 450_000,
      category_slug: 'smartphones',
      product_key_specs: { chipset: 'S', ram_gb: 12, storage_gb: 256 },
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      slug: `tecno-${i}`,
      name: `Tecno ${i}`,
      brand: 'Tecno',
      price: 200_000,
      category_slug: 'smartphones',
      product_key_specs: { chipset: 'T', ram_gb: 8, storage_gb: 128 },
    })),
  ];

  it('keeps the brand link matching the destination candidate and drops others', () => {
    const result = verifyPriceBandLinkAgainstDestination({
      categorySlug: 'smartphones',
      links: [
        {
          href: 'https://store.test/smartphones/compare/apple-vs-samsung',
          label: 'Apple vs Samsung',
        },
        {
          href: 'https://store.test/smartphones/compare/apple-vs-tecno',
          label: 'Apple vs Tecno',
        },
        {
          href: 'https://store.test/smartphones/compare/iphone-0-vs-galaxy-0',
          label: 'iPhone 0 vs Galaxy 0',
        },
      ],
      compareProducts: pool,
    });
    expect(result.map((link) => link.href)).toEqual([
      'https://store.test/smartphones/compare/apple-vs-samsung',
      'https://store.test/smartphones/compare/iphone-0-vs-galaxy-0',
    ]);
  });

  it('drops an indexable brand link whose slug is not curated', () => {
    const links = [
      {
        href: 'https://store.test/smartphones/compare/apple-vs-samsung',
        label: 'Apple vs Samsung',
      },
    ];
    expect(
      verifyPriceBandLinkAgainstDestination({
        categorySlug: 'smartphones',
        links,
        compareProducts: pool,
        curatedCompareSlugs: new Set(['apple-vs-tecno']),
      })
    ).toEqual([]);
    expect(
      verifyPriceBandLinkAgainstDestination({
        categorySlug: 'smartphones',
        links,
        compareProducts: pool,
        curatedCompareSlugs: new Set(['apple-vs-samsung']),
      })
    ).toEqual(links);
  });

  it('drops a product-compare link whose slug is not curated', () => {
    const links = [
      {
        href: 'https://store.test/smartphones/compare/iphone-0-vs-galaxy-0',
        label: 'iPhone 0 vs Galaxy 0',
      },
    ];
    expect(
      verifyPriceBandLinkAgainstDestination({
        categorySlug: 'smartphones',
        links,
        compareProducts: pool,
        curatedCompareSlugs: new Set(['apple-vs-samsung']),
      })
    ).toEqual([]);
    expect(
      verifyPriceBandLinkAgainstDestination({
        categorySlug: 'smartphones',
        links,
        compareProducts: pool,
        curatedCompareSlugs: new Set(['galaxy-0-vs-iphone-0']),
      })
    ).toEqual(links);
  });

  it('verifies every band link, not just the first', () => {
    const result = verifyPriceBandLinkAgainstDestination({
      categorySlug: 'smartphones',
      links: [
        {
          href: 'https://store.test/smartphones/best-under/under-500k',
          label: 'Under 500k',
        },
        {
          href: 'https://store.test/smartphones/best-under/under-1m',
          label: 'Under 1M',
        },
      ],
      compareProducts: pool,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((link) => link.href.includes('/best-under/'))).toBe(
      true
    );
  });
});
