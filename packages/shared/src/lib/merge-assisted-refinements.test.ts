import { describe, expect, it } from 'vitest';
import { mergeAssistedRefinements } from './merge-assisted-refinements';
import { parseSearchAssistanceProposal } from './parse-search-assistance-proposal';

describe('mergeAssistedRefinements', () => {
  it('merges proposal filters over the committed query refinements', () => {
    const proposal = parseSearchAssistanceProposal({
      query: 'iphone',
      explanation: 'Used phones within your budget.',
      filters: { brands: ['Apple'], condition: 'used', maxPrice: 0 },
    });
    expect(
      mergeAssistedRefinements(
        { brands: [], sort: 'price_asc', minRating: 4 },
        proposal,
        'iphone'
      )
    ).toEqual({
      brands: ['Apple'],
      sort: 'price_asc',
      minRating: 4,
      condition: 'used',
      maxPrice: 0,
    });
  });

  it('requires confirmation before changing a contradictory existing budget', () => {
    const proposal = parseSearchAssistanceProposal({
      query: 'iphone',
      explanation: 'Budget',
      filters: { maxPrice: 50 },
    });
    expect(() =>
      mergeAssistedRefinements(
        { brands: [], sort: 'relevance', minPrice: 100 },
        proposal,
        'iphone'
      )
    ).toThrow('price range');
  });

  it('drops stale constraints when the proposal answers a different query', () => {
    const proposal = parseSearchAssistanceProposal({
      query: 'gaming laptop',
      explanation: 'Laptops for gaming.',
      filters: { brands: ['Lenovo'] },
    });
    // Apple/category/processor/rating/sort from the phone search cannot
    // carry into a laptop proposal the filters cannot express.
    expect(
      mergeAssistedRefinements(
        {
          brands: ['Apple'],
          categoryId: 'phones',
          processor: 'A17',
          sort: 'price_asc',
          minRating: 4,
        },
        proposal,
        'iphone'
      )
    ).toEqual({ brands: ['Lenovo'], sort: 'relevance' });
  });
});
