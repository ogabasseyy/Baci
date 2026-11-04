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
        priceBandInventory: inventory,
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
        priceBandInventory: inventory,
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
        priceBandInventory: inventory,
      })
    );

    const priceBandLink = support.supportLinks.find((link) =>
      link.href.includes('/best-under/under-500k')
    );
    expect(priceBandLink).toBeDefined();
  });

  it('bounds category-and-children inventory before filtering so child products displace older qualifying products', () => {
    const currentProduct = makeCandidate({
      slug: 'phone-current',
      name: 'Phone Current',
      brand: 'Apple',
      price: 300_000,
    });

    const childProducts = Array.from({ length: 150 }, (_, i) =>
      makeCandidate({
        slug: `child-${i}`,
        name: `Child ${i}`,
        brand: 'Apple',
        category_slug: 'child-category',
        price: 900_000,
      })
    );

    const qualifyingOlderProducts = [
      makeCandidate({
        slug: 'old-1',
        name: 'Old 1',
        brand: 'Apple',
        price: 250_000,
      }),
      makeCandidate({
        slug: 'old-2',
        name: 'Old 2',
        brand: 'Apple',
        price: 350_000,
      }),
      makeCandidate({
        slug: 'old-3',
        name: 'Old 3',
        brand: 'Samsung',
        price: 200_000,
      }),
      makeCandidate({
        slug: 'old-4',
        name: 'Old 4',
        brand: 'Samsung',
        price: 400_000,
      }),
      makeCandidate({
        slug: 'old-5',
        name: 'Old 5',
        brand: 'Google',
        price: 300_000,
      }),
      makeCandidate({
        slug: 'old-6',
        name: 'Old 6',
        brand: 'Google',
        price: 450_000,
      }),
    ];

    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [...childProducts, ...qualifyingOlderProducts],
      })
    );

    const priceBandLink = support.supportLinks.find((link) =>
      link.href.includes('/best-under/under-500k')
    );
    expect(priceBandLink).toBeUndefined();
  });

  it('includes slugless products within the 150 pool so product 151 does not qualify a price band', () => {
    const currentProduct = makeCandidate({
      slug: 'current-phone',
      name: 'Current Phone',
      brand: 'Apple',
      price: 300_000,
    });

    const sluglessAboveBudget = Array.from({ length: 149 }, (_, i) =>
      makeCandidate({
        slug: `id-fallback-${i}`,
        name: `Above Budget ${i}`,
        brand: 'Apple',
        price: 2_000_000,
        has_explicit_slug: false,
      })
    );

    const olderQualifying = [
      { slug: 's1', brand: 'Samsung', price: 200_000 },
      { slug: 's2', brand: 'Samsung', price: 250_000 },
      { slug: 'g1', brand: 'Google', price: 300_000 },
      { slug: 'g2', brand: 'Google', price: 350_000 },
      { slug: 't1', brand: 'Tecno', price: 400_000 },
    ].map((c) => makeCandidate({ ...c, name: c.slug }));

    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [...sluglessAboveBudget, ...olderQualifying],
      })
    );

    const priceBandLink = support.supportLinks.find((link) =>
      link.href.includes('/best-under/under-500k')
    );
    expect(priceBandLink).toBeUndefined();
  });
});
