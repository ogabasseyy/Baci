import { describe, expect, it } from 'vitest';
import {
  createRefinementDraft,
  parseRefinementDraft,
} from './search-refinement-draft';

describe('search-refinement-draft', () => {
  it('creates an editable draft with string price bounds', () => {
    expect(
      createRefinementDraft({
        brands: ['Apple'],
        sort: 'relevance',
        minPrice: 100,
        maxPrice: 500,
        minRating: 4,
      })
    ).toEqual({
      brands: ['Apple'],
      sort: 'relevance',
      minPrice: 100,
      maxPrice: 500,
      minRating: 4,
      minimum: '100',
      maximum: '500',
    });
  });

  it('round-trips a draft back through criteria parsing', () => {
    const result = parseRefinementDraft(
      createRefinementDraft({
        brands: ['Apple'],
        sort: 'price_desc',
        condition: 'used',
        minPrice: 100,
        minRating: 0,
      })
    );

    expect(result).toEqual({
      success: true,
      data: {
        brands: ['Apple'],
        sort: 'price_desc',
        condition: 'used',
        minPrice: 100,
        minRating: 0,
      },
    });
  });

  it('treats blank price bounds as unbounded', () => {
    const result = parseRefinementDraft(
      createRefinementDraft({ brands: [], sort: 'relevance' })
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minPrice).toBeUndefined();
      expect(result.data.maxPrice).toBeUndefined();
    }
  });
});
