import { describe, expect, it } from 'vitest';
import { normalizeProductModelTokens } from './normalize-product-model-tokens';

describe('normalizeProductModelTokens suffixes', () => {
  it('strips recognized multiword color finishes as one suffix', () => {
    expect(
      normalizeProductModelTokens(['macbook', 'pro', 'space', 'black'])
    ).toEqual(['macbook', 'pro']);
    expect(
      normalizeProductModelTokens(['iphone', '13', 'sierra', 'blue'])
    ).toEqual(['iphone', '13']);
  });

  it('strips active noise cancellation as a feature suffix', () => {
    expect(
      normalizeProductModelTokens([
        'airpods',
        '4',
        'with',
        'active',
        'noise',
        'cancellation',
      ])
    ).toEqual(['airpods', '4']);
  });
});
