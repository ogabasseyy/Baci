import { describe, expect, it } from 'vitest';
import { normalizeProductModelTokens } from './normalize-product-model-tokens';

describe('normalizeProductModelTokens game titles', () => {
  it('preserves title words that resemble metadata for game catalogs', () => {
    expect(
      normalizeProductModelTokens(['farcry', 'new', 'dawn', 'us'], true)
    ).toEqual(['farcry', 'new', 'dawn', 'us']);
  });
});
