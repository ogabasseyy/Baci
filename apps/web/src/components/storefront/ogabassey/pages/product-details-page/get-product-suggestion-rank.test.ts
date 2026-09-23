import { describe, expect, it } from 'vitest';
import { getProductSuggestionRank } from './get-product-suggestion-rank';

describe('getProductSuggestionRank', () => {
  it('returns the same rank across cached renders of the same PDP', () => {
    expect(getProductSuggestionRank('candidate-1', 'current-product')).toBe(
      getProductSuggestionRank('candidate-1', 'current-product')
    );
  });

  it('scopes deterministic suggestion order to the current product', () => {
    expect(getProductSuggestionRank('candidate-1', 'product-a')).not.toBe(
      getProductSuggestionRank('candidate-1', 'product-b')
    );
  });
});
