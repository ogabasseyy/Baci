import { describe, expect, it } from 'vitest';
import type { StorefrontAgentUiProduct } from '@/schemas/storefront-agent-ui-contract';
import { hasGroundedSpecAndPolicyClaims } from './ogabassey-catalog-agent-attributes';

const baseProduct: StorefrontAgentUiProduct = {
  brand: 'Apple',
  category: 'Laptops',
  description: 'Apple MacBook Air M2 with 1080p webcam',
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
  it('accepts specs present in tool results and rejects fabricated specs, warranties, or conditions', () => {
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 with 1080p webcam is ₦1,450,000.',
        [baseProduct]
      )
    ).toBe(true);

    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 has 64 GB RAM.', [
        baseProduct,
      ])
    ).toBe(false);

    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 includes a two-year warranty.',
        [baseProduct]
      )
    ).toBe(false);

    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 is refurbished.', [
        baseProduct,
      ])
    ).toBe(false);

    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 is brand new with 1-year warranty.',
        [
          {
            ...baseProduct,
            condition: 'new',
            description: 'Brand new with 1-year warranty',
          },
        ]
      )
    ).toBe(true);
  });
});
