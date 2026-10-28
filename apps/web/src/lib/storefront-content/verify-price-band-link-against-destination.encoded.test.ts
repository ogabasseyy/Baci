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

describe('verifyPriceBandLinkAgainstDestination candidate indexability', () => {
  it('drops the brand link when the destination candidate is below threshold', () => {
    const pool = [
      {
        slug: 'iphone-0',
        name: 'iPhone 0',
        brand: 'Apple',
        price: 500_000,
        category_slug: 'smartphones',
        product_key_specs: { chipset: 'A', ram_gb: 8, storage_gb: 128 },
      },
      {
        slug: 'iphone-1',
        name: 'iPhone 1',
        brand: 'Apple',
        price: 510_000,
        product_key_specs: { chipset: 'A', ram_gb: 8, storage_gb: 128 },
      },
      {
        slug: 'iphone-2',
        name: 'iPhone 2',
        brand: 'Apple',
        price: 520_000,
        product_key_specs: { chipset: 'A', ram_gb: 8, storage_gb: 128 },
      },
      {
        slug: 'galaxy-0',
        name: 'Galaxy 0',
        brand: 'Samsung',
        price: 450_000,
        category_slug: 'smartphones',
        product_key_specs: { chipset: 'S', ram_gb: 12, storage_gb: 256 },
      },
    ];
    const result = verifyPriceBandLinkAgainstDestination({
      categorySlug: 'smartphones',
      links: [
        {
          href: 'https://store.test/smartphones/compare/apple-vs-samsung',
          label: 'Apple vs Samsung',
        },
      ],
      compareProducts: pool,
    });
    expect(result).toEqual([]);
  });

  it('drops a non-taxonomy brand link that is not the destination candidate', () => {
    const pool = [
      ...Array.from({ length: 3 }, (_, i) => ({
        slug: `vivo-${i}`,
        name: `Vivo ${i}`,
        brand: 'Vivo',
        price: 300_000,
        product_key_specs: { chipset: 'V', ram_gb: 8, storage_gb: 128 },
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        slug: `oneplus-${i}`,
        name: `OnePlus ${i}`,
        brand: 'OnePlus',
        price: 320_000,
        product_key_specs: { chipset: 'O', ram_gb: 12, storage_gb: 256 },
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        slug: `iphone-x-${i}`,
        name: `iPhone X ${i}`,
        brand: 'Apple',
        price: 500_000,
        category_slug: 'smartphones',
        product_key_specs: { chipset: 'A', ram_gb: 8, storage_gb: 128 },
      })),
    ];
    const result = verifyPriceBandLinkAgainstDestination({
      categorySlug: 'smartphones',
      links: [
        {
          href: 'https://store.test/smartphones/compare/vivo-vs-oneplus',
          label: 'Vivo vs OnePlus',
        },
      ],
      compareProducts: pool,
    });
    // Destination top-two candidate is not vivo-vs-oneplus, so it is dropped
    // unless it happens to be the candidate; either way an unverified
    // non-candidate brand slug must not survive.
    expect(
      result.every(
        (link) =>
          link.href !== 'https://store.test/smartphones/compare/vivo-vs-oneplus'
      )
    ).toBe(true);
  });
});
