import { describe, expect, it } from 'vitest';
import type { StorefrontAgentUiProduct } from '@/schemas/storefront-agent-ui-contract';
import {
  collectProductGroundingTokens,
  isFeatureVersionPhrase,
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
    expect(isFeatureVersionPhrase(['wi', 'fi', '6'])).toBe(true);
    expect(isFeatureVersionPhrase(['wi', 'fi', 'router'])).toBe(false);
    expect(isFeatureVersionPhrase(['bluetooth', '5', '3'])).toBe(true);
    expect(isFeatureVersionPhrase(['android', 'phone'])).toBe(false);
    expect(isFeatureVersionPhrase(['iphone', '15', 'pro'])).toBe(false);
    expect(isFeatureVersionPhrase(['gorilla', 'glass', '5'])).toBe(true);
    expect(isFeatureVersionPhrase(['glass', '5'], ['has', 'gorilla'])).toBe(
      true
    );
    expect(isFeatureVersionPhrase(['glass', '5'], ['shatterproof'])).toBe(
      false
    );
    expect(isFeatureVersionPhrase(['snapdragon', '8', 'gen', '3'])).toBe(true);
    expect(
      isFeatureVersionPhrase(['gen', '3'], ['with', 'snapdragon', '8'])
    ).toBe(true);
    expect(isFeatureVersionPhrase(['android', 'tablet', '15'])).toBe(false);
  });
});
