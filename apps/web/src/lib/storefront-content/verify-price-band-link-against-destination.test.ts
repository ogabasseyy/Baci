import { describe, expect, it } from 'vitest';
import { verifyPriceBandLinkAgainstDestination } from './verify-price-band-link-against-destination';

const links = [
  {
    href: 'https://store.test/smartphones/compare/apple-0-vs-samsung-0',
    label: 'A vs B',
  },
  {
    href: 'https://store.test/smartphones/best-under/under-500k',
    label: 'Best Smartphones Under ₦500,000',
  },
];

function product(id: string, brand: string, price: number) {
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

describe('verifyPriceBandLinkAgainstDestination', () => {
  it('keeps the band link when the compare pool makes it indexable', () => {
    const products = [
      ...Array.from({ length: 3 }, (_, i) =>
        product(`apple-${i}`, 'Apple', 300_000)
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        product(`samsung-${i}`, 'Samsung', 320_000)
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        product(`tecno-${i}`, 'Tecno', 340_000)
      ),
    ];
    expect(
      verifyPriceBandLinkAgainstDestination({
        categorySlug: 'smartphones',
        links,
        compareProducts: products,
      })
    ).toEqual(links);
  });

  it('drops the band link when the compare pool is below thresholds', () => {
    expect(
      verifyPriceBandLinkAgainstDestination({
        categorySlug: 'smartphones',
        links,
        compareProducts: [product('only-1', 'Apple', 300_000)],
      })
    ).toEqual([]);
  });

  it('drops the band link when no compare inventory is available', () => {
    expect(
      verifyPriceBandLinkAgainstDestination({
        categorySlug: 'smartphones',
        links,
        compareProducts: null,
      })
    ).toEqual([]);
  });

  it('drops unverifiable compare links when no compare inventory is available', () => {
    expect(
      verifyPriceBandLinkAgainstDestination({
        categorySlug: 'smartphones',
        links: [links[0] as never],
        compareProducts: null,
      })
    ).toEqual([]);
  });
});
