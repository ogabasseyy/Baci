import { describe, expect, it } from 'vitest';
import { buildProductSemanticCompareSupport } from './build-product-semantic-compare-support';
import {
  makeCandidate,
  makeInput,
} from './build-product-semantic-compare-support.test-helpers';

describe('buildProductSemanticCompareSupport price-band destination parity', () => {
  it('does not emit price-band link when destination 150 pool has only 5 qualifying products, even if current product matches range', () => {
    // Current product qualifies by price and brand but is NOT in the destination's 150 pool.
    const currentProduct = makeCandidate({
      slug: 'older-phone',
      name: 'Older Phone',
      brand: 'Apple',
      price: 300_000,
    });

    // Destination pool has only 5 products matching under-500k across 3 brands.
    const inventory = [
      makeCandidate({ slug: 'p1', name: 'P1', brand: 'Apple', price: 250_000 }),
      makeCandidate({ slug: 'p2', name: 'P2', brand: 'Apple', price: 350_000 }),
      makeCandidate({
        slug: 'p3',
        name: 'P3',
        brand: 'Samsung',
        price: 200_000,
      }),
      makeCandidate({
        slug: 'p4',
        name: 'P4',
        brand: 'Samsung',
        price: 400_000,
      }),
      makeCandidate({
        slug: 'p5',
        name: 'P5',
        brand: 'Google',
        price: 450_000,
      }),
    ];

    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory,
      })
    );

    const priceBandLink = support.supportLinks.find((link) =>
      link.href.includes('/best-under/')
    );
    expect(priceBandLink).toBeUndefined();
  });

  it('emits price-band link when destination 150 pool meets the 6-product 3-brand indexability threshold', () => {
    const currentProduct = makeCandidate({
      slug: 'phone-current',
      name: 'Phone Current',
      brand: 'Apple',
      price: 300_000,
    });

    // Destination pool has 6 qualifying products across 3 brands.
    const inventory = [
      makeCandidate({ slug: 'p1', name: 'P1', brand: 'Apple', price: 250_000 }),
      makeCandidate({ slug: 'p2', name: 'P2', brand: 'Apple', price: 350_000 }),
      makeCandidate({
        slug: 'p3',
        name: 'P3',
        brand: 'Samsung',
        price: 200_000,
      }),
      makeCandidate({
        slug: 'p4',
        name: 'P4',
        brand: 'Samsung',
        price: 400_000,
      }),
      makeCandidate({
        slug: 'p5',
        name: 'P5',
        brand: 'Google',
        price: 300_000,
      }),
      makeCandidate({
        slug: 'p6',
        name: 'P6',
        brand: 'Google',
        price: 450_000,
      }),
    ];

    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory,
      })
    );

    const priceBandLink = support.supportLinks.find((link) =>
      link.href.includes('/best-under/under-500k')
    );
    expect(priceBandLink).toBeDefined();
    expect(priceBandLink?.href).toBe(
      'https://ogabassey.com/smartphones/best-under/under-500k'
    );
  });

  it('qualifies zero-stock managed products when has_condition_offers is true', () => {
    const currentProduct = makeCandidate({
      slug: 'phone-current',
      name: 'Phone Current',
      brand: 'Apple',
      price: 300_000,
    });

    const inventory = [
      makeCandidate({
        slug: 'p1',
        name: 'P1',
        brand: 'Apple',
        price: 250_000,
        stock: 0,
        manage_stock: true,
        has_condition_offers: true,
      }),
      makeCandidate({
        slug: 'p2',
        name: 'P2',
        brand: 'Apple',
        price: 350_000,
        stock: 0,
        manage_stock: true,
        has_condition_offers: true,
      }),
      makeCandidate({
        slug: 'p3',
        name: 'P3',
        brand: 'Samsung',
        price: 200_000,
        stock: 0,
        manage_stock: true,
        has_condition_offers: true,
      }),
      makeCandidate({
        slug: 'p4',
        name: 'P4',
        brand: 'Samsung',
        price: 400_000,
        stock: 0,
        manage_stock: true,
        has_condition_offers: true,
      }),
      makeCandidate({
        slug: 'p5',
        name: 'P5',
        brand: 'Google',
        price: 300_000,
        stock: 0,
        manage_stock: true,
        has_condition_offers: true,
      }),
      makeCandidate({
        slug: 'p6',
        name: 'P6',
        brand: 'Google',
        price: 450_000,
        stock: 0,
        manage_stock: true,
        has_condition_offers: true,
      }),
    ];

    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory,
      })
    );

    const priceBandLink = support.supportLinks.find((link) =>
      link.href.includes('/best-under/under-500k')
    );
    expect(priceBandLink).toBeDefined();
  });
});
