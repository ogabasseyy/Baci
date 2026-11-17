import { describe, expect, it } from 'vitest';
import type { StorefrontAgentUiProduct } from '@/schemas/storefront-agent-ui-contract';
import { hasGroundedSpecAndPolicyClaims } from './ogabassey-catalog-agent-attributes';

const baseProduct: StorefrontAgentUiProduct = {
  brand: 'Apple',
  category: 'Laptops',
  description: 'Apple MacBook Air M2 with 1080p webcam and 4K display support',
  hasVariants: false,
  id: 'mac-1',
  imageUrl: 'https://cdn.example.com/mac.jpg',
  manageStock: true,
  name: 'Apple MacBook Air M2',
  price: 1_450_000,
  slug: 'apple-macbook-air-m2',
  stock: 3,
};

describe('ogabassey-catalog-agent-attributes', () => {
  it('enforces token boundaries on specs, exact policy terms, conditions, and promos', () => {
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 includes a 1080p webcam and 4K display.',
        [baseProduct]
      )
    ).toBe(true);

    // Substring collision ("8GB" inside "128GB storage") and role swaps ("128GB storage" -> "128GB RAM") must be rejected
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 has 8 GB RAM.', [
        { ...baseProduct, description: '128GB storage model' },
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 has 128GB RAM.', [
        { ...baseProduct, description: '128GB storage model' },
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 has 128GB storage.',
        [{ ...baseProduct, description: '128GB storage model' }]
      )
    ).toBe(true);

    // Contradictory warranty durations must not pass via bare stem match
    const oneYearProduct: StorefrontAgentUiProduct = {
      ...baseProduct,
      description: 'Includes a one-year manufacturer warranty',
    };
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 comes with a 1-year warranty.',
        [oneYearProduct]
      )
    ).toBe(true);
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 has a 10-year warranty.',
        [oneYearProduct]
      )
    ).toBe(false);

    // Ungrounded promotions fail closed, while negated promos are allowed
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 is 20% off.', [
        baseProduct,
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 has no discount available.',
        [baseProduct]
      )
    ).toBe(true);

    // Condition claims require grounded condition data
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 is UK used.', [
        baseProduct,
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 is brand new.', [
        { ...baseProduct, condition: 'Brand New' },
      ])
    ).toBe(true);

    // Grouped spec claims must hold for EVERY explicitly bound product
    const dellXps: StorefrontAgentUiProduct = {
      ...baseProduct,
      brand: 'Dell',
      description: 'Dell XPS 13',
      id: 'dell-13',
      name: 'Dell XPS 13',
      slug: 'dell-xps-13',
    };
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2, Dell XPS 13 both have 16 GB RAM.',
        [{ ...baseProduct, description: '16 GB RAM MacBook' }, dellXps]
      )
    ).toBe(false);

    // Color claims fail closed when ungrounded and pass when present in corpus
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 comes in purple.', [
        baseProduct,
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 comes in midnight.',
        [{ ...baseProduct, description: 'Midnight finish' }]
      )
    ).toBe(true);
  });
});
