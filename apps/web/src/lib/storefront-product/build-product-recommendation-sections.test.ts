import { describe, expect, it } from 'vitest';
import { buildRecommendationSections } from './build-product-recommendation-sections';
import {
  makeCandidate,
  makeInput,
} from './build-product-semantic-model.test-helpers';

const NO_COMPARE_SLUGS = new Set<string>();

describe('buildRecommendationSections', () => {
  it('guarantees zero duplicate product hrefs across alternatives, sameBrand, and samePrice', () => {
    const currentProduct = makeCandidate({
      slug: 'galaxy-s25',
      name: 'Galaxy S25',
      brand: 'Samsung',
      price: 500_000,
    });
    const inventory = [
      currentProduct,
      makeCandidate({
        slug: 'galaxy-s24',
        name: 'Galaxy S24',
        brand: 'Samsung',
        price: 490_000,
      }),
      makeCandidate({
        slug: 'galaxy-s23',
        name: 'Galaxy S23',
        brand: 'Samsung',
        price: 480_000,
      }),
      makeCandidate({
        slug: 'iphone-16',
        name: 'iPhone 16',
        brand: 'Apple',
        price: 505_000,
      }),
      makeCandidate({
        slug: 'pixel-9',
        name: 'Pixel 9',
        brand: 'Google',
        price: 495_000,
      }),
      makeCandidate({
        slug: 'xiaomi-15',
        name: 'Xiaomi 15',
        brand: 'Xiaomi',
        price: 498_000,
      }),
    ];

    const model = buildRecommendationSections(
      makeInput({ currentProduct, inventory }),
      NO_COMPARE_SLUGS
    );

    const allHrefs = [
      ...(model.alternatives?.cards.map((c) => c.href) ?? []),
      ...(model.sameBrand?.cards.map((c) => c.href) ?? []),
      ...(model.samePrice?.cards.map((c) => c.href) ?? []),
    ];

    expect(allHrefs.length).toBeGreaterThan(0);
    expect(new Set(allHrefs).size).toBe(allHrefs.length);
    expect(allHrefs.some((href) => href.endsWith('/galaxy-s25'))).toBe(false);
  });

  it('preserves the missing-brand guard when currentProduct.brand is empty or undefined', () => {
    const currentProduct = makeCandidate({
      slug: 'generic-device',
      name: 'Generic Device',
      brand: '   ',
      price: 200_000,
    });
    const inventory = [
      currentProduct,
      makeCandidate({
        slug: 'other-device-1',
        name: 'Other Device 1',
        brand: 'Brand A',
        price: 205_000,
      }),
      makeCandidate({
        slug: 'other-device-2',
        name: 'Other Device 2',
        brand: '   ',
        price: 202_000,
      }),
    ];

    const model = buildRecommendationSections(
      makeInput({ currentProduct, inventory }),
      NO_COMPARE_SLUGS
    );

    expect(model.sameBrand).toBeNull();
    expect(model.alternatives?.cards.length).toBe(2);
  });

  it('allocates other-brand to alternatives and same-brand to sameBrand in minimal mixed-brand fixture', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-16-pro',
      name: 'iPhone 16 Pro',
      brand: 'Apple',
      price: 1_200_000,
    });
    const sameBrandCandidate = makeCandidate({
      slug: 'iphone-15-pro',
      name: 'iPhone 15 Pro',
      brand: 'Apple',
      price: 1_000_000,
    });
    const otherBrandCandidate = makeCandidate({
      slug: 'galaxy-s24-ultra',
      name: 'Galaxy S24 Ultra',
      brand: 'Samsung',
      price: 1_150_000,
    });

    const model = buildRecommendationSections(
      makeInput({
        currentProduct,
        inventory: [currentProduct, sameBrandCandidate, otherBrandCandidate],
      }),
      NO_COMPARE_SLUGS
    );

    expect(model.alternatives).not.toBeNull();
    expect(model.sameBrand).not.toBeNull();
    expect(model.alternatives?.cards).toHaveLength(1);
    expect(model.alternatives?.cards[0]?.href).toContain('galaxy-s24-ultra');
    expect(model.sameBrand?.cards).toHaveLength(1);
    expect(model.sameBrand?.cards[0]?.href).toContain('iphone-15-pro');
  });

  it('retains up to 2 cards in sameBrand while populating alternatives in multi-brand category', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-16',
      name: 'iPhone 16',
      brand: 'Apple',
      price: 800_000,
    });
    const inventory = [
      currentProduct,
      makeCandidate({
        slug: 'iphone-15',
        name: 'iPhone 15',
        brand: 'Apple',
        price: 750_000,
      }),
      makeCandidate({
        slug: 'iphone-14',
        name: 'iPhone 14',
        brand: 'Apple',
        price: 700_000,
      }),
      makeCandidate({
        slug: 'iphone-13',
        name: 'iPhone 13',
        brand: 'Apple',
        price: 650_000,
      }),
      makeCandidate({
        slug: 'pixel-8',
        name: 'Pixel 8',
        brand: 'Google',
        price: 780_000,
      }),
      makeCandidate({
        slug: 'galaxy-s24',
        name: 'Galaxy S24',
        brand: 'Samsung',
        price: 790_000,
      }),
    ];

    const model = buildRecommendationSections(
      makeInput({ currentProduct, inventory }),
      NO_COMPARE_SLUGS
    );

    expect(model.alternatives).not.toBeNull();
    expect(model.sameBrand).not.toBeNull();
    expect(model.sameBrand?.cards.length).toBeGreaterThanOrEqual(2);
    const alternativeHrefs = new Set(
      model.alternatives?.cards.map((c) => c.href)
    );
    const sameBrandHrefs = new Set(model.sameBrand?.cards.map((c) => c.href));
    for (const href of sameBrandHrefs) {
      expect(alternativeHrefs.has(href)).toBe(false);
    }
  });

  it('consumes all candidates in alternatives and returns null for sameBrand when single-brand has <= 6 candidates', () => {
    const currentProduct = makeCandidate({
      slug: 'macbook-pro-16',
      name: 'MacBook Pro 16',
      brand: 'Apple',
      price: 2_500_000,
    });
    const inventory = [
      currentProduct,
      makeCandidate({
        slug: 'macbook-pro-14',
        name: 'MacBook Pro 14',
        brand: 'Apple',
        price: 2_000_000,
      }),
      makeCandidate({
        slug: 'macbook-air-15',
        name: 'MacBook Air 15',
        brand: 'Apple',
        price: 1_600_000,
      }),
    ];

    const model = buildRecommendationSections(
      makeInput({ currentProduct, inventory }),
      NO_COMPARE_SLUGS
    );

    expect(model.alternatives?.cards).toHaveLength(2);
    expect(model.sameBrand).toBeNull();
  });

  it('allocates top 6 to alternatives and 7th candidate to sameBrand when single-brand has 7 candidates', () => {
    const currentProduct = makeCandidate({
      slug: 'ipad-pro-13',
      name: 'iPad Pro 13',
      brand: 'Apple',
      price: 1_500_000,
    });
    const candidates = Array.from({ length: 7 }, (_, i) =>
      makeCandidate({
        slug: `ipad-model-${i + 1}`,
        name: `iPad Model ${i + 1}`,
        brand: 'Apple',
        price: 1_000_000 + i * 50_000,
      })
    );

    const model = buildRecommendationSections(
      makeInput({ currentProduct, inventory: [currentProduct, ...candidates] }),
      NO_COMPARE_SLUGS
    );

    expect(model.alternatives?.cards).toHaveLength(6);
    expect(model.sameBrand).not.toBeNull();
    expect(model.sameBrand?.cards).toHaveLength(1);

    const alternativeSlugs = new Set(
      model.alternatives?.cards.map((c) => c.href)
    );
    const sameBrandSlugs = new Set(model.sameBrand?.cards.map((c) => c.href));
    for (const href of sameBrandSlugs) {
      expect(alternativeSlugs.has(href)).toBe(false);
    }
  });

  it('deduplicates repeated slugs within a single rail before applying the 6-card cap', () => {
    const currentProduct = makeCandidate({
      slug: 'anchor',
      name: 'Anchor',
      brand: undefined,
      price: 500_000,
    });
    const duplicateCandidate = makeCandidate({
      slug: 'dup-phone',
      name: 'Dup Phone',
      brand: 'Xiaomi',
      price: 510_000,
    });
    const distinctCandidates = Array.from({ length: 6 }, (_, i) =>
      makeCandidate({
        slug: `distinct-${i + 1}`,
        name: `Distinct ${i + 1}`,
        brand: 'Samsung',
        price: 520_000 + i * 5_000,
      })
    );

    const model = buildRecommendationSections(
      makeInput({
        currentProduct,
        inventory: [
          currentProduct,
          duplicateCandidate,
          duplicateCandidate,
          ...distinctCandidates,
        ],
      }),
      NO_COMPARE_SLUGS
    );

    expect(model.alternatives?.cards).toHaveLength(6);
    expect(new Set(model.alternatives?.cards.map((c) => c.href)).size).toBe(6);
  });
});
