import { describe, expect, it } from 'vitest';
import { buildProductCardDescription } from './build-product-card-description';
import { makeCandidate } from './build-product-semantic-model.test-helpers';

describe('buildProductCardDescription', () => {
  it('formats cheaper alternative with savings parenthetical', () => {
    const candidate = makeCandidate({
      slug: 'galaxy-s24',
      name: 'Galaxy S24',
      condition: 'new',
      price: 385_000,
    });
    const currentProduct = makeCandidate({
      slug: 'galaxy-s24-plus',
      name: 'Galaxy S24 Plus',
      price: 450_000,
    });

    expect(
      buildProductCardDescription({
        candidate,
        currentProduct,
        countryCode: 'NG',
      })
    ).toBe('New • ₦385,000 (Save ₦65,000)');
  });

  it('formats more expensive upgrade with positive delta parenthetical', () => {
    const candidate = makeCandidate({
      slug: 'galaxy-s24-ultra',
      name: 'Galaxy S24 Ultra',
      condition: 'refurbished',
      price: 550_000,
    });
    const currentProduct = makeCandidate({
      slug: 'galaxy-s24',
      name: 'Galaxy S24',
      price: 450_000,
    });

    expect(
      buildProductCardDescription({
        candidate,
        currentProduct,
        countryCode: 'NG',
      })
    ).toBe('Refurbished • ₦550,000 (+₦100,000)');
  });

  it('omits delta parenthetical when prices are equal', () => {
    const candidate = makeCandidate({
      slug: 'pixel-9',
      name: 'Pixel 9',
      condition: 'used',
      price: 450_000,
    });
    const currentProduct = makeCandidate({
      slug: 'galaxy-s24',
      name: 'Galaxy S24',
      price: 450_000,
    });

    expect(
      buildProductCardDescription({
        candidate,
        currentProduct,
        countryCode: 'NG',
      })
    ).toBe('Used • ₦450,000');
  });

  it('extracts up to 2 verified hardware spec highlights in priority order', () => {
    const candidate = makeCandidate({
      slug: 'galaxy-s24',
      name: 'Galaxy S24',
      condition: 'new',
      price: 385_000,
      product_key_specs: {
        ram_gb: 8,
        storage_gb: '256',
        battery_mah: 5000,
        main_camera_mp: 50,
        screen_size_inches: 6.2,
      },
    });
    const currentProduct = makeCandidate({
      slug: 'galaxy-s24-plus',
      name: 'Galaxy S24 Plus',
      price: 450_000,
    });

    expect(
      buildProductCardDescription({
        candidate,
        currentProduct,
        countryCode: 'NG',
      })
    ).toBe('New • ₦385,000 (Save ₦65,000) • 8GB RAM, 256GB storage');
  });

  it('extracts lower priority specs and ignores invalid/zero/negative values', () => {
    const candidateWithLowerPriority = makeCandidate({
      slug: 'budget-explorer',
      name: 'Budget Explorer',
      condition: 'open box',
      price: 150_000,
      product_key_specs: { battery_mah: '5000', screen_size_inches: 6.7 },
    });
    expect(
      buildProductCardDescription({
        candidate: candidateWithLowerPriority,
        countryCode: 'NG',
      })
    ).toBe('Open Box • ₦150,000 • 5000mAh battery, 6.7" display');

    const candidateWithInvalid = makeCandidate({
      slug: 'test-device',
      name: 'Test Device',
      condition: 'new',
      price: 200_000,
      product_key_specs: {
        ram_gb: 0,
        storage_gb: -256,
        battery_mah: 'invalid',
        main_camera_mp: 48,
      },
    });
    expect(
      buildProductCardDescription({
        candidate: candidateWithInvalid,
        countryCode: 'NG',
      })
    ).toBe('New • ₦200,000 • 48MP camera');
  });

  it('handles missing condition, missing specs, and missing currentProduct fallback', () => {
    const candidate = makeCandidate({
      slug: 'bare-device',
      name: 'Bare Device',
      condition: null,
      price: 385_000,
      product_key_specs: null,
    });
    expect(buildProductCardDescription({ candidate })).toBe('₦385,000');

    const blankCondition = makeCandidate({
      slug: 'blank-condition',
      name: 'Blank Condition',
      condition: '   ',
      price: 385_000,
      product_key_specs: undefined,
    });
    expect(buildProductCardDescription({ candidate: blankCondition })).toBe(
      '₦385,000'
    );
  });

  it('suppresses stale hardware highlights when candidate is in an accessory category', () => {
    const candidate = makeCandidate({
      slug: 'leather-case',
      name: 'Leather Case',
      condition: 'new',
      price: 15_000,
      category_slug: 'phone-cases',
      product_key_specs: {
        ram_gb: 8,
        storage_gb: 256,
      },
    });

    expect(
      buildProductCardDescription({
        candidate,
        categorySlug: 'phone-cases',
        countryCode: 'NG',
      })
    ).toBe('New • ₦15,000');
  });
});
