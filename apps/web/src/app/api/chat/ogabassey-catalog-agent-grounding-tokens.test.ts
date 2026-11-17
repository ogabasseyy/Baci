import { describe, expect, it } from 'vitest';
import type { StorefrontAgentUiProduct } from '@/schemas/storefront-agent-ui-contract';
import {
  collectProductGroundingTokens,
  isNumericFeatureToken,
} from './ogabassey-catalog-agent-grounding-tokens';

const makeProduct = (
  overrides: Partial<StorefrontAgentUiProduct>
): StorefrontAgentUiProduct => ({
  brand: 'Apple',
  category: 'Laptops',
  description: 'Sample',
  hasVariants: false,
  id: 'p1',
  imageUrl: 'https://cdn.example.com/p.jpg',
  manageStock: true,
  name: 'Apple iMac',
  price: 1_500_000,
  slug: 'apple-imac',
  stock: 2,
  ...overrides,
});

describe('ogabassey-catalog-agent-grounding-tokens', () => {
  it('separates model identity tokens from description feature tokens and identifies numeric feature tags', () => {
    const { perProductTokens } = collectProductGroundingTokens([
      makeProduct({
        description: 'Retina 5K display, compare with iPhone 15 Pro',
      }),
    ]);

    expect(perProductTokens[0].identity.has('imac')).toBe(true);
    expect(perProductTokens[0].identity.has('15')).toBe(false);
    expect(perProductTokens[0].identity.has('5k')).toBe(false);
    expect(perProductTokens[0].features.has('5k')).toBe(true);
    expect(perProductTokens[0].features.has('retina')).toBe(true);

    expect(isNumericFeatureToken('5k')).toBe(true);
    expect(isNumericFeatureToken('120hz')).toBe(true);
    expect(isNumericFeatureToken('15')).toBe(false);
  });
});
